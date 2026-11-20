import { useState } from "react";
import { ApiError, changeStatus, type TopicDetail } from "../api";
import { RESULT_LABEL, STATUS_LABEL } from "../labels";

/**
 * 운영자 처리 (SRS 4.4, FR-STAT-02~05). 검토 대기 → 진행 중 → 완료됨 순서로만 바꾼다.
 * 완료할 때는 처리 결과와 내용을 함께 입력해야 한다.
 */
export function OperatorStatus({ topic, onChanged }: { topic: TopicDetail; onChanged: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<"resolved" | "closed_unresolved">("resolved");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (topic.type !== "issue" || topic.status === "done") return null;
  const finishing = topic.status === "in_progress";
  const next = finishing ? "done" : "in_progress";

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await changeStatus(topic.id, finishing ? { status: "done", reason: reason.trim(), result } : { status: "in_progress", reason: reason.trim() });
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 409
          ? "다른 곳에서 상태가 바뀌었어요. 화면을 새로고침해 주세요."
          : "변경하지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
      setBusy(false);
      return;
    }
    // 여기부터는 저장이 끝난 상태. 다시 불러오기만 실패하면 저장 실패로 보이지 않게 따로 알린다.
    setReason("");
    try {
      await onChanged();
    } catch {
      setError("저장했어요. 바뀐 내용을 보려면 화면을 새로고침해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="operator-panel">
      <div className="section-head">
        <h2>운영자 처리</h2>
        <span className="muted small">
          {STATUS_LABEL[topic.status]} → <strong>{STATUS_LABEL[next]}</strong>
        </span>
      </div>
      <div className="form">
        {finishing && (
          <label>
            처리 결과
            <select value={result} onChange={(e) => setResult(e.target.value as typeof result)}>
              <option value="resolved">{RESULT_LABEL.resolved}</option>
              <option value="closed_unresolved">{RESULT_LABEL.closed_unresolved}</option>
            </select>
          </label>
        )}
        <label>
          {finishing ? "처리 내용 (학생에게 공개)" : "사유 (선택)"}
          <textarea
            value={reason}
            maxLength={500}
            placeholder={finishing ? "예: 부품 교체 완료" : "예: 시설팀 확인 중"}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {error && <div className="field-error" role="alert">{error}</div>}
        <button className="btn primary block" disabled={busy || (finishing && !reason.trim())} onClick={() => void submit()}>
          {finishing ? "완료 처리하고 결과 공개" : "진행 중으로 변경"}
        </button>
      </div>
    </section>
  );
}
