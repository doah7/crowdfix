import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, api, type TopicDetail } from "../api";
import { Header } from "../components/Header";
import {
  DELIVERY_LABEL,
  RESULT_LABEL,
  ROLE_LABEL,
  STATUS_LABEL,
  STATUS_MEANING,
  TYPE_HINT,
  TYPE_LABEL,
  formatDateTime,
  placeLabel,
  timeAgo,
} from "../labels";

/**
 * 의제 상세 (REQ-UI-11 배치 순서):
 * 유형·장소·제목 → 처리 상태·전달 상태 → 참여 집계 → 연결된 Report·댓글 → 처리 이력
 */
export function TopicDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [topic, setTopic] = useState<TopicDetail | null>(null);
  const [error, setError] = useState<"not_found" | "failed" | null>(null);

  useEffect(() => {
    setTopic(null);
    setError(null);
    api<TopicDetail>(`/api/topics/${id}`)
      .then(setTopic)
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? "not_found" : "failed"));
  }, [id]);

  const back = () => (window.history.length > 1 ? navigate(-1) : navigate("/"));

  return (
    <div className="app-shell detail">
      <Header />
      <div className="detail-nav">
        <button className="link-btn" onClick={back}>
          ← 뒤로
        </button>
      </div>

      {error === "not_found" && <div className="state-box">더 이상 확인할 수 없는 의제예요.</div>}
      {error === "failed" && <div className="state-box">요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.</div>}
      {!topic && !error && <p className="muted pad">불러오는 중…</p>}
      {topic && <DetailBody topic={topic} />}
    </div>
  );
}

function DetailBody({ topic }: { topic: TopicDetail }) {
  const c = topic.counts;
  const latestDone = [...topic.history].reverse().find((h) => h.to_status === "done");

  return (
    <main className="detail-body">
      <section className="detail-head">
        <div className="row gap">
          <span className={`chip type-${topic.type}`}>{TYPE_LABEL[topic.type]}</span>
          <span className="muted small">{TYPE_HINT[topic.type]}</span>
        </div>
        <div className="muted small">{placeLabel(topic)}</div>
        <h1>{topic.title}</h1>
        {topic.summary && <p className="muted">{topic.summary}</p>}
      </section>

      {/* 처리 상태와 전달 상태는 각각 별도 줄로 표시한다 (REQ-UI-13) */}
      <section className="card status-card">
        <div className="kv">
          <span className="k">처리 상태</span>
          <span className={`chip status-${topic.status}`}>{STATUS_LABEL[topic.status]}</span>
        </div>
        <p className="muted small">{STATUS_MEANING[topic.status]}</p>
        <div className="kv">
          <span className="k">전달 상태</span>
          <span className={`chip delivery-${topic.delivery_status}`}>{DELIVERY_LABEL[topic.delivery_status]}</span>
        </div>
        {topic.status === "done" && topic.result && (
          <div className="result-box">
            <div className="kv">
              <span className="k">처리 결과</span>
              <strong>{RESULT_LABEL[topic.result] ?? topic.result}</strong>
            </div>
            {topic.result_reason && <p>{topic.result_reason}</p>}
            {latestDone && <p className="muted small">{formatDateTime(latestDone.created_at)} 공개</p>}
          </div>
        )}
      </section>

      <section className="card">
        <h2>참여</h2>
        <div className="count-grid">
          {topic.type === "issue" ? (
            <>
              <Count label="경험자" value={c.experienced} hint="나도 겪었어요" />
              <Count label="개선 지지" value={c.needs_improvement} hint="개선이 필요해요" />
            </>
          ) : (
            <Count label="제안 지지" value={c.want} hint="나도 원해요" />
          )}
          <Count label="고유 참여" value={c.unique} hint={`전달 기준 ${topic.threshold}명`} strong />
        </div>
        <p className="muted small">
          한 사람이 두 버튼을 모두 눌러도 고유 참여는 1명으로 셉니다. 글 작성·댓글·구독은 참여 인원에 포함되지 않아요.
        </p>
      </section>

      <section className="card">
        <div className="row between">
          <h2>연결된 Report {topic.report_count}건</h2>
          {/* 데모 범위: 댓글은 아이콘만 표시한다 (데모 문서 4.1) */}
          <span className="comment-icon" aria-label="댓글" title="댓글">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            댓글
          </span>
        </div>
        <ul className="report-list">
          {topic.reports.map((r) => (
            <li key={r.id}>
              <div className="row between">
                <strong>{r.title}</strong>
                <span className="muted small">{timeAgo(r.created_at)}</span>
              </div>
              <p>{r.body}</p>
              {r.photos.length > 0 && (
                <div className="thumbs">
                  {r.photos.map((p) => (
                    <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                      <img src={p.url} alt="첨부 사진" />
                    </a>
                  ))}
                </div>
              )}
              {r.is_mine && <span className="chip mine">내 글</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>처리 이력</h2>
        <ol className="timeline">
          {topic.history.map((h, i) => (
            <li key={i}>
              <div className="small muted">
                {formatDateTime(h.created_at)} · {ROLE_LABEL[h.actor_role] ?? h.actor_role}
              </div>
              <div>
                {h.from_status ? `${STATUS_LABEL[h.from_status]} → ` : ""}
                <strong>{STATUS_LABEL[h.to_status]}</strong>
                {h.result && ` · ${RESULT_LABEL[h.result] ?? h.result}`}
              </div>
              {h.reason && <div className="small">{h.reason}</div>}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

function Count({ label, value, hint, strong }: { label: string; value: number; hint: string; strong?: boolean }) {
  return (
    <div className={`count ${strong ? "strong" : ""}`}>
      <div className="count-value">{value}명</div>
      <div className="count-label">{label}</div>
      <div className="muted small">{hint}</div>
    </div>
  );
}
