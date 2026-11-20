import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../api";
import { useAuth } from "../auth";

// 시연용 계정 (TBD-01). 비밀번호는 README에도 적혀 있는 시연 전용 값이다.
const DEMO_ACCOUNTS = [
  { id: "studentA", label: "학생 A" },
  { id: "studentB", label: "학생 B" },
  { id: "seedC1", label: "학생 C1" },
  { id: "operator", label: "운영자" },
];
const DEMO_PASSWORD = "demo1234";

export function Login() {
  const { login, notice } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function doLogin(id: string, pw: string) {
    setBusy(true);
    setError(null);
    try {
      await login(id, pw);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== "/login" ? from : "/", { replace: true });
    } catch (e) {
      // 인증 거부와 인증 서비스 이용 불가를 다르게 안내한다 (REQ-UI-22)
      if (e instanceof ApiError && (e.status === 401 || e.status === 400)) {
        setError("아이디 또는 비밀번호가 맞지 않아요.");
      } else {
        setError("지금은 로그인 서비스를 이용할 수 없어요. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void doLogin(loginId, password);
  }

  return (
    <div className="app-shell login">
      <div className="login-hero">
        <div className="brand-mark" aria-hidden>CF</div>
        <h1>CrowdFix</h1>
        <p>캠퍼스의 불편과 제안을 한곳에 모으고, 함께 모인 목소리를 담당 부서에 전달해요.</p>
      </div>

      {notice && <div className="banner warn">{notice}</div>}

      <form className="card form" onSubmit={onSubmit}>
        <label>
          아이디
          <input value={loginId} onChange={(e) => setLoginId(e.target.value)} autoComplete="username" />
        </label>
        <label>
          비밀번호
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <div className="field-error">{error}</div>}
        <button className="btn primary" disabled={busy}>
          로그인
        </button>
      </form>

      <section className="demo-accounts">
        <h2>시연용 계정으로 바로 로그인</h2>
        <p className="muted small">학교 계정 연동 대신 시연용 계정을 사용합니다.</p>
        <div className="demo-grid">
          {DEMO_ACCOUNTS.map((a) => (
            <button key={a.id} className="btn" disabled={busy} onClick={() => void doLogin(a.id, DEMO_PASSWORD)}>
              {a.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
