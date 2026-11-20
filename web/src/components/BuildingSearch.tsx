import { useMemo, useState } from "react";
import type { Building } from "../api";

// 학생들이 흔히 부르는 별칭 (건물 번호 기준)
const ALIASES: Record<string, string[]> = {
  "248": ["디도", "도서관"],
  "203": ["학관"],
};

/** 건물·장소 검색 (자연과학캠퍼스 전체). 탐색 화면과 글쓰기 화면이 함께 쓴다. */
export function BuildingSearch({
  buildings,
  selected,
  onSelect,
  placeholder = "건물·시설 검색",
  invalid = false,
}: {
  buildings: Building[];
  selected: Building | null;
  onSelect: (id: number | null) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return buildings
      .filter(
        (b) =>
          b.name_ko.toLowerCase().includes(s) ||
          b.name_en.toLowerCase().includes(s) ||
          (ALIASES[b.build_no ?? ""] ?? []).some((a) => a.includes(s)) ||
          (b.build_no ?? "").startsWith(s),
      )
      .slice(0, 8);
  }, [q, buildings]);

  if (selected) {
    return (
      <div className="search selected">
        <span>📍 {selected.name_ko}</span>
        <button className="link-btn" onClick={() => onSelect(null)} aria-label="장소 선택 해제">
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="search">
      <input
        aria-invalid={invalid}
        value={q}
        placeholder={placeholder}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        aria-label="건물·장소 검색"
      />
      {open && matches.length > 0 && (
        <ul className="suggest">
          {matches.map((b) => (
            <li key={b.id}>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(b.id);
                  setQ("");
                  setOpen(false);
                }}
              >
                <span>{b.name_ko}</span>
                <span className="muted small">
                  {b.build_no ?? ""} {b.topic_count > 0 ? `· 의제 ${b.topic_count}건` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
