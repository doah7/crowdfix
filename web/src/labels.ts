// 표준 표시 명칭 (SRS 표 3-2, 3-3). 같은 대상을 화면마다 다른 말로 쓰지 않는다 (REQ-UI-06).
import type { DeliveryStatus, Status, TopicType } from "./api";

export const TYPE_LABEL: Record<TopicType, string> = {
  issue: "Issue",
  proposal: "Proposal",
};

export const STATUS_LABEL: Record<Status, string> = {
  backlog: "검토 대기",
  in_progress: "진행 중",
  done: "완료됨",
};

export const DELIVERY_LABEL: Record<DeliveryStatus, string> = {
  not_sent: "미전달",
  sent: "전달 완료",
  failed: "전달 실패",
  review: "운영자 검토 중",
};

export const RESULT_LABEL: Record<string, string> = {
  resolved: "해결",
  closed_unresolved: "미해결 종료",
  adopted: "채택",
  partially_adopted: "부분 채택",
  not_adopted: "미채택",
};

export const ROLE_LABEL: Record<string, string> = {
  operator: "운영자",
  system: "시스템",
  student: "학생",
};

export function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "방금 전";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR");
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function placeLabel(t: { building: { name_ko: string } | null; floor: string | null }): string {
  if (!t.building) return "위치 없음";
  return t.floor ? `${t.building.name_ko} ${t.floor}` : t.building.name_ko;
}
