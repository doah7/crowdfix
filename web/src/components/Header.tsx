import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

// 상단 공통 영역: 서비스 이름, 알림함 진입, 안 읽은 개수 (REQ-UI-02)
export function Header() {
  const { user, logout } = useAuth();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    api<{ unread: number }>("/api/notifications/unread-count")
      .then((r) => setUnread(r.unread))
      .catch(() => setUnread(0));
  }, []);

  return (
    <header className="topbar">
      <Link to="/" className="topbar-brand">
        <img src="/icon-192.png" alt="" className="topbar-icon" />
        CrowdFix
      </Link>
      <div className="topbar-right">
        {user?.role === "operator" && <span className="chip operator">운영자</span>}
        <span className="bell" aria-label={`안 읽은 알림 ${unread}개`} title="알림함">
          <BellIcon />
          {unread > 0 && <span className="bell-count">{unread}</span>}
        </span>
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
