import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ApiError,
  api,
  setParticipation,
  setSubscription,
  type ParticipationKind,
  type ParticipationState,
  type TopicDetail,
} from "../api";
import { Header } from "../components/Header";
import {
  DELIVERY_LABEL,
  RESULT_LABEL,
  ROLE_LABEL,
  STATUS_LABEL,
  TYPE_LABEL,
  formatDateTime,
  placeLabel,
  timeAgo,
} from "../labels";

/**
 * 의제 상세 (REQ-UI-11 배치 순서):
 * 유형·장소·제목 → 처리 상태·전달 상태 → 참여 집계 → 연결된 Report·댓글 → 참여 버튼 → 처리 이력
 */
export function TopicDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const registered = (location.state as { registered?: string } | null)?.registered ?? null;
  const [topic, setTopic] = useState<TopicDetail | null>(null);
  const [error, setError] = useState<"not_found" | "failed" | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    setTopic(null);
    setError(null);
    api<TopicDetail>(`/api/topics/${id}`)
      .then(setTopic)
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? "not_found" : "failed"));
  }, [id]);

  const back = () => (window.history.length > 1 ? navigate(-1) : navigate("/"));

  async function toggleSubscribe() {
    if (!topic || pending) return;
    setPending("sub");
    try {
      const st = await setSubscription(topic.id, !topic.subscribed);
      setTopic({ ...topic, ...st });
    } catch {
      /* 그대로 둔다 */
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="app-shell detail">
      <Header />
      <div className="detail-bar">
        <button className="detail-back" onClick={back}>
          ← 뒤로가기
        </button>
        {topic && (
          <button
            className={`subscribe ${topic.subscribed ? "on" : ""}`}
            aria-pressed={topic.subscribed}
            disabled={pending !== null}
            onClick={() => void toggleSubscribe()}
          >
            {topic.subscribed ? "🔔 구독 중" : "구독"}
          </button>
        )}
      </div>

      {error === "not_found" && <div className="state-box">더 이상 확인할 수 없는 의제예요.</div>}
      {error === "failed" && <div className="state-box">요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.</div>}
      {!topic && !error && <p className="muted pad">불러오는 중…</p>}
      {topic && registered && (
        // Report 등록 결과와 의제 연결 결과를 구분해 보여준다 (REQ-UI-21)
        <div className="banner ok" role="status">
          {registered === "new_topic" ? "새 의제로 등록했어요." : "기존 의제에 내 글을 연결했어요."}
        </div>
      )}
      {topic && <DetailBody topic={topic} onState={(st) => setTopic({ ...topic, ...st, counts: st.counts })} />}
    </div>
  );
}

