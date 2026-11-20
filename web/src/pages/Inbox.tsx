import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { listNotifications, markNotificationRead, type Notice } from "../api";
import { Header, NOTIFICATIONS_CHANGED } from "../components/Header";
import { timeAgo } from "../labels";
import { usePageTransition } from "../pageTransition";

const EVENT_LABEL: Record<string, string> = {
  result_published: "처리 결과",
  status_changed: "상태 변경",
};

/** 알림함: 구독한 의제의 상태 변경·결과 공개 알림 (SRS 4.5, FR-NOTI-03~05) */
export function InboxPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [items, setItems] = useState<Notice[] | null>(null);
  const [failed, setFailed] = useState(false);
  const { phase, leave } = usePageTransition();

  useEffect(() => {
    listNotifications()
      .then(setItems)
      .catch(() => setFailed(true));
  }, []);

  function open(n: Notice) {
    if (!n.read) {
      // 서버에 저장된 뒤에만 읽음으로 바꾼다. 실패하면 안 읽음으로 남아 다시 누를 때 재시도한다.
      void markNotificationRead(n.id)
        .then(() => {
          setItems((cur) => cur?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? cur);
          window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
        })
        .catch(() => undefined);
    }
    // 목록 화면과 같이 알림함을 뒤에 두고 상세를 위에 겹쳐 띄운다
    navigate(`/topics/${n.topic_id}`, { state: { background: location } });
  }

  return (
    <div className="app-shell detail">
      <Header />
      <div className={`page-body page-slide ${phase}`}>
        <div className="detail-bar">
          <button className="detail-back" onClick={() => leave(() => navigate("/"))}>
            ← 홈으로
          </button>
        </div>
        <main className="inbox-body">
          <h1 className="inbox-title">알림함</h1>
          {failed && <div className="state-box">알림을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</div>}
          {!items && !failed && <p className="muted">불러오는 중…</p>}
          {items && items.length === 0 && (
            <div className="state-box">아직 받은 알림이 없어요. 구독한 의제의 상태가 바뀌면 여기에 알려 드려요.</div>
          )}
          {items?.map((n) => (
            <button key={n.id} className={`notice ${n.read ? "" : "unread"}`} onClick={() => open(n)}>
              <span className="notice-dot" aria-hidden />
              <span className="notice-main">
                <span className={`notice-tag ${n.event}`}>{EVENT_LABEL[n.event] ?? "알림"}</span>
                <span className="notice-topic">{n.topic_title}</span>
                <span className="notice-summary">{n.summary}</span>
                <span className="muted small">{timeAgo(n.created_at)}</span>
              </span>
            </button>
          ))}
        </main>
      </div>
    </div>
  );
}
