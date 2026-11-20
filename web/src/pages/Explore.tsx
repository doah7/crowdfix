import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type Building, type Status, type TopicSummary, type TopicType } from "../api";
import { CampusMap, groupByBuilding } from "../components/CampusMap";
import { Header } from "../components/Header";
import { TopicCard } from "../components/TopicCard";
import { STATUS_LABEL, TYPE_HINT, TYPE_LABEL } from "../labels";

const STATUSES: Status[] = ["backlog", "in_progress", "done"];

type Load<T> = { state: "loading" } | { state: "error" } | { state: "ok"; data: T };

/**
 * 탐색 화면 (지도·목록). 검색어·필터·선택은 URL에 두어 지도↔목록 전환이나
 * 상세 화면에서 돌아와도 유지된다 (REQ-UI-09).
 */
export function Explore() {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "list" ? "list" : "map";
  const statusFilter = (params.get("status")?.split(",").filter(Boolean) ?? []) as Status[];
  const tab: TopicType = params.get("tab") === "proposal" ? "proposal" : "issue";
  const sort = params.get("sort") === "participants" ? "participants" : "latest";
  const selectedBuilding = params.get("b") ? Number(params.get("b")) : null;

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === "") next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const [topics, setTopics] = useState<Load<TopicSummary[]>>({ state: "loading" });
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [mapFailed, setMapFailed] = useState(false);

  const statusKey = statusFilter.join(",");
  useEffect(() => {
    let alive = true;
    setTopics({ state: "loading" });
    const qs = new URLSearchParams({ sort });
    for (const s of statusKey.split(",").filter(Boolean)) qs.append("status", s);
    api<TopicSummary[]>(`/api/topics?${qs}`)
      .then((data) => alive && setTopics({ state: "ok", data }))
      .catch(() => alive && setTopics({ state: "error" }));
    return () => {
      alive = false;
    };
  }, [statusKey, sort, reloadKey]);

  useEffect(() => {
    api<Building[]>("/api/buildings").then(setBuildings).catch(() => setBuildings([]));
  }, []);

  const all = topics.state === "ok" ? topics.data : [];
  const groups = useMemo(() => groupByBuilding(all), [all]);
  const building = buildings.find((b) => b.id === selectedBuilding) ?? null;
  const focus = useMemo<[number, number] | null>(
    () => (building ? [building.latitude, building.longitude] : null),
    [building],
  );

  function toggleStatus(s: Status) {
    const next = statusFilter.includes(s) ? statusFilter.filter((x) => x !== s) : [...statusFilter, s];
    update({ status: next.join(",") || null });
  }

  return (
    <div className="app-shell explore">
      <Header />

      <div className="filters">
        <BuildingSearch
          buildings={buildings}
          selected={building}
          onSelect={(id) => update({ b: id === null ? null : String(id) })}
        />
        <div className="chips-row" role="group" aria-label="처리 상태 필터">
          <button
            className={`filter-chip ${statusFilter.length === 0 ? "on" : ""}`}
            onClick={() => update({ status: null })}
          >
            전체
          </button>
          {STATUSES.map((s) => (
            <button
              key={s}
              className={`filter-chip ${statusFilter.includes(s) ? "on" : ""}`}
              aria-pressed={statusFilter.includes(s)}
              onClick={() => toggleStatus(s)}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <main className="explore-body">
        {topics.state === "error" ? (
          <div className="state-box">
            <p>의제를 불러오지 못했어요.</p>
            <button className="btn" onClick={() => setReloadKey((k) => k + 1)}>
              다시 시도
            </button>
          </div>
        ) : view === "map" ? (
          <MapPane
            loading={topics.state === "loading"}
            groups={groups}
            allLocated={all.filter((t) => t.building)}
            building={building}
            focus={focus}
            mapFailed={mapFailed}
            onTileError={() => setMapFailed(true)}
            onSelect={(id) => update({ b: String(id) })}
            onClear={() => update({ b: null })}
            onGoList={() => update({ view: "list" })}
          />
        ) : (
          <ListPane
            loading={topics.state === "loading"}
            topics={all.filter((t) => t.type === tab && (!building || t.building?.id === building.id))}
            tab={tab}
            sort={sort}
            building={building}
            onTab={(t) => update({ tab: t === "issue" ? null : t })}
            onSort={(s) => update({ sort: s === "latest" ? null : s })}
            onClearBuilding={() => update({ b: null })}
          />
        )}
      </main>

      {/* 지도·목록 전환 수단은 스크롤과 관계없이 표시한다 (REQ-UI-03) */}
      <nav className="bottom-nav">
        <button className={view === "map" ? "on" : ""} onClick={() => update({ view: null })}>
          지도
        </button>
        <button className={view === "list" ? "on" : ""} onClick={() => update({ view: "list" })}>
          목록
        </button>
      </nav>
    </div>
  );
}

function MapPane(props: {
  loading: boolean;
  groups: ReturnType<typeof groupByBuilding>;
  allLocated: TopicSummary[];
  building: Building | null;
  focus: [number, number] | null;
  mapFailed: boolean;
  onTileError: () => void;
  onSelect: (id: number) => void;
  onClear: () => void;
  onGoList: () => void;
}) {
  const { building } = props;
  const shown = building ? props.allLocated.filter((t) => t.building?.id === building.id) : props.allLocated;

  return (
    <>
      <div className="map-box">
        <CampusMap
          groups={props.groups}
          selectedId={building?.id ?? null}
          focus={props.focus}
          onSelect={props.onSelect}
          onTileError={props.onTileError}
        />
        {props.mapFailed && (
          // 지도를 불러오지 못하면 목록으로 전환할 수 있게 한다 (FR-NAV-14)
          <div className="map-error">
            <span>지도를 불러오지 못했어요.</span>
            <button className="btn small" onClick={props.onGoList}>
              목록으로 보기
            </button>
          </div>
        )}
      </div>

      <section className="sheet">
        <div className="sheet-head">
          {building ? (
            <>
              <h2>{building.name_ko}</h2>
              <button className="link-btn" onClick={props.onClear}>
                전체 보기
              </button>
            </>
          ) : (
            <h2>지도에 표시된 의제 {props.loading ? "" : `${shown.length}건`}</h2>
          )}
        </div>
        {props.loading ? (
          <p className="muted">불러오는 중…</p>
        ) : shown.length === 0 ? (
          <EmptyPlace building={building} />
        ) : (
          <div className="card-list">
            {shown.map((t) => (
              <TopicCard key={t.id} topic={t} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function ListPane(props: {
  loading: boolean;
  topics: TopicSummary[];
  tab: TopicType;
  sort: string;
  building: Building | null;
  onTab: (t: TopicType) => void;
  onSort: (s: "latest" | "participants") => void;
  onClearBuilding: () => void;
}) {
  return (
    <section className="list-pane">
      <div className="tabs" role="tablist">
        {(["issue", "proposal"] as TopicType[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={props.tab === t}
            className={props.tab === t ? "on" : ""}
            onClick={() => props.onTab(t)}
          >
            {TYPE_LABEL[t]}
            <span className="tab-hint">{TYPE_HINT[t]}</span>
          </button>
        ))}
      </div>
      <div className="list-tools">
        {props.building ? (
          <span className="small">
            {props.building.name_ko}{" "}
            <button className="link-btn" onClick={props.onClearBuilding}>
              해제
            </button>
          </span>
        ) : (
          <span />
        )}
        <select
          value={props.sort}
          onChange={(e) => props.onSort(e.target.value as "latest" | "participants")}
          aria-label="정렬"
        >
          <option value="latest">최신 등록순</option>
          <option value="participants">고유 참여 인원순</option>
        </select>
      </div>
      {props.loading ? (
        <p className="muted">불러오는 중…</p>
      ) : props.topics.length === 0 ? (
        props.building ? (
          <EmptyPlace building={props.building} />
        ) : (
          <div className="state-box">조건에 맞는 의제가 없어요. 필터를 바꿔 보세요.</div>
        )
      ) : (
        <div className="card-list">
          {props.topics.map((t) => (
            <TopicCard key={t.id} topic={t} />
          ))}
        </div>
      )}
    </section>
  );
}

// 의제가 없는 장소 (FR-NAV-12)
function EmptyPlace({ building }: { building: Building | null }) {
  if (!building) return <div className="state-box">조건에 맞는 의제가 없어요. 필터를 바꿔 보세요.</div>;
  return (
    <div className="state-box">
      <p>
        <strong>{building.name_ko}</strong>에 등록된 문제가 없어요.
      </p>
      <p className="muted small">등록된 문제가 없다고 해서 시설이 정상 작동한다는 뜻은 아니에요.</p>
    </div>
  );
}

function BuildingSearch({
  buildings,
  selected,
  onSelect,
}: {
  buildings: Building[];
  selected: Building | null;
  onSelect: (id: number | null) => void;
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
        value={q}
        placeholder="건물·장소 검색 (예: 삼성학술정보관, 248)"
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
