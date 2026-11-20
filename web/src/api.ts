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
  counts: Counts;
  report_count: number;
  last_report_at: string;
  created_at: string;
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
