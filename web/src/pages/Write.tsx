import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, FieldErrors, api, createReport, newRequestId, type Building } from "../api";
import { BuildingSearch } from "../components/BuildingSearch";
import { Header } from "../components/Header";

// 사진 제한 (데모 문서 TBD-09). 서버에서도 같은 기준으로 다시 검사한다.
const PHOTO_MAX = 1;
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png"];

/** Report 작성 (SRS 3.1.6, 4.2). 데모 범위에서 등록은 Issue만 다룬다. */
export function WritePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingId, setBuildingId] = useState<number | null>(params.get("b") ? Number(params.get("b")) : null);
  const [floor, setFloor] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 한 번 작성한 글은 다시 보내도 같은 요청으로 처리된다 (REQ-REG-12)
  const requestId = useRef(newRequestId());
  const fileInput = useRef<HTMLInputElement>(null);

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
      <div className="detail-nav">
        <button className="link-btn" onClick={() => navigate(-1)}>
          ← 취소
        </button>
      </div>

      <form className="write-body" onSubmit={onSubmit} noValidate>
        <div className="type-guide">
          <span className="chip type-issue">Issue</span>
          <span className="small">
            <strong>지금 겪고 있는 문제</strong>를 알려 주세요. 원하는 제도·행사 변화는 Proposal이에요.
          </span>
        </div>

        <div className="field">
          <span className="field-label">장소 *</span>
          <BuildingSearch
            buildings={buildings}
            selected={building}
            onSelect={setBuildingId}
            placeholder="건물 이름이나 번호로 찾기 (예: 디도, 248)"
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
            placeholder="비워 두면 내용 첫 줄을 제목으로 써요"
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
          <p className="muted small">다른 사람을 알아볼 수 있는 사진은 올리지 말아 주세요. 사진의 위치 정보는 저장하지 않아요.</p>
        </div>

        {formError && <div className="banner warn">{formError}</div>}

        <button className="btn primary block" disabled={busy}>
          {busy ? "등록하는 중…" : "등록하기"}
        </button>
      </form>
    </div>
  );
}
