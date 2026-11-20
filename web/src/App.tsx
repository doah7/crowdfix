import { Navigate, Route, Routes, useLocation, useNavigationType, type Location } from "react-router-dom";
import { useAuth } from "./auth";
import { NavTypeContext } from "./pageTransition";
import { Explore } from "./pages/Explore";
import { Login } from "./pages/Login";
import { TopicDetailPage } from "./pages/TopicDetail";
import { WritePage } from "./pages/Write";

export function App() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navType = useNavigationType();

  if (loading) return <div className="app-shell center muted">불러오는 중…</div>;

  // 비로그인 상태에서는 로그인 화면만 제공한다 (REQ-AUTH-04)
  if (!user) {
    if (location.pathname !== "/login") {
      return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
    }
    return <Login />;
  }

  // 목록·글쓰기에서 상세를 열면 그 화면을 뒤에 그대로 두고, 상세를 위에 겹쳐 띄운다
  const background = (location.state as { background?: Location } | null)?.background;

  return (
    <NavTypeContext.Provider value={navType}>
      <Routes location={background ?? location}>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/" element={<Explore />} />
      <Route path="/topics/:id" element={<TopicDetailPage />} />
      <Route path="/write" element={<WritePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {background && (
        <Routes>
          <Route path="/topics/:id" element={<TopicDetailPage overlay />} />
        </Routes>
      )}
    </NavTypeContext.Provider>
  );
}
