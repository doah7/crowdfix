"""기준 도달 시 담당 조직에 보고서 메일 1회 발송 (SRS 4.4, BR-07).

순서: ① 참여를 저장하는 트랜잭션(의제 행 잠금) 안에서 발송을 '예약'한다. 전달 상태를 sent로 바꾸고
발송 기록(result=pending)을 남긴 뒤 참여와 함께 커밋한다. ② 커밋이 끝난 뒤에 SMTP로 보낸다.
③ 결과에 따라 발송 기록을 accepted / no_response로 바꾸고, 실패면 전달 상태를 failed로 바꾼다.

보장 범위: 같은 의제의 메일은 최대 한 번만 보낸다. 커밋이 실패하면 예약도 함께 취소되므로 메일이 나가지 않고,
다시 참여해도 이중 발송되지 않는다. 예약 후 발송 전에 서버가 멈추면 발송 기록이 pending으로 남고,
이 경우와 발송 실패(failed)는 자동으로 다시 보내지 않는다(메일 재시도는 데모 범위 밖, 데모 문서 4.2).
"""

from dataclasses import dataclass
from email.message import EmailMessage
import smtplib

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models as m
from .config import settings
from .schemas import Counts


@dataclass
class PendingMail:
    topic_id: int
    delivery_id: int
    message: EmailMessage


def _one_line(text: str) -> str:
    # 메일 제목에는 줄바꿈을 넣을 수 없다 (헤더 주입 방지). 연속 공백도 하나로.
    return " ".join(text.split())


def _place(topic: m.Topic) -> str:
    if topic.building is None:
        return "위치 없음"
    detail = topic.room or topic.floor
    return f"{topic.building.name_ko} {detail}" if detail else topic.building.name_ko


def _body(topic: m.Topic, org_name: str, counts: Counts, reports: list[m.Report]) -> str:
    lines = [
        f"{org_name} 담당자님께",
        "",
        "CrowdFix에 같은 문제를 겪은 학생들의 제보가 기준 인원에 도달해 보고서를 전달드립니다.",
        "",
        f"■ 요약: {_one_line(topic.title)}",
        f"■ 위치: {_place(topic)}",
        f"■ 참여 규모: 경험자 {counts.experienced}명 · 개선 요청 {counts.needs_improvement}명 · 고유 {counts.unique}명",
        f"■ 연결된 Report: {len(reports)}건",
        "",
    ]
    for n, r in enumerate(reports, 1):
        tag = "대표 Report" if n == 1 else f"Report {n}"
        lines.append(f"[{tag}] {r.body}")
    lines += ["", f"원문 보기: {settings.public_base_url.rstrip('/')}/topics/{topic.id}"]
    return "\n".join(lines)


def reserve_if_ready(db: Session, topic: m.Topic, counts: Counts, threshold: int) -> PendingMail | None:
    """참여 트랜잭션이 의제 행을 잠근 상태에서 호출한다. 미전달 의제가 기준에 처음 도달하면 발송을 예약한다.
    돌려준 PendingMail은 호출한 쪽이 커밋한 뒤 send_reserved()로 보낸다."""
    if topic.delivery_status != "not_sent" or counts.unique < threshold:
        return None
    route = db.scalar(select(m.OrgRoute).where(m.OrgRoute.category == topic.category))
    if route is None:
        # 담당 조직을 정할 수 없으면 운영자 검토로 넘긴다 (FR-STAT-13)
        topic.delivery_status = "review"
        return None
    reports = list(db.scalars(select(m.Report).where(m.Report.topic_id == topic.id).order_by(m.Report.id)))
    msg = EmailMessage()
    msg["From"] = settings.report_mail_from
    msg["To"] = route.email
    msg["Subject"] = f"[CrowdFix] {_one_line(topic.title)}"
    msg.set_content(_body(topic, route.org_name, counts, reports))

    topic.delivery_status = "sent"
    delivery = m.Delivery(topic_id=topic.id, org_name=route.org_name, email=route.email,
                          trigger="auto", result="pending")
    db.add(delivery)
    db.flush()
    return PendingMail(topic_id=topic.id, delivery_id=delivery.id, message=msg)


def send_reserved(db: Session, job: PendingMail) -> None:
    """예약을 커밋한 뒤 호출한다. 메일 서버가 본문을 받았으면 accepted로 기록한다."""
    accepted, error = False, None
    try:
        smtp = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=4)
        try:
            smtp.send_message(job.message)
            accepted = True
        finally:
            try:
                smtp.quit()  # 본문을 받은 뒤 연결 종료에서 난 오류는 발송 결과에 영향을 주지 않는다
            except (OSError, smtplib.SMTPException):
                pass
    except (OSError, smtplib.SMTPException) as e:
        error = str(e)[:500]

    delivery = db.get(m.Delivery, job.delivery_id)
    if delivery is not None:
        delivery.result = "accepted" if accepted else "no_response"
        delivery.error = error
    if not accepted:
        topic = db.get(m.Topic, job.topic_id)
        if topic is not None:
            topic.delivery_status = "failed"
    db.commit()
