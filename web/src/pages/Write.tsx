import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useNavigationType, useSearchParams } from "react-router-dom";
import {
  ApiError,
  FieldErrors,
  api,
  createReport,
  findSimilar,
  newRequestId,
  type Building,
  type SimilarCandidate,
} from "../api";
import { BuildingSearch } from "../components/BuildingSearch";
import { Header } from "../components/Header";
import { usePageTransition } from "../pageTransition";
import { placeLabel } from "../labels";

// 사진 제한 (데모 문서 TBD-09). 서버에서도 같은 기준으로 다시 검사한다.
const PHOTO_MAX = 1;
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png"];
const SIMILAR_MIN_TEXT = 5;
const SIMILAR_DEBOUNCE_MS = 500;

type Similar =
  | { state: "idle" }
  | { state: "searching" }
  | { state: "failed" }
  | { state: "done"; candidates: SimilarCandidate[] };

/**
 * 추천된 의제를 열어 보러 상세 화면에 다녀올 때 쓰던 글을 잠시 맡겨 두는 곳.
 * 사진(File)까지 그대로 두려고 메모리에 둔다. 뒤로가기로 돌아왔을 때만 꺼내 쓴다.
 */
interface Draft {
  buildingId: number | null;
  floor: string;
  title: string;
  body: string;
  photos: File[];
  requestId: string;
  similar: Similar;
}
let parkedDraft: Draft | null = null;

