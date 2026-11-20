import { Link } from "react-router-dom";
import type { TopicSummary } from "../api";
import { STATUS_LABEL, TYPE_LABEL, placeLabel, timeAgo } from "../labels";

// 요약 카드 (FR-NAV-07): 제목, 유형, 처리 상태, 참여 집계, 최근 Report 시각
export function TopicCard({ topic }: { topic: TopicSummary }) {
  const c = topic.counts;
  return (
    <Link to={`/topics/${topic.id}`} className={`topic-card ${topic.type}`}>
      <div className="topic-card-top">
        <span className={`chip type-${topic.type}`}>{TYPE_LABEL[topic.type]}</span>
        <span className={`chip status-${topic.status}`}>{STATUS_LABEL[topic.status]}</span>
      </div>
      <div className="topic-card-title">{topic.title}</div>
      <div className="topic-card-place muted small">{placeLabel(topic)}</div>
      <div className="topic-card-stats small">
        {topic.type === "issue" ? (
          <>
            <span>경험자 {c.experienced}명</span>
            <span>개선 지지 {c.needs_improvement}명</span>
          </>
        ) : (
          <span>제안 지지 {c.want}명</span>
        )}
        <span className="muted">최근 Report {timeAgo(topic.last_report_at)}</span>
      </div>
    </Link>
  );
}
