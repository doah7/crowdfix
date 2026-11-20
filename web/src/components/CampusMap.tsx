import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import type { TopicSummary } from "../api";

const CAMPUS_CENTER: [number, number] = [37.2939, 126.9752];

export interface MarkerGroup {
  buildingId: number;
  name: string;
  lat: number;
  lng: number;
  topics: TopicSummary[];
}

/** 같은 건물의 의제는 하나의 묶음 마커로 표시한다 (FR-NAV-02). */
export function groupByBuilding(topics: TopicSummary[]): MarkerGroup[] {
  const map = new Map<number, MarkerGroup>();
  for (const t of topics) {
    if (!t.building) continue; // 위치 없는 의제는 지도에 표시하지 않는다 (FR-NAV-05)
    const g = map.get(t.building.id) ?? {
      buildingId: t.building.id,
      name: t.building.name_ko,
      lat: t.building.latitude,
      lng: t.building.longitude,
      topics: [],
    };
    g.topics.push(t);
    map.set(t.building.id, g);
  }
  return [...map.values()];
}

const ISSUE = "#ee6a4b";
const PROPOSAL = "#4f6bed";
// 배지의 숫자가 '사람 수'임을 보여주는 작은 사람 아이콘
const PERSON_ICON = `<svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true">
  <circle cx="12" cy="7.5" r="4.5" fill="currentColor"/>
  <path d="M3.5 21c0-4.4 3.8-7.5 8.5-7.5s8.5 3.1 8.5 7.5z" fill="currentColor"/></svg>`;

function pinSvg(color: string, cls: string) {
  return `<svg class="pin ${cls}" viewBox="0 0 32 42" aria-hidden="true">
    <path d="M16 1C7.7 1 1 7.6 1 15.8 1 27 16 41 16 41s15-14 15-25.2C31 7.6 24.3 1 16 1z" fill="${color}"/>
    <circle cx="16" cy="34" r="2.3" fill="#fff"/></svg>`;
}

/**
 * 건물 마커: 핀 안에 의제 수, 오른쪽 위 배지에 고유 참여 인원 합계 (FR-NAV-02).
 * Issue는 주황, Proposal은 파랑. 한 건물에 둘 다 있으면 파랑 핀을 뒤에 겹쳐 보여준다 (FR-NAV-01).
 */
function markerIcon(g: MarkerGroup, selected: boolean) {
  const people = g.topics.reduce((s, t) => s + t.counts.unique, 0);
  const hasIssue = g.topics.some((t) => t.type === "issue");
  const hasProposal = g.topics.some((t) => t.type === "proposal");
  const back = hasIssue && hasProposal ? pinSvg(PROPOSAL, "back") : "";
  const front = pinSvg(hasIssue ? ISSUE : PROPOSAL, "front");
  const html = `
    <div class="pin-stack ${selected ? "selected" : ""}">
      ${back}${front}
      <span class="pin-count">${g.topics.length}</span>
      <span class="pin-badge">${PERSON_ICON}<span class="num">${people}</span></span>
    </div>`;
  // 앞 핀의 뾰족한 끝이 건물 좌표를 가리킨다
  return L.divIcon({ html, className: "marker-wrap", iconSize: [66, 54], iconAnchor: [26, 51] });
}

/** 처음 열 때 의제가 있는 건물이 모두 보이도록 화면을 맞춘다. */
function FitOnce({ groups, skip }: { groups: MarkerGroup[]; skip: boolean }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || skip || groups.length === 0) return;
    done.current = true;
    map.invalidateSize();
    const bounds = L.latLngBounds(groups.map((g) => [g.lat, g.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 17 });
  }, [map, groups, skip]);
  return null;
}

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, Math.max(map.getZoom(), 17), { duration: 0.4 });
  }, [map, target]);
  return null;
}

export function CampusMap({
  groups,
  selectedId,
  focus,
  onSelect,
  onTileError,
  onReady,
}: {
  groups: MarkerGroup[];
  selectedId: number | null;
  focus: [number, number] | null;
  onSelect: (buildingId: number) => void;
  onTileError: () => void;
  onReady?: () => void;
}) {
  const icons = useMemo(
    () => new Map(groups.map((g) => [g.buildingId, markerIcon(g, g.buildingId === selectedId)])),
    [groups, selectedId],
  );

  return (
    <MapContainer center={CAMPUS_CENTER} zoom={17} minZoom={15} maxZoom={19} className="map" zoomControl={false}>
      {/* 지도 타일 제공처의 출처를 지도 위에 표시한다 (REQ-COM-07) */}
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        maxZoom={19}
        eventHandlers={{ tileerror: onTileError, load: () => onReady?.() }}
      />
      {groups.map((g) => (
        <Marker
          key={g.buildingId}
          position={[g.lat, g.lng]}
          icon={icons.get(g.buildingId)}
          eventHandlers={{ click: () => onSelect(g.buildingId) }}
          title={`${g.name} 의제 ${g.topics.length}건`}
        />
      ))}
      <FitOnce groups={groups} skip={focus !== null} />
      <FlyTo target={focus} />
    </MapContainer>
  );
}