function DetailBody({ topic, onState }: { topic: TopicDetail; onState: (s: ParticipationState) => void }) {
  const c = topic.counts;
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function toggle(kind: ParticipationKind) {
    if (pending) return;
    setPending(kind);
    setActionError(null);
    try {
      onState(await setParticipation(topic.id, kind, !topic.my_participations.includes(kind)));
    } catch {
      setActionError("요청을 처리하지 못했어요. 다시 눌러 주세요.");
    } finally {
      setPending(null);
    }
  }

  const done = [...topic.history].reverse().find((h) => h.to_status === "done");
  const tiles =
    topic.type === "issue"
      ? [
          { n: c.experienced, label: "경험", accent: true },
          { n: c.needs_improvement, label: "공감", accent: true },
          { n: topic.report_count, label: "연결 글", accent: false },
        ]
      : [
          { n: c.want, label: "지지", accent: true },
          { n: topic.report_count, label: "연결 글", accent: false },
        ];

  return (
    <main className="detail-body">
      <span className={`kind-pill ${topic.type}`}>
        {TYPE_LABEL[topic.type].toUpperCase()} · {placeLabel(topic)}
      </span>
      <h1 className="detail-title">{topic.title}</h1>

      {/* 처리 상태와 전달 상태를 구분해 함께 보여준다 (REQ-UI-13) */}
      <div className="detail-status">
        <span className={`status-pill status-${topic.status}`}>{STATUS_LABEL[topic.status]}</span>
        <span className={`status-pill delivery delivery-${topic.delivery_status}`}>
          {DELIVERY_LABEL[topic.delivery_status]}
        </span>
        <span className="muted small">최근 Report {timeAgo(topic.last_report_at)}</span>
      </div>

      {topic.status === "done" && topic.result && (
        <div className="result-box">
          <strong>{RESULT_LABEL[topic.result] ?? topic.result}</strong>
          {topic.result_reason && <span> · {topic.result_reason}</span>}
          {done && <div className="muted small">{formatDateTime(done.created_at)}</div>}
        </div>
      )}

      <div className={`stat-tiles n${tiles.length}`}>
        {tiles.map((t) => (
          <div key={t.label} className="stat-tile">
            <div className={`stat-n ${t.accent ? "accent" : ""} ${topic.type}`}>{t.n}</div>
            <div className="stat-label">{t.label}</div>
          </div>
        ))}
      </div>
      <div className="unique-line">
        고유 참여 <strong>{c.unique}명</strong>
        <span className="muted"> · 전달 기준 {topic.threshold}명</span>
      </div>

      <section>
        <div className="section-head">
          <h2>연결된 Report</h2>
          {/* 데모 범위: 댓글은 아이콘만 표시한다 (데모 문서 4.1) */}
          <span className="comment-icon" aria-label="댓글" title="댓글">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            댓글
          </span>
        </div>
        <ul className="report-boxes">
          {topic.reports.map((r) => (
            <li key={r.id} className="report-box">
              <div>
                “{r.body}”{r.photos.length > 0 && <span className="muted"> · 사진 {r.photos.length}</span>}
              </div>
              {r.photos.length > 0 && (
                <div className="thumbs">
                  {r.photos.map((p) => (
                    <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                      <img src={p.url} alt="첨부 사진" />
                    </a>
                  ))}
                </div>
              )}
              <div className="report-meta">
                {r.is_mine && <span className="mine-tag">내 글</span>}
                {timeAgo(r.created_at)}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* 참여 버튼: 본인의 선택 여부를 버튼에 표시한다 (REQ-UI-12). 화면 아래에 고정. */}
      {topic.status === "done" ? (
        <div className="join-dock done">
          <div className="done-note">{DONE_MESSAGE[topic.result ?? ""] ?? "처리가 완료되었어요."}</div>
        </div>
      ) : (
      <div className={`join-dock join-row ${topic.type}`}>
        {topic.type === "issue" ? (
          <>
            <JoinPill label="나도 겪었어요" count={c.experienced} on={topic.my_participations.includes("experienced")}
              busy={pending !== null} onClick={() => void toggle("experienced")} />
            <JoinPill label="개선이 필요해요" count={c.needs_improvement} on={topic.my_participations.includes("needs_improvement")}
              busy={pending !== null} onClick={() => void toggle("needs_improvement")} />
          </>
        ) : (
          <JoinPill label="나도 원해요" count={c.want} on={topic.my_participations.includes("want")} proposal
            busy={pending !== null} onClick={() => void toggle("want")} />
        )}
      </div>
      )}
      {actionError && <div className="field-error">{actionError}</div>}

      <section>
        <div className="section-head">
          <h2>처리 이력</h2>
        </div>
        <ol className="history">
          {topic.history.map((h, i) => (
            <li key={i} className={`status-${h.to_status}`}>
              <span className="history-dot" aria-hidden />
              <div className="history-when">
                {formatDateTime(h.created_at)} · {ROLE_LABEL[h.actor_role] ?? h.actor_role}
              </div>
              <div className="history-what">
                {h.from_status ? `${STATUS_LABEL[h.from_status]} → ` : ""}
                <strong>{STATUS_LABEL[h.to_status]}</strong>
                {h.result && ` · ${RESULT_LABEL[h.result] ?? h.result}`}
              </div>
              {h.reason && <div className="history-reason">{h.reason}</div>}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

// 완료된 의제의 아래 고정 영역 문구 (처리 결과별)
const DONE_MESSAGE: Record<string, string> = {
  resolved: "문제가 해결되었어요.",
  closed_unresolved: "해결되지 않고 종료되었어요.",
  adopted: "제안이 채택되었어요.",
  partially_adopted: "제안이 일부 채택되었어요.",
  not_adopted: "제안이 채택되지 않았어요.",
};

function JoinPill(props: {
  label: string;
  count: number;
  on: boolean;
  busy: boolean;
  proposal?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`join-pill ${props.proposal ? "proposal" : ""} ${props.on ? "on" : ""}`}
      aria-pressed={props.on}
      disabled={props.busy}
      onClick={props.onClick}
    >
      {props.label} <strong>{props.count}</strong>
    </button>
  );
}