/** Report 작성 (SRS 3.1.6, 4.2). 데모 범위에서 등록은 Issue만 다룬다. */
export function WritePage() {
  const navigate = useNavigate();
  const navType = useNavigationType();
  const [params] = useSearchParams();
  // 상세 화면에서 뒤로가기로 돌아온 경우에만 맡겨 둔 글을 되살린다
  const [draft] = useState<Draft | null>(() => (navType === "POP" ? parkedDraft : null));
  useEffect(() => {
    parkedDraft = null; // 한 번 되살렸으면 비운다
  }, []);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingId, setBuildingId] = useState<number | null>(
    draft ? draft.buildingId : params.get("b") ? Number(params.get("b")) : null,
  );
  const [floor, setFloor] = useState(draft?.floor ?? "");
  const [title, setTitle] = useState(draft?.title ?? "");
  const [body, setBody] = useState(draft?.body ?? "");
  const [photos, setPhotos] = useState<File[]>(draft?.photos ?? []);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 한 번 작성한 글은 다시 보내도 같은 요청으로 처리된다 (REQ-REG-12)
  const requestId = useRef(draft?.requestId ?? newRequestId());
  const fileInput = useRef<HTMLInputElement>(null);
  const [similar, setSimilar] = useState<Similar>(draft?.similar ?? { state: "idle" });
  // 글쓰기: 가운데에서 퍼지며 열리고, 닫을 때는 가운데로 모이며 사라진다
  const { phase, leave } = usePageTransition();

  // 추천 후보 칸을 누르면 쓰던 글을 맡겨 두고 그 의제의 상세 화면으로 간다
  function openCandidate(topicId: number) {
    parkedDraft = { buildingId, floor, title, body, photos, requestId: requestId.current, similar };
    navigate(`/topics/${topicId}`);
  }
  const [retryKey, setRetryKey] = useState(0);

  // 본문을 입력하는 동안 비슷한 의제를 찾는다. 등록 버튼을 누르기 전에 보여준다 (데모 문서 5장).
  useEffect(() => {
    if (!buildingId || body.trim().length < SIMILAR_MIN_TEXT) {
      setSimilar({ state: "idle" });
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setSimilar((prev) => (prev.state === "done" ? prev : { state: "searching" }));
      findSimilar(buildingId, title, body, ctrl.signal)
        .then((r) => setSimilar({ state: "done", candidates: r.candidates }))
        .catch(() => {
          if (!ctrl.signal.aborted) setSimilar({ state: "failed" });
        });
    }, SIMILAR_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [buildingId, title, body, retryKey]);

  const candidates = similar.state === "done" ? similar.candidates : [];

  useEffect(() => {
    api<Building[]>("/api/buildings").then(setBuildings).catch(() => setBuildings([]));
  }, []);

  const building = buildings.find((b) => b.id === buildingId) ?? null;
  const previews = useMemo(() => photos.map((f) => URL.createObjectURL(f)), [photos]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  function onPickPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked = [...files];
    const next = [...photos];
    const rejected: string[] = [];
    for (const f of picked) {
      if (next.length >= PHOTO_MAX) {
        rejected.push(`사진은 ${PHOTO_MAX}장까지 첨부할 수 있어요.`);
        break;
      }
      if (!PHOTO_TYPES.includes(f.type)) rejected.push(`${f.name}: JPG 또는 PNG 사진만 첨부할 수 있어요.`);
      else if (f.size > PHOTO_MAX_BYTES) rejected.push(`${f.name}: 사진은 5MB 이하만 첨부할 수 있어요.`);
      else next.push(f);
    }
    setPhotos(next);
    setPhotoError(rejected[0] ?? null);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await submit(null);
  }

  async function submit(targetTopicId: number | null) {
    const local: Record<string, string> = {};
    if (!buildingId) local.building_id = "장소를 선택해 주세요.";
    if (body.trim().length < 5) local.body = "내용을 5자 이상 적어 주세요.";
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length > 0) return;

    const form = new FormData();
    form.set("type", "issue");
    form.set("client_request_id", requestId.current);
    form.set("building_id", String(buildingId));
    form.set("floor", floor);
    form.set("title", title);
    form.set("body", body);
    if (targetTopicId !== null) form.set("target_topic_id", String(targetTopicId));
    for (const p of photos) form.append("photo", p);

    setBusy(true);
    try {
      const res = await createReport(form);
      navigate(`/topics/${res.topic_id}`, { replace: true, state: { registered: res.link } });
    } catch (err) {
      // 오류가 나도 입력한 본문·장소·사진은 그대로 둔다 (REQ-UI-25)
      if (err instanceof FieldErrors) {
        setErrors(err.fields);
        if (err.fields.photo) setPhotoError(err.fields.photo);
      } else if (err instanceof ApiError && err.status === 401) {
        setFormError("로그인 시간이 만료되었어요. 다시 로그인해 주세요.");
      } else {
        setFormError("등록하지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell write">
      <Header />
      {/* 위쪽 바(Header)는 고정하고 아래 내용만 움직인다 */}
      <div className={`page-body page-zoom ${phase}`}>
      <div className="detail-bar divider">
        <button className="detail-back" onClick={() => leave(() => navigate(-1))}>
          ← 취소
        </button>
      </div>

      <form className="write-body" onSubmit={onSubmit} noValidate>
        <span className="kind-pill issue">ISSUE{building ? ` · ${building.name_ko}` : ""}</span>

        <div className="field">
          <span className="field-label">장소 *</span>
          <BuildingSearch
            buildings={buildings}
            selected={building}
            onSelect={setBuildingId}
            placeholder="건물 검색 (예: 삼성학술정보관, 248)"
            invalid={!!errors.building_id}
          />
          {errors.building_id && <div className="field-error">{errors.building_id}</div>}
        </div>

        <label className="field">
          <span className="field-label">층·위치 (선택)</span>
          <input value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="예: B1, 3층 열람실" maxLength={30} />
          {errors.floor && <div className="field-error">{errors.floor}</div>}
        </label>

        <label className="field">
          <span className="field-label">제목 (선택)</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
          />
          {errors.title && <div className="field-error">{errors.title}</div>}
        </label>

        <label className="field">
          <span className="field-label">내용 *</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="무엇이, 어디서, 어떻게 안 되나요?"
            rows={5}
            maxLength={2000}
            aria-invalid={!!errors.body}
          />
          {errors.body && <div className="field-error">{errors.body}</div>}
        </label>

        <SimilarPanel
          similar={similar}
          busy={busy}
          onJoin={(id) => void submit(id)}
          onOpen={openCandidate}
          onRetry={() => setRetryKey((k) => k + 1)}
        />
        {errors.target_topic_id && <div className="field-error">{errors.target_topic_id}</div>}

        <div className="field">
          <div className="row between">
            <span className="field-label">사진 (선택)</span>
            <span className="muted small">
              {photos.length}/{PHOTO_MAX}
            </span>
          </div>
          <div className="photo-row">
            {previews.map((url, i) => (
              <div key={url} className="photo-preview">
                <img src={url} alt={`첨부 사진 ${i + 1}`} />
                <button
                  type="button"
                  className="photo-remove"
                  aria-label="사진 빼기"
                  onClick={() => {
                    setPhotos(photos.filter((_, j) => j !== i));
                    setPhotoError(null);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            {photos.length < PHOTO_MAX && (
              <button type="button" className="photo-add" onClick={() => fileInput.current?.click()}>
                + 사진
                <span className="small muted">JPG·PNG, 5MB</span>
              </button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png"
            hidden
            onChange={(e) => onPickPhotos(e.target.files)}
          />
          {photoError && <div className="field-error">{photoError}</div>}
          {/* REQ-LEG-03 */}
          <p className="muted small">다른 사람이 알아볼 수 있는 사진은 피해 주세요.</p>
        </div>

        {formError && <div className="banner warn">{formError}</div>}

        <button className="submit-pill" disabled={busy}>
          {busy ? "등록하는 중…" : candidates.length > 0 ? "새 의제로 등록" : "등록하기"}
        </button>
      </form>
      </div>
    </div>
  );
}

/**
 * 유사 의제 확인 영역 (REQ-UI-20). 작성 중인 본문과 구분된 곳에 후보를 보여주고,
 * 사용자가 고르기 전에는 연결된 것처럼 표시하지 않는다.
 */
function SimilarPanel({
  similar,
  busy,
  onJoin,
  onOpen,
  onRetry,
}: {
  similar: Similar;
  busy: boolean;
  onJoin: (topicId: number) => void;
  onOpen: (topicId: number) => void;
  onRetry: () => void;
}) {
  if (similar.state === "idle") return null;
  if (similar.state === "searching") {
    return (
      <div className="similar-box searching small" aria-live="polite">
        <span className="search-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        비슷한 의제를 찾는 중
      </div>
    );
  }
  if (similar.state === "failed") {
    // 검색 실패는 '유사 의제 없음'으로 표시하지 않는다 (REQ-SIM-09)
    return (
      <div className="similar-box failed" aria-live="polite">
        <span className="small">추천을 불러오지 못했어요.</span>
        <button type="button" className="btn small" onClick={onRetry}>
          다시 찾기
        </button>
      </div>
    );
  }
  if (similar.candidates.length === 0) {
    return (
      <div className="similar-box muted small" aria-live="polite">
        비슷한 의제가 없어요.
      </div>
    );
  }
  return (
    <section className="similar-box found" aria-live="polite">
      <h2>비슷한 의제가 있어요</h2>
      <ul className="similar-list">
        {similar.candidates.map((c, i) => {
          const t = c.topic;
          return (
            <li
              key={t.id}
              className="similar-item"
              style={{ animationDelay: `${120 + i * 90}ms` }}
              role="link"
              tabIndex={0}
              title="의제 상세 보기"
              onClick={() => onOpen(t.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onOpen(t.id);
              }}
            >
              <div className="row gap wrap">
                <span className={`chip type-${t.type}`}>Issue</span>
                <span className={`chip relation-${c.relation}`}>
                  {c.relation === "same" ? "같은 문제" : "관련 있음"}
                </span>
              </div>
              <div className="similar-title">{t.title}</div>
              <div className="muted small">{placeLabel(t)}</div>
              <div className="small">
                경험 {t.counts.experienced}명 | 공감 {t.counts.needs_improvement}명 | Report {t.report_count}건
              </div>
              <div className="muted small">일치: {c.matched.join(", ")}</div>
              <button
                type="button"
                className="pill join-topic"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  onJoin(t.id);
                }}
              >
                이 의제에 리포트 통합하기
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
