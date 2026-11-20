import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { setParticipation, type ParticipationKind, type TopicSummary } from "../api";
import { STATUS_LABEL, TYPE_LABEL, placeLabel, timeAgo } from "../labels";

/**
 * 요약 카드 (FR-NAV-07): 유형·장소, 처리 상태, 제목, 참여 집계, 최근 Report 시각.
 * Issue 카드에서는 상세로 들어가지 않고 바로 참여할 수 있다.
 */
export function TopicCard({ topic, onUpdate }: { topic: TopicSummary; onUpdate?: (t: TopicSummary) => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<ParticipationKind | null>(null);
  const c = topic.counts;
  const mine = topic.my_participations ?? [];
  const open = () => navigate(`/topics/${topic.id}`);

  async function toggle(kind: ParticipationKind) {
    if (busy) return;
    setBusy(kind);
    try {
      const st = await setParticipation(topic.id, kind, !mine.includes(kind));
      onUpdate?.({ ...topic, counts: st.counts, my_participations: st.my_participations });
    } catch {
      /* 실패하면 상태를 그대로 둔다. 상세 화면에서 다시 시도할 수 있다. */
    } finally {
      setBusy(null);
    }
  }

  return (
    <article
      className={`topic-card ${topic.type}`}
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter") open();
      }}
    >
      <div className="topic-card-meta">
        <span className="topic-card-kind">
          {TYPE_LABEL[topic.type].toUpperCase()} · {placeLabel(topic)}
        </span>
        <span className={`topic-card-status status-${topic.status}`}>{STATUS_LABEL[topic.status]}</span>
      </div>
      <div className="topic-card-title">{topic.title}</div>
      {/* 참여 버튼에 집계를 함께 보여준다 (예: '나도 겪었어요 3'). 오른쪽에 최근 Report 시각. */}
      <div className="topic-card-actions">
        <div className="topic-card-buttons" onClick={(e) => e.stopPropagation()}>
          {topic.type === "issue" ? (
            <>
              <CountPill
                label="나도 겪었어요"
                count={c.experienced}
                on={mine.includes("experienced")}
                busy={busy !== null}
                onClick={() => void toggle("experienced")}
              />
              <CountPill
                label="개선이 필요해요"
                count={c.needs_improvement}
                on={mine.includes("needs_improvement")}
                busy={busy !== null}
                onClick={() => void toggle("needs_improvement")}
              />
            </>
          ) : (
            <CountPill
              label="나도 원해요"
              count={c.want}
              proposal
              on={mine.includes("want")}
              busy={busy !== null}
              onClick={() => void toggle("want")}
            />
          )}
        </div>
        <span className="recent">{timeAgo(topic.last_report_at)}</span>
      </div>
    </article>
  );
}

function CountPill(props: {
  label: string;
  count: number;
  on: boolean;
  busy: boolean;
  proposal?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`pill count-pill ${props.proposal ? "proposal" : ""} ${props.on ? "on" : ""}`}
      aria-pressed={props.on}
      disabled={props.busy}
      onClick={props.onClick}
    >
      {props.label} <strong>{props.count}</strong>
    </button>
  );
}
