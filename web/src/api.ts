// API 호출과 타입 정의. 백엔드 스키마(api/app/schemas.py)와 맞춘다.

export type Role = "student" | "operator";
export type TopicType = "issue" | "proposal";
export type Status = "backlog" | "in_progress" | "done";
export type DeliveryStatus = "not_sent" | "sent" | "failed" | "review";

export interface User {
  id: number;
  login_id: string;
  display_name: string;
  role: Role;
}

export interface Building {
  id: number;
  build_no: string | null;
  name_ko: string;
  name_en: string;
  latitude: number;
  longitude: number;
  kind: string;
  topic_count: number;
}

export interface Counts {
  experienced: number;
  needs_improvement: number;
  want: number;
  unique: number;
}

export interface TopicSummary {
  id: number;
  type: TopicType;
  title: string;
  summary: string;
  status: Status;
  delivery_status: DeliveryStatus;
  building: Pick<Building, "id" | "name_ko" | "name_en" | "latitude" | "longitude"> | null;
  floor: string | null;
  room?: string | null;
  counts: Counts;
  report_count: number;
  last_report_at: string;
  created_at: string;
  my_participations?: string[];
}

export interface TopicDetail extends TopicSummary {
  result: string | null;
  result_reason: string | null;
  threshold: number;
  my_participations: string[];
  subscribed: boolean;
  reports: {
    id: number;
    title: string;
    body: string;
    created_at: string;
    is_mine: boolean;
    photos: { id: number; url: string }[];
  }[];
  history: {
    from_status: Status | null;
    to_status: Status;
    actor_role: string;
    reason: string | null;
    result: string | null;
    created_at: string;
  }[];
}

export class ApiError extends Error {
  constructor(public status: number, public type: string) {
    super(`${status} ${type}`);
  }
}

const TOKEN_KEY = "crowdfix.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 저장소를 못 쓰는 환경에서는 새로고침 시 다시 로그인한다 */
  }
}

let onUnauthorized: ((type: string) => void) | null = null;
export function setUnauthorizedHandler(fn: (type: string) => void) {
  onUnauthorized = fn;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(0, "network");
  }
  if (!res.ok) {
    let type = "server_error";
    try {
      const body = await res.json();
      type = body?.detail?.type ?? type;
    } catch {
      /* 본문 없음 */
    }
    if (res.status === 401 && token && onUnauthorized) onUnauthorized(type);
    throw new ApiError(res.status, type);
  }
  return res.json() as Promise<T>;
}

export interface ParticipationState {
  counts: Counts;
  delivery_status: DeliveryStatus;
  my_participations: string[];
  subscribed: boolean;
}

export type ParticipationKind = "experienced" | "needs_improvement" | "want";

export function setParticipation(topicId: number, kind: ParticipationKind, on: boolean) {
  return api<ParticipationState>(`/api/topics/${topicId}/participations/${kind}`, { method: on ? "PUT" : "DELETE" });
}

export function setSubscription(topicId: number, on: boolean) {
  return api<ParticipationState>(`/api/topics/${topicId}/subscription`, { method: on ? "PUT" : "DELETE" });
}

export interface ReportCreated {
  report_id: number;
  topic_id: number;
  link: "new_topic" | "user_selected" | "ai_auto";
}

/** 입력 오류(422)일 때 항목별 사유를 함께 돌려준다. */
export class FieldErrors extends ApiError {
  constructor(public fields: Record<string, string>) {
    super(422, "validation");
  }
}

export async function createReport(form: FormData): Promise<ReportCreated> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let res: Response;
  try {
    res = await fetch("/api/reports", { method: "POST", body: form, headers });
  } catch {
    throw new ApiError(0, "network");
  }
  if (res.ok) return res.json();
  let detail: { type?: string; fields?: Record<string, string> } = {};
  try {
    detail = (await res.json())?.detail ?? {};
  } catch {
    /* 본문 없음 */
  }
  if (res.status === 422 && detail.fields) throw new FieldErrors(detail.fields);
  if (res.status === 401 && onUnauthorized) onUnauthorized(detail.type ?? "auth_required");
  throw new ApiError(res.status, detail.type ?? "server_error");
}

export function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export interface SimilarCandidate {
  topic: TopicSummary;
  similarity: number;
  relation: "same" | "related";
  matched: string[];
}

export interface SimilarResult {
  category: string | null;
  floor: string | null;
  candidates: SimilarCandidate[];
}

export function findSimilar(buildingId: number, title: string, body: string, signal?: AbortSignal) {
  return api<SimilarResult>("/api/similar", {
    method: "POST",
    body: JSON.stringify({ building_id: buildingId, title, body }),
    signal,
  });
}

// ---------- 운영자 상태 변경 (SRS 4.4) ----------

export function changeStatus(
  topicId: number,
  body: { status: "in_progress" | "done"; reason: string; result?: "resolved" | "closed_unresolved" },
) {
  return api<{ status: Status; notified: number }>(`/api/topics/${topicId}/status`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// ---------- 알림함 (SRS 4.5) ----------

export interface Notice {
  id: number;
  topic_id: number;
  topic_title: string;
  event: string;
  summary: string;
  read: boolean;
  created_at: string;
}

export function listNotifications() {
  return api<Notice[]>("/api/notifications");
}

export function markNotificationRead(id: number) {
  return api<{ read: boolean }>(`/api/notifications/${id}/read`, { method: "PUT" });
}
