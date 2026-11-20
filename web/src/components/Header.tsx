import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

export const NOTIFICATIONS_CHANGED = "crowdfix:notifications-changed";

// 상단 공통 영역: 서비스 이름, 알림함 진입, 안 읽은 개수 (REQ-UI-02)
export function Header() {
  const { user, logout } = useAuth();
  const [unread, setUnread] = useState(0);
  // 알림을 열고 돌아오면(화면 이동) 안 읽은 개수를 다시 받는다
  const { key } = useLocation();
  const latest = useRef(0);

  useEffect(() => {
    // 요청이 겹치면 마지막 요청의 결과만 반영한다 (늦게 온 예전 응답이 덮어쓰지 않게)
    const load = () => {
      const seq = ++latest.current;
      api<{ unread: number }>("/api/notifications/unread-count")
        .then((r) => seq === latest.current && setUnread(r.unread))
        .catch(() => undefined);
    };
    load();
    // 알림함에서 알림을 읽으면 바로 개수를 갱신한다
    window.addEventListener(NOTIFICATIONS_CHANGED, load);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED, load);
  }, [key]);

  return (
    <header className="topbar">
      <Link to="/" className="topbar-brand">
        <img src="/icon-192.png" alt="" className="topbar-icon" />
        <span className="wordmark">CrowdFix</span>
      </Link>
      <div className="topbar-right">
        {user?.role === "operator" && <span className="chip operator">운영자</span>}
        <Link to="/notifications" className="bell" aria-label={`알림함, 안 읽은 알림 ${unread}개`} title="알림함">
          <BellIcon />
          {unread > 0 && <span className="bell-count">{unread}</span>}
        </Link>
        <button className="link-btn" onClick={logout} title={`${user?.display_name} 로그아웃`}>
          {user?.display_name} · 로그아웃
        </button>
      </div>
    </header>
  );
}

function BellIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
