import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { SelectMenu } from "./SelectMenu";
import { CancelRideButton } from "./CancelRideButton";
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Compass,
  Heart,
  LifeBuoy,
  MapPin,
  MessageCircle,
  Mountain,
  Plus,
  Route,
  Search,
  Share2,
  ShieldCheck,
  Star,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
const AdminPanel = lazy(() => import("./AdminPanel"));
import { auth } from "./firebase";
import { buildRideStart, filterPublicRides, validateRideContent } from "./domain";
import { geocodePlace, loadKakaoMaps, searchCoursePois, searchPlaces, type PlaceSearchResult } from "./kakao";
import {
  bootstrapAdmin,
  createRideReview,
  createRidePlan,
  finishPublicRide,
  getRideDetails,
  getRiderSettings,
  getRideWeather,
  joinPublicRide,
  leavePublicRide,
  listFavoriteRides,
  listMyRidePlans,
  listPublicRides,
  listRideLiveLocations,
  listRideMessages,
  reportUser,
  repairRideCourse,
  removeRideFromMyList,
  requestCourseCandidates,
  requestManualRoute,
  saveRiderSettings,
  sendRideMessage,
  setFavoriteRide,
  setUserBlocked,
  startPublicRide,
  trackProductEvent,
  updateLiveLocation,
  updateCourseStops,
  type RideMessage,
  type RidePlanInput,
  type RiderSettings,
  type StoredRidePlan,
} from "./services";
import type { ClimbSegment, Coordinate, ElevationPoint, LiveLocation, Ride, RouteCandidate, Stop } from "./types";

type Tab = "home" | "courses" | "create" | "my" | "profile";
const fmt = (value: string) => !Number.isFinite(new Date(value).getTime()) ? "일정 미정" :
  new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
const estimatedMinutes = (distanceKm: number, paceKmh: number) =>
  Math.max(1, Math.round((distanceKm / Math.max(paceKmh, 1)) * 60));
const formatDuration = (minutes: number) =>
  minutes >= 60
    ? `${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ""}`
    : `${minutes}분`;
const routeColors = ["#087458", "#ef7d5f", "#4e65c5"];
const emptyStops: Stop[] = [];
const emptyCoordinates: Coordinate[] = [];
const emptyLocations: LiveLocation[] = [];
const facilityMeta = {
  편의점: { icon: "🏪", className: "convenience" },
  화장실: { icon: "🚻", className: "restroom" },
  정비소: { icon: "🔧", className: "repair" },
  휴식: { icon: "●", className: "rest" },
} as const;
type SavedPlan = StoredRidePlan & {
  distanceKm?: number;
  elevationM?: number;
  startName?: string;
};
const readPlans = (): SavedPlan[] => {
  try {
    const legacy = JSON.parse(
      localStorage.getItem("ridemate-plans") ?? "[]",
    ) as Array<Partial<SavedPlan> & { distanceKm?: number; elevationM?: number; startName?: string }>;
    return legacy.flatMap((plan) =>
      plan.id && plan.title && plan.purpose
        ? [{
            id: plan.id,
            title: plan.title,
            purpose: plan.purpose,
            status: plan.status ?? "계획",
            createdAt: plan.createdAt,
            course: plan.course ?? {
              startName: plan.startName,
              distanceKm: plan.distanceKm,
              elevationM: plan.elevationM,
            },
          }]
        : [],
    );
  } catch {
    return [];
  }
};
const startsAtFrom = (form: FormData) => {
  const date = String(form.get("rideDate") ?? "");
  if (!date) return undefined;
  return buildRideStart(
    date,
    String(form.get("ridePeriod")),
    Number(form.get("rideHour") ?? 8),
    String(form.get("rideMinute") ?? "00"),
  );
};

const recoverStoredRoute = async (
  startName: string,
  endName: string,
  distanceKm: number,
) => {
  const start = await geocodePlace(startName);
  if (endName && endName !== startName) {
    try {
      const end = await geocodePlace(endName);
      return await requestManualRoute(
        { lat: start.lat, lng: start.lng },
        { lat: end.lat, lng: end.lng },
      );
    } catch {
      /* 예전 추천 코스는 도착지에 후보명이 저장돼 장소 검색이 불가능할 수 있습니다. */
    }
  }
  const targetDistance = Math.min(200, Math.max(5, Number(distanceKm) || 20));
  const candidates = await requestCourseCandidates({
    start: { lat: start.lat, lng: start.lng },
    startName,
    distanceKm: targetDistance,
    uphill: "medium",
    tripType: "round",
  });
  const candidate = candidates[0];
  if (!candidate?.coordinates?.length)
    throw new Error("복구할 자전거 경로를 찾지 못했습니다.");
  return candidate;
};

function PlacePicker({
  name,
  label,
  placeholder,
}: {
  name: string;
  label: string;
  placeholder: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [selected, setSelected] = useState<PlaceSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searched, setSearched] = useState(false);
  const [retry, setRetry] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setResults([]);
    setSearchError("");
    setSearched(false);
    setActiveIndex(-1);
    if (selected || query.trim().length < 2) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void searchPlaces(query)
        .then((rows) => { if (active) setResults(rows); })
        .catch((error: unknown) => { if (active) setSearchError(error instanceof Error ? error.message : "장소를 검색하지 못했습니다."); })
        .finally(() => { if (active) { setLoading(false); setSearched(true); } });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, selected, retry]);
  const listId = `${name}-place-results`;
  const selectPlace = (place: PlaceSearchResult) => {
    setSelected(place);
    setQuery(place.name);
    setResults([]);
    setTouched(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };
  return (
    <div className="place-field">
      <label htmlFor={`${name}-query`}>{label}</label>
      <div className={`place-input ${selected ? "confirmed" : ""}`}>
        <MapPin size={17} aria-hidden="true" />
        <input
          ref={inputRef}
          id={`${name}-query`}
          required
          autoComplete="off"
          value={query}
          placeholder={placeholder}
          role="combobox"
          aria-controls={listId}
          aria-expanded={results.length > 0}
          aria-autocomplete="list"
          aria-describedby={`${name}-place-help`}
          aria-activedescendant={activeIndex >= 0 && results[activeIndex] ? `${name}-option-${activeIndex}` : undefined}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setResults([]); setActiveIndex(-1); return; }
            if (!results.length) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const next = event.key === "ArrowDown" ? (activeIndex + 1) % results.length : (activeIndex <= 0 ? results.length - 1 : activeIndex - 1);
              setActiveIndex(next);
              document.getElementById(`${name}-option-${next}`)?.scrollIntoView({ block: "nearest" });
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (activeIndex >= 0) selectPlace(results[activeIndex]);
              else setActiveIndex(0);
            }
          }}
          onBlur={() => setTouched(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(null);
            setTouched(false);
          }}
        />
        {selected ? <CheckCircle2 className="place-confirmed" aria-label="장소 선택 완료" /> : loading ? <span className="place-loading">검색 중</span> : null}
      </div>
      <input type="hidden" name={name} value={selected?.name ?? ""} />
      <input type="hidden" name={`${name}Address`} value={selected?.address ?? ""} />
      <input type="hidden" name={`${name}Lat`} value={selected?.lat ?? ""} />
      <input type="hidden" name={`${name}Lng`} value={selected?.lng ?? ""} />
      {selected && (
        <div className="place-selection" role="status">
          <span><b>{selected.name}</b><small>{selected.address}</small></span>
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setQuery("");
              setTouched(false);
              window.setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            장소 변경
          </button>
        </div>
      )}
      {results.length > 0 && (
        <div className="place-results" id={listId} role="listbox" aria-label={`${label} 검색 결과`}>
          {results.map((place, index) => (
            <button
              id={`${name}-option-${index}`}
              type="button"
              role="option"
              aria-selected={activeIndex === index}
              key={place.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectPlace(place)}
            >
              <b>{place.name}</b><span>{place.address}</span><small>{place.category}</small>
            </button>
          ))}
        </div>
      )}
      <div className="place-help" id={`${name}-place-help`} role="status">
        {!selected && searchError ? <><span>{searchError}</span><button type="button" className="text-button" onClick={() => setRetry((value) => value + 1)}>다시 검색</button></> :
          !selected && searched && !loading && !results.length ? "검색 결과가 없습니다. 지역과 장소명을 함께 입력해 주세요. 예: 서울 양재 시민의숲" :
          !selected && query.trim().length < 2 ? "두 글자 이상 입력하고 검색 결과에서 주소를 확인해 선택하세요." :
          !selected && results.length > 0 ? `${results.length}개 장소를 찾았습니다. 방향키와 Enter로도 선택할 수 있어요.` : null}
      </div>
      {touched && query && !selected && !loading && (
        <small className="place-warning">검색 결과에서 정확한 장소를 선택해 주세요.</small>
      )}
    </div>
  );
}

function RouteFallback({
  routes,
  selected,
  stops,
}: {
  routes: Coordinate[][];
  selected: number;
  stops: Stop[];
}) {
  const points = routes.flat();
  if (points.length < 2) return null;
  const minLat = Math.min(...points.map((point) => point.lat));
  const maxLat = Math.max(...points.map((point) => point.lat));
  const minLng = Math.min(...points.map((point) => point.lng));
  const maxLng = Math.max(...points.map((point) => point.lng));
  const latRange = Math.max(maxLat - minLat, 0.0001);
  const lngRange = Math.max(maxLng - minLng, 0.0001);
  const project = (point: Coordinate) =>
    `${24 + ((point.lng - minLng) / lngRange) * 552},${18 + ((maxLat - point.lat) / latRange) * 214}`;
  const stopColor: Record<string, string> = {
    편의점: "#087458",
    화장실: "#2874c6",
    정비소: "#d76527",
    휴식: "#626d68",
  };
  return (
    <svg
      className="route-fallback"
      viewBox="0 0 600 250"
      role="img"
      aria-label="배경 지도 없이 표시한 자전거 경로 미리보기"
    >
      <rect width="600" height="250" rx="16" />
      {routes.map((route, index) => (
        <polyline
          key={`fallback-${index}`}
          points={route.map(project).join(" ")}
          stroke={routeColors[index] ?? "#59666f"}
          strokeWidth={index === selected ? 7 : 4}
          opacity={index === selected ? 1 : 0.55}
        />
      ))}
      {stops.map((stop) => {
        const [cx, cy] = project(stop.coordinate).split(",");
        return (
          <circle
            key={`fallback-stop-${stop.id}`}
            cx={cx}
            cy={cy}
            r="6"
            fill={stopColor[stop.kind]}
            stroke="#fff"
            strokeWidth="2"
          />
        );
      })}
    </svg>
  );
}

function CourseMap({
  routes,
  selected = 0,
  label = "코스 지도",
  stops = emptyStops,
  climbSegments = [],
  liveLocations = emptyLocations,
  missingRouteMessage = "이 라이딩에는 경로 좌표가 저장되어 있지 않습니다.",
}: {
  routes: Coordinate[][];
  selected?: number;
  label?: string;
  stops?: Stop[];
  climbSegments?: ClimbSegment[];
  liveLocations?: LiveLocation[];
  missingRouteMessage?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [message, setMessage] = useState("카카오맵 불러오는 중…");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setStatus("loading");
    if (!routes.some((route) => route.length)) {
      setStatus("error");
      setMessage(missingRouteMessage);
      return () => {
        active = false;
      };
    }
    loadKakaoMaps()
      .then((kakao) => {
        if (!active || !container.current) return;
        const first = routes.find((route) => route.length)![0];
        const map = new kakao.maps.Map(container.current, {
          center: new kakao.maps.LatLng(first.lat, first.lng),
          level: 8,
        });
        const bounds = new kakao.maps.LatLngBounds();
        routes.forEach((route, index) => {
          const path = route.map((point) => {
            const latLng = new kakao.maps.LatLng(point.lat, point.lng);
            bounds.extend(latLng);
            return latLng;
          });
          new kakao.maps.Polyline({
            path,
            strokeWeight: index === selected ? 7 : 4,
            strokeColor: routeColors[index] ?? "#59666f",
            strokeOpacity: index === selected ? 0.95 : 0.55,
          }).setMap(map);
        });
        climbSegments.forEach((segment) => {
          if (segment.coordinates.length < 2) return;
          new kakao.maps.Polyline({
            path: segment.coordinates.map(
              (point) => new kakao.maps.LatLng(point.lat, point.lng),
            ),
            strokeWeight: 8,
            strokeColor: "#d92d20",
            strokeOpacity: 0.9,
          }).setMap(map);
        });
        const route = routes[selected] ?? routes[0];
        if (route?.length) {
          new kakao.maps.Marker({
            position: new kakao.maps.LatLng(route[0].lat, route[0].lng),
            map,
            title: "출발",
          });
          const last = route[route.length - 1];
          new kakao.maps.Marker({
            position: new kakao.maps.LatLng(last.lat, last.lng),
            map,
            title: "도착",
          });
        }
        stops.forEach((stop) => {
          const meta = facilityMeta[stop.kind];
          const marker = document.createElement("div");
          marker.className = `facility-marker ${meta.className}`;
          marker.title = `${stop.kind} · ${stop.name}`;
          marker.tabIndex = 0;
          marker.setAttribute("role", "button");
          marker.setAttribute("aria-label", `${stop.kind} ${stop.name}`);
          const icon = document.createElement("span");
          icon.className = "facility-marker-icon";
          icon.textContent = meta.icon;
          const name = document.createElement("span");
          name.className = "facility-marker-name";
          name.textContent = stop.name;
          marker.append(icon, name);
          const toggleName = () => marker.classList.toggle("expanded");
          marker.addEventListener("click", (event) => {
            event.stopPropagation();
            toggleName();
          });
          marker.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggleName();
            }
          });
          new kakao.maps.CustomOverlay({
            position: new kakao.maps.LatLng(stop.coordinate.lat, stop.coordinate.lng),
            content: marker,
            yAnchor: 1.15,
            zIndex: stop.kind === "정비소" ? 5 : 4,
          }).setMap(map);
        });
        liveLocations.forEach((location) => {
          const marker = document.createElement("div");
          marker.className = "rider-location-marker";
          marker.setAttribute("aria-label", `${location.name}의 최근 위치`);
          marker.title = `${location.name} · 최근 공유 위치`;
          marker.textContent = location.name.slice(0, 1);
          new kakao.maps.CustomOverlay({
            position: new kakao.maps.LatLng(location.coordinate.lat, location.coordinate.lng),
            content: marker,
            yAnchor: 1.15,
            zIndex: 8,
          }).setMap(map);
        });
        map.setBounds(bounds);
        if (active) setStatus("ready");
      })
      .catch((error) => {
        if (active) {
          setStatus("error");
          setMessage(
            error instanceof Error
              ? error.message
              : "지도를 불러오지 못했습니다.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [routes, selected, stops, climbSegments, liveLocations, attempt, missingRouteMessage]);
  const hasRoute = routes.some((route) => route.length);
  return (
    <div
      className={`map live-map ${status === "error" ? "map-error" : ""}`}
      ref={container}
      role="region"
      aria-label={label}
      aria-busy={status === "loading"}
    >
      {status !== "ready" && (
        <div className="map-state" aria-live="polite">
          <b>{status === "error" ? "지도를 표시할 수 없어요" : message}</b>
          {status === "error" && (
            <>
              {hasRoute && <RouteFallback routes={routes} selected={selected} stops={stops} />}
              <small>
                {message}
                {hasRoute && (
                  <>
                    <br />
                    카카오맵 대신 경로 미리보기를 표시합니다. 잠시 후 다시 시도해 주세요.
                  </>
                )}
              </small>
              {hasRoute && (
                <button
                  type="button"
                  className="secondary map-retry"
                  onClick={() => {
                    setMessage("카카오맵 다시 불러오는 중…");
                    setAttempt((value) => value + 1);
                  }}
                >
                  지도 다시 불러오기
                </button>
              )}
            </>
          )}
        </div>
      )}
      {status === "ready" && (
        <>
          <span className="map-label">카카오맵 위 · 자전거 경로</span>
          <span className="cycle-badge">자동차 길찾기 아님 · ORS cycling</span>
          {climbSegments.length > 0 && <span className="uphill-legend">빨간색 · 업힐 구간</span>}
          {stops.length > 0 && (
            <span className="facility-legend" aria-label="편의시설 지도 범례">
              <i className="convenience">🏪 편의점</i>
              <i className="restroom">🚻 화장실</i>
              <i className="repair">🔧 정비점</i>
            </span>
          )}
          {liveLocations.length > 0 && <span className="live-rider-count">● 위치 공유 {liveLocations.length}명</span>}
        </>
      )}
    </div>
  );
}

function FacilityList({ stops, loading = false, compact = false }: { stops: Stop[]; loading?: boolean; compact?: boolean }) {
  if (loading) return <p className="muted">편의점·화장실·자전거 정비점 찾는 중…</p>;
  if (!stops.length) return <p className="muted">코스 주변에서 확인된 편의시설이 없습니다.</p>;
  return (
    <div className={`facility-groups ${compact ? "compact" : ""}`}>
      {(["편의점", "화장실", "정비소", "휴식"] as const).map((kind) => {
        const rows = stops.filter((stop) => stop.kind === kind);
        if (!rows.length) return null;
        const meta = facilityMeta[kind];
        return (
          <section className={`facility-group ${meta.className}`} key={kind}>
            <h3><span>{meta.icon}</span>{kind === "정비소" ? "자전거 정비점" : kind === "휴식" ? "지정 휴식 지점" : kind}<small>{rows.length}곳</small></h3>
            <div>{rows.slice(0, compact ? 4 : undefined).map((stop) => <span key={stop.id} title={`${stop.name}${stop.distanceFromRouteM != null ? ` · 코스에서 ${stop.distanceFromRouteM}m` : ""}`}><b>{stop.name}</b>{stop.distanceFromRouteM != null && <small>코스에서 {stop.distanceFromRouteM}m</small>}</span>)}</div>
          </section>
        );
      })}
    </div>
  );
}

type FacilityFilterValue = "전체" | Stop["kind"];
const visibleFacilities = (stops: Stop[], filter: FacilityFilterValue) =>
  filter === "전체" ? stops : stops.filter(stop => stop.kind === filter);
function FacilityFilter({ stops, value, onChange }: { stops: Stop[]; value: FacilityFilterValue; onChange: (value: FacilityFilterValue) => void }) {
  const kinds: FacilityFilterValue[] = ["전체", "편의점", "화장실", "정비소", ...(stops.some(stop => stop.kind === "휴식") ? ["휴식" as const] : [])];
  return <div className="facility-filter" role="group" aria-label="주변 시설 필터">
    {kinds.map(kind => {
      const count = kind === "전체" ? stops.length : stops.filter(stop => stop.kind === kind).length;
      return <button type="button" key={kind} disabled={kind !== "전체" && count === 0} aria-pressed={value === kind} className={value === kind ? "active" : ""} onClick={() => onChange(kind)}>
        {kind === "정비소" ? "정비점" : kind}<span>{count}</span>
      </button>;
    })}
  </div>;
}

function ElevationChart({ points }: { points: ElevationPoint[] }) {
  points = points.filter(p => Number.isFinite(p.distanceKm) && Number.isFinite(p.elevationM) && p.distanceKm >= 0).sort((a, b) => a.distanceKm - b.distanceKm);
  if (points.length < 2) return null;
  const width = 420;
  const height = 145;
  const padX = 42;
  const padTop = 12;
  const padBottom = 24;
  const min = Math.min(...points.map((point) => point.elevationM));
  const max = Math.max(...points.map((point) => point.elevationM));
  const range = Math.max(max - min, 30);
  const ceiling = max + (range - (max - min)) / 2;
  const distance = Math.max(points.at(-1)?.distanceKm ?? 1, 0.001);
  const coordinates = points.map((point) => ({
    x: padX + (point.distanceKm / distance) * (width - padX * 2),
    y:
      padTop +
      ((ceiling - point.elevationM) / range) * (height - padTop - padBottom),
  }));
  const line = coordinates
    .map(
      (point, index) =>
        `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`,
    )
    .join(" ");
  const area = `${line} L${coordinates.at(-1)!.x},${height - padBottom} L${coordinates[0].x},${height - padBottom} Z`;
  return (
    <article className="elevation-card">
      <div>
        <b>고도 프로필</b>
        <span>
          최저 {Math.round(min)}m · 최고 {Math.round(max)}m
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`거리 ${distance.toFixed(1)}킬로미터, 최저 ${Math.round(min)}미터, 최고 ${Math.round(max)}미터의 고도 그래프`}
      >
        {[0, 0.5, 1].map(ratio => <g key={ratio}>
          <line x1={padX} x2={width - padX} y1={padTop + ratio * (height - padTop - padBottom)} y2={padTop + ratio * (height - padTop - padBottom)} stroke="currentColor" opacity="0.12" />
          <text x={padX - 5} y={padTop + ratio * (height - padTop - padBottom) + 4} textAnchor="end">{Math.round(ceiling - range * ratio)}m</text>
        </g>)}
        {[0, 0.25, 0.5, 0.75, 1].map(ratio => {
          const x = padX + ratio * (width - padX * 2);
          return <g key={`distance-${ratio}`}>
            <line x1={x} x2={x} y1={padTop} y2={height - padBottom} stroke="currentColor" opacity="0.08" />
            <text x={x} y={height - 6} textAnchor={ratio === 0 ? "start" : ratio === 1 ? "end" : "middle"}>{(distance * ratio).toFixed(ratio === 0 ? 0 : 1)}km</text>
          </g>;
        })}
        <path className="elevation-area" d={area} />
        <path className="elevation-line" d={line} />
      </svg>
    </article>
  );
}

function RideCard({ ride, onOpen }: { ride: Ride; onOpen: () => void }) {
  const memberCount = ride.memberCount ?? ride.members?.length ?? 1;
  const remaining = Math.max(0, ride.capacity - memberCount);
  return (
    <button
      className="ride-card"
      onClick={onOpen}
      aria-label={`${ride.title}, ${ride.course.startName}, ${ride.course.distanceKm}km, ${ride.status}, 참여 ${memberCount}/${ride.capacity}명`}
    >
      <div className="ride-date">
        <CalendarDays size={16} aria-hidden="true" />
        <time dateTime={ride.startsAt}>{fmt(ride.startsAt)}</time>
      </div>
      <h3>{ride.title}</h3>
      <p>
        {ride.course.startName} · {ride.course.distanceKm}km · 상승{" "}
        {ride.course.elevationM}m
      </p>
      <div className="ride-meta">
        <span>
          <Users size={16} aria-hidden="true" />
          {memberCount}/{ride.capacity}
        </span>
        <span>{ride.paceKmh}km/h</span>
        <span className={`open ${remaining === 0 ? "full" : ""}`}>
          {remaining > 0 ? `${remaining}자리 남음` : "모집 마감"}
        </span>
        <ChevronRight size={18} aria-hidden="true" />
      </div>
    </button>
  );
}

function RideDetail({
  ride: initialRide,
  onBack,
}: {
  ride: Ride;
  onBack: () => void;
}) {
  const [ride, setRide] = useState(initialRide);
  const [joined, setJoined] = useState(Boolean(initialRide.joined));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [chat, setChat] = useState<RideMessage[]>([]);
  const [chatText, setChatText] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.length]);
  const [favorite, setFavorite] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [liveLocations, setLiveLocations] = useState<LiveLocation[]>([]);
  const locationWatchRef = useRef<number | null>(null);
  const locationTimerRef = useRef<number | null>(null);
  const lastLocationSentRef = useRef(0);
  const [weather, setWeather] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const storedDetailRoute = ride.course.coordinates ?? emptyCoordinates;
  const [recoveredDetailRoute, setRecoveredDetailRoute] = useState<Coordinate[]>([]);
  const [detailRouteRecovery, setDetailRouteRecovery] = useState<"idle" | "loading" | "error">("idle");
  const [detailRouteMessage, setDetailRouteMessage] = useState("이 라이딩에는 경로 좌표가 저장되어 있지 않습니다.");
  const [detailStops, setDetailStops] = useState(ride.course.stops ?? emptyStops);
  const [editingStops, setEditingStops] = useState(false);
  const [selectedStopIds, setSelectedStopIds] = useState<string[]>(
    () => (ride.course.stops ?? []).filter((stop) => stop.selected).map((stop) => stop.id),
  );
  const [facilityFilter, setFacilityFilter] = useState<FacilityFilterValue>("전체");
  const [savingStops, setSavingStops] = useState(false);
  const detailRoute = storedDetailRoute.length >= 2 ? storedDetailRoute : recoveredDetailRoute;
  const detailMapRoutes = useMemo(
    () => [detailRoute],
    [detailRoute],
  );
  useEffect(() => {
    const storedStops = ride.course.stops ?? [];
    if (!storedStops.length) return;
    setDetailStops(storedStops);
    setSelectedStopIds(storedStops.filter((stop) => stop.selected).map((stop) => stop.id));
  }, [ride.course.stops]);
  useEffect(() => {
    if (storedDetailRoute.length >= 2 || recoveredDetailRoute.length >= 2) return;
    const startName = String(ride.course.startName ?? "").trim();
    const endName = String(ride.course.endName ?? "").trim();
    if (!startName) {
      setDetailRouteRecovery("error");
      setDetailRouteMessage("출발지 정보가 없어 경로를 자동 복구할 수 없습니다.");
      return;
    }
    let active = true;
    setDetailRouteRecovery("loading");
    void recoverStoredRoute(startName, endName, Number(ride.course.distanceKm ?? 0))
      .then(async (repaired) => {
        if (!active) return;
        setRecoveredDetailRoute(repaired.coordinates);
        setDetailRouteRecovery("idle");
        if (auth?.currentUser?.uid === ride.hostId)
          await repairRideCourse({ rideId: ride.id, ...repaired }).catch(() => undefined);
      })
      .catch(() => {
        if (!active) return;
        setDetailRouteRecovery("error");
        setDetailRouteMessage("기존 경로를 복구하지 못했습니다. 출발·도착지를 확인해 주세요.");
      });
    return () => {
      active = false;
    };
  }, [ride.id, ride.hostId, ride.course.startName, ride.course.endName, ride.course.distanceKm, storedDetailRoute, recoveredDetailRoute.length]);
  useEffect(() => {
    if (detailStops.length || detailRoute.length < 2) return;
    let active = true;
    void searchCoursePois(detailRoute)
      .then((rows) => active && setDetailStops(rows))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [detailRoute, detailStops.length]);
  useEffect(() => {
    void getRideDetails(initialRide.id)
      .then((next) => {
        setRide(next);
        setJoined(Boolean(next.joined));
      })
      .catch(() => undefined);
    if (auth?.currentUser)
      void listFavoriteRides()
        .then((ids) => setFavorite(ids.includes(initialRide.id)))
        .catch(() => undefined);
    void trackProductEvent("ride_view").catch(() => undefined);
  }, [initialRide.id]);
  useEffect(() => {
    if (!joined) {
      setChat([]);
      return;
    }
    let active = true;
    const refreshChat = async (initial = false) => {
      if (initial) setChatLoading(true);
      try {
        const messages = await listRideMessages(ride.id);
        if (!active) return;
        setChat((current) => {
          const currentLast = current.at(-1)?.id;
          const nextLast = messages.at(-1)?.id;
          return current.length === messages.length && currentLast === nextLast
            ? current
            : messages;
        });
        setChatError("");
      } catch {
        if (active) setChatError("대화를 새로 불러오지 못했습니다.");
      } finally {
        if (active && initial) setChatLoading(false);
      }
    };
    void refreshChat(true);
    const timer = window.setInterval(() => void refreshChat(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [joined, ride.id]);
  useEffect(() => {
    if (!joined || ride.status !== "진행중") {
      setLiveLocations([]);
      return;
    }
    let active = true;
    const refresh = () => void listRideLiveLocations(ride.id)
      .then((locations) => active && setLiveLocations(locations))
      .catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [joined, ride.id, ride.status]);
  useEffect(() => () => {
    if (locationWatchRef.current != null) navigator.geolocation.clearWatch(locationWatchRef.current);
    if (locationTimerRef.current != null) window.clearTimeout(locationTimerRef.current);
  }, []);
  useEffect(() => {
    const point = ride.course.coordinates?.[0];
    if (point)
      void getRideWeather(point)
        .then((value) =>
          setWeather(
            `${Math.round(value.temperature_2m ?? 0)}° · 바람 ${Math.round(value.wind_speed_10m ?? 0)}km/h · 강수 ${value.precipitation ?? 0}mm`,
          ),
        )
        .catch(() => undefined);
  }, [ride.course.coordinates]);
  const toggleJoin = async () => {
    if (!auth?.currentUser) return setMessage("로그인 후 참여할 수 있어요.");
    setBusy(true);
    setMessage("");
    try {
      if (joined) await leavePublicRide(ride.id);
      else {
        await joinPublicRide(ride.id);
        await trackProductEvent("ride_join");
      }
      const next = await getRideDetails(ride.id);
      setRide(next);
      setJoined(Boolean(next.joined));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "참여 상태를 변경하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };
  const submitChat = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!chatText.trim()) return;
    setBusy(true);
    try {
      await sendRideMessage(ride.id, chatText);
      setChatText("");
      setChat(await listRideMessages(ride.id));
      setChatError("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "메시지를 보내지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  };
  const toggleLocation = async () => {
    if (sharing) {
      if (locationWatchRef.current != null) navigator.geolocation.clearWatch(locationWatchRef.current);
      if (locationTimerRef.current != null) window.clearTimeout(locationTimerRef.current);
      locationWatchRef.current = null;
      locationTimerRef.current = null;
      await updateLiveLocation({ rideId: ride.id, active: false });
      setSharing(false);
      setLiveLocations((rows) => rows.filter((row) => row.userId !== auth?.currentUser?.uid));
      setMessage("안전 위치 공유를 종료했습니다.");
      return;
    }
    if (!navigator.geolocation)
      return setMessage("이 기기에서는 위치 공유를 지원하지 않습니다.");
    locationWatchRef.current = navigator.geolocation.watchPosition(
      async (position) => {
        if (Date.now() - lastLocationSentRef.current < 20000) return;
        try {
          lastLocationSentRef.current = Date.now();
          await updateLiveLocation({
            rideId: ride.id,
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            active: true,
          });
          setSharing(true);
          setMessage("15분 동안 참여자에게 현재 위치를 공유합니다.");
          if (locationTimerRef.current == null)
            locationTimerRef.current = window.setTimeout(() => {
              if (locationWatchRef.current != null) navigator.geolocation.clearWatch(locationWatchRef.current);
              locationWatchRef.current = null;
              locationTimerRef.current = null;
              setSharing(false);
              setMessage("15분이 지나 안전 위치 공유를 자동 종료했습니다.");
              void updateLiveLocation({ rideId: ride.id, active: false });
            }, 15 * 60 * 1000);
        } catch (error) {
          setMessage(
            error instanceof Error
              ? error.message
              : "위치를 공유하지 못했습니다.",
          );
        }
      },
      () =>
        setMessage(
          "위치 권한이 거부되었습니다. 브라우저 설정에서 허용할 수 있어요.",
        ),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 },
    );
  };
  const targetId = ride.hostId ?? ride.host?.id;
  const isHost = auth?.currentUser?.uid === ride.hostId;
  const members = ride.members ?? [];
  const stops = detailStops;
  const mapStops = visibleFacilities(stops, facilityFilter);
  const durationMinutes = estimatedMinutes(ride.course.distanceKm, ride.paceKmh);
  const shareRide = async () => {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("ride", ride.id);
    const shareData = {
      title: `${ride.title} | 라이드메이트`,
      text: `${fmt(ride.startsAt)} · ${ride.course.distanceKm}km · ${ride.paceKmh}km/h`,
      url: url.toString(),
    };
    try {
      if (navigator.share) await navigator.share(shareData);
      else {
        await navigator.clipboard.writeText(shareData.url);
        setMessage("라이딩 링크를 복사했습니다.");
      }
    } catch (error) {
      if ((error as DOMException)?.name !== "AbortError")
        setMessage("공유 링크를 만들지 못했습니다. 다시 시도해 주세요.");
    }
  };
  const changeRideStatus = async (action: "start" | "finish") => {
    setBusy(true);
    setMessage("");
    try {
      if (action === "start") await startPublicRide(ride.id);
      else await finishPublicRide(ride.id);
      setRide(await getRideDetails(ride.id));
      setMessage(action === "start" ? "라이딩을 시작했습니다. 경로와 안전 정보를 확인하세요." : "라이딩을 종료했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "라이딩 상태를 변경하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="page detail">
      <button className="back" onClick={onBack}>
        ← 목록으로
      </button>
      {detailRouteRecovery === "loading" ? (
        <div className="map live-map"><div className="map-state" role="status"><b>출발·도착지로 자전거 경로 복구 중…</b></div></div>
      ) : (
        <CourseMap
          routes={detailMapRoutes}
          label={ride.course.title}
          stops={mapStops}
          climbSegments={ride.course.climbSegments ?? []}
          liveLocations={liveLocations}
          missingRouteMessage={detailRouteMessage}
        />
      )}
      {stops.length > 0 && <FacilityFilter stops={stops} value={facilityFilter} onChange={setFacilityFilter} />}
      <div className="ride-flow" aria-label="라이딩 진행 단계">
        <span className="done">1 코스 선정</span>
        <span className={ride.status !== "계획" ? "done" : ""}>2 인원 모집</span>
        <span className={["진행중", "완료"].includes(ride.status) ? "done" : ""}>3 실제 라이딩</span>
      </div>
      <div className="detail-head">
        <div>
          <span className="eyebrow">{ride.status}</span>
          <h1>{ride.title}</h1>
          <p>{fmt(ride.startsAt)}</p>
        </div>
        {isHost ? (
          ride.status === "진행중" ? (
            <button disabled={busy} className="primary" onClick={() => void changeRideStatus("finish")}>{busy ? "처리 중…" : "라이딩 종료"}</button>
          ) : ["모집중", "마감", "계획"].includes(ride.status) ? (
            <button disabled={busy} className="primary" onClick={() => void changeRideStatus("start")}>{busy ? "처리 중…" : "라이딩 시작"}</button>
          ) : null
        ) : ["모집중", "마감"].includes(ride.status) ? (
          <button disabled={busy} className={joined ? "secondary" : "primary"} onClick={toggleJoin}>
            {busy ? "처리 중…" : joined ? "참여 취소" : "라이딩 참여"}
          </button>
        ) : null}
      </div>
      {message && (
        <p className="status-message" role="status">
          {message}
        </p>
      )}
      {isHost && ["계획", "모집중", "마감", "완료"].includes(ride.status) && <CancelRideButton rideId={ride.id} onCancelled={onBack} />}
      <div className="detail-actions">
        <button onClick={() => void shareRide()}>
          <Share2 /> 공유
        </button>
        <button
          aria-pressed={favorite}
          onClick={async () => {
            if (!auth?.currentUser) return setMessage("로그인이 필요합니다.");
            const next = !favorite;
            setFavorite(next);
            try {
              await setFavoriteRide(ride.id, next);
            } catch {
              setFavorite(!next);
              setMessage("관심 코스 설정을 변경하지 못했습니다.");
            }
          }}
        >
          <Heart fill={favorite ? "currentColor" : "none"} />{" "}
          {favorite ? "저장됨" : "관심 코스"}
        </button>
        {joined && (
          <button aria-pressed={sharing} onClick={toggleLocation}>
            <LifeBuoy /> {sharing ? "위치 공유 종료" : "안전 위치 공유"}
          </button>
        )}
        <button onClick={() => setReportOpen(!reportOpen)}>
          <ShieldCheck /> 신고·차단
        </button>
      </div>
      {reportOpen && targetId && (
        <form
          className="inline-panel"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            try {
              await reportUser({
                targetUserId: targetId,
                rideId: ride.id,
                category: String(form.get("category")) as
                  | "unsafe"
                  | "harassment"
                  | "no_show"
                  | "other",
                details: String(form.get("details")),
              });
              setReportOpen(false);
              setMessage("신고가 접수되어 관리자가 확인합니다.");
            } catch (error) {
              setMessage(
                error instanceof Error
                  ? error.message
                  : "신고를 접수하지 못했습니다. 잠시 후 다시 시도해 주세요.",
              );
            }
          }}
        >
          <h2>방장 신고</h2>
          <label>
            사유
            <select name="category">
              <option value="unsafe">위험한 라이딩</option>
              <option value="harassment">괴롭힘·불쾌한 행동</option>
              <option value="no_show">노쇼</option>
              <option value="other">기타</option>
            </select>
          </label>
          <label>
            상세 내용
            <textarea name="details" maxLength={1000} placeholder="상세 내용을 입력해 주세요" />
          </label>
          <div className="inline-actions">
            <button
              type="button"
              className="secondary"
              onClick={async () => {
                try {
                  await setUserBlocked(targetId, true);
                  setReportOpen(false);
                  setMessage("이 사용자를 차단했습니다.");
                } catch (error) {
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : "차단 처리를 완료하지 못했습니다.",
                  );
                }
              }}
            >
              차단만 하기
            </button>
            <button className="danger" type="submit">
              신고 접수
            </button>
          </div>
        </form>
      )}
      <dl className="stat-grid" aria-label="라이딩 주요 정보">
        <span>
          <Route aria-hidden="true" />
          {ride.course.distanceKm} km<small>거리</small>
        </span>
        <span>
          <Mountain aria-hidden="true" />
          {ride.course.elevationM} m<small>누적 상승</small>
        </span>
        <span>
          <Clock3 aria-hidden="true" />
          {ride.paceKmh} km/h<small>목표 평속</small>
        </span>
        <span>
          <Users aria-hidden="true" />
          {Math.max(0, ride.capacity - (ride.memberCount ?? members.length))}명<small>남은 자리</small>
        </span>
      </dl>
      <article className="route-endpoints" aria-label="코스 출발지와 도착지">
        <span><small>출발</small><b>{ride.course.startName}</b>{ride.course.startAddress && <em>{ride.course.startAddress}</em>}</span>
        <ChevronRight aria-hidden="true" />
        <span><small>도착</small><b>{ride.course.endName}</b>{ride.course.endAddress && <em>{ride.course.endAddress}</em>}</span>
      </article>
      <p className="ride-estimate">
        예상 주행시간 <b>{formatDuration(durationMinutes)}</b>
        <span>휴식·교통 신호 제외</span>
      </p>
      {(ride.course.elevationProfile?.length ?? 0) > 1 && (
        <ElevationChart points={ride.course.elevationProfile ?? []} />
      )}
      {(ride.course.climbSegments?.length ?? 0) > 0 && (
        <article className="info climb-list" aria-label="분석된 업힐">
          <h2><Mountain aria-hidden="true" /> 분석된 업힐</h2>
          {(ride.course.climbSegments ?? []).map((segment, index) => (
            <p key={segment.id}><b>{index + 1}번째 업힐</b><span>{segment.startKm}–{segment.endKm}km · +{segment.gainM}m · 평균 {segment.avgGradient}%</span></p>
          ))}
        </article>
      )}
      {ride.status === "진행중" && joined && (
        <article className="riding-mode" role="status">
          <b>라이딩 모드 진행 중</b>
          <p>빨간 업힐과 정차 지점을 확인하고, 필요하면 안전 위치 공유를 켜세요.</p>
        </article>
      )}
      {weather && (
        <article className="info weather">
          <h2>출발지 날씨</h2>
          <p>{weather}</p>
        </article>
      )}
      <article className="info">
        <h2>집합 장소</h2>
        <p className="meeting-place">
          <MapPin size={17} />
          <span>
            <b>{ride.course.startName}</b>
            {ride.course.startAddress && <small>{ride.course.startAddress}</small>}
          </span>
        </p>
        {ride.meetingNote && <p className="meeting-note"><b>상세 안내</b>{ride.meetingNote}</p>}
        {joined && <small className="meeting-chat-hint">출입구나 정확한 대기 위치는 아래 참여자 대화에서 조율할 수 있어요.</small>}
        {ride.description && <p>{ride.description}</p>}
      </article>
      <article className="info">
        <div className="info-title-row">
          <h2>정차 지점</h2>
          {isHost && stops.length > 0 && (
            <button className="text-button" onClick={() => setEditingStops((value) => !value)}>
              {editingStops ? "편집 취소" : "정차 지점 편집"}
            </button>
          )}
        </div>
        {editingStops ? (
          <div className="stop-editor">
            <p>참여자 대화에서 협의한 장소를 최대 10곳까지 선택하세요.</p>
            {stops.map((stop) => (
              <label key={stop.id}>
                <input
                  type="checkbox"
                  checked={selectedStopIds.includes(stop.id)}
                  onChange={(event) => setSelectedStopIds((current) =>
                    event.target.checked
                      ? current.length < 10 ? [...current, stop.id] : current
                      : current.filter((id) => id !== stop.id),
                  )}
                />
                <span>{facilityMeta[stop.kind].icon}</span>
                <b>{stop.name}</b>
                <small>{stop.distanceFromRouteM != null ? `코스에서 ${stop.distanceFromRouteM}m` : stop.kind}</small>
              </label>
            ))}
            <button
              className="primary wide"
              disabled={savingStops}
              onClick={async () => {
                setSavingStops(true);
                try {
                  await updateCourseStops(ride.id, selectedStopIds);
                  setDetailStops((current) => current.map((stop) => ({ ...stop, selected: selectedStopIds.includes(stop.id) })));
                  setEditingStops(false);
                  setMessage(`${selectedStopIds.length}곳을 정차 지점으로 확정했습니다.`);
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : "정차 지점을 저장하지 못했습니다.");
                } finally {
                  setSavingStops(false);
                }
              }}
            >
              {savingStops ? "저장 중…" : `선택한 ${selectedStopIds.length}곳 확정`}
            </button>
          </div>
        ) : (
          <>
            {stops.some((stop) => stop.selected) ? (
              <FacilityList stops={stops.filter((stop) => stop.selected)} />
            ) : (
              <p className="muted">아직 확정된 정차 지점이 없습니다.</p>
            )}
            {stops.length > 0 && (
              <details className="nearby-facilities">
                <summary>코스 주변 추천 시설 {mapStops.length}곳 보기</summary>
                <FacilityList stops={mapStops} />
              </details>
            )}
          </>
        )}
      </article>
      {ride.status === "진행중" && joined && (
        <article className="info live-safety-panel">
          <div className="info-title-row">
            <h2>참여자 안전 위치</h2>
            <span>{liveLocations.length}명 공유 중</span>
          </div>
          <p className="muted">위치는 참여자에게만 보이며 마지막 전송 후 15분 뒤 만료됩니다.</p>
          {liveLocations.length > 0 && (
            <div className="live-rider-list">
              {liveLocations.map((location) => (
                <span key={location.userId}><b>{location.name}</b>{location.updatedAt ? `${Math.max(0, Math.floor((Date.now() - new Date(location.updatedAt).getTime()) / 60000))}분 전` : "방금 전"}</span>
              ))}
            </div>
          )}
        </article>
      )}
      <article className="info">
        <h2>참여 라이더 {ride.memberCount ?? members.length}명</h2>
        <div className="avatars">
          {members.map((member) => (
            <span title={member.name} key={member.id}>
              {member.name.slice(0, 1)}
            </span>
          ))}
        </div>
      </article>
      {joined &&
        ride.status === "완료" &&
        members.some((member) => member.id !== auth?.currentUser?.uid) && (
          <article className="info review">
            <h2>
              <Star aria-hidden="true" /> 라이딩 후기
            </h2>
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                try {
                  await createRideReview({
                    rideId: ride.id,
                    targetUserId: String(form.get("targetUserId")),
                    rating: Number(form.get("rating")),
                    comment: String(form.get("comment") ?? ""),
                  });
                  setMessage("후기를 등록했습니다.");
                } catch (error) {
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : "후기를 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.",
                  );
                }
              }}
            >
              <label>
                라이더
                <select name="targetUserId">
                  {members
                    .filter((member) => member.id !== auth?.currentUser?.uid)
                    .map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                평점
                <select name="rating" defaultValue="5">
                  <option value="5">5 · 다시 함께 타고 싶어요</option>
                  <option value="4">4 · 좋았어요</option>
                  <option value="3">3 · 보통이에요</option>
                  <option value="2">2 · 아쉬웠어요</option>
                  <option value="1">1 · 문제가 있었어요</option>
                </select>
              </label>
              <label>
                한줄 후기
                <textarea name="comment" maxLength={500} />
              </label>
              <button className="primary">후기 등록</button>
            </form>
          </article>
        )}
      {joined && (
        <article className="info chat" aria-label="참여자 대화">
          <h2>
            <MessageCircle aria-hidden="true" /> 참여자 대화
            <small className="chat-live">5초마다 자동 갱신</small>
          </h2>
          <div className="chat-log" aria-live="polite" aria-busy={chatLoading}>
            {chatLoading && !chat.length && (
              <p className="muted">대화를 불러오는 중…</p>
            )}
            {chat.map((row) => (
              <p key={row.id}>
                <b>
                  {row.authorName}
                  {row.createdAt && (
                    <time dateTime={row.createdAt}>
                      {new Intl.DateTimeFormat("ko-KR", {
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(new Date(row.createdAt))}
                    </time>
                  )}
                </b>
                <span>{row.text}</span>
              </p>
            ))}
            {!chatLoading && !chat.length && (
              <p className="muted">집합 장소와 정차 지점을 함께 정해보세요.</p>
            )}
            <div ref={chatEndRef} aria-hidden="true" />
          </div>
          {chatError && <p className="form-error" role="status">{chatError}</p>}
          <form onSubmit={submitChat}>
            <input
              aria-label="메시지"
              value={chatText}
              maxLength={500}
              onChange={(event) => setChatText(event.target.value)}
              placeholder="메시지 입력"
            />
            <button className="primary" disabled={busy}>
              보내기
            </button>
          </form>
        </article>
      )}
    </section>
  );
}

function RideDateTimeFields({ optional = false }: { optional?: boolean }) {
  const [enabled, setEnabled] = useState(!optional);
  useEffect(() => setEnabled(!optional), [optional]);
  const hours = Array.from({ length: 12 }, (_, index) => index + 1);
  const now = new Date();
  const nextSlot = new Date(now.getTime() + 10 * 60000);
  nextSlot.setMinutes(Math.ceil(nextSlot.getMinutes() / 10) * 10, 0, 0);
  const localToday = new Date(nextSlot.getTime() - nextSlot.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
  const defaultHour24 = nextSlot.getHours();
  const defaultPeriod = defaultHour24 >= 12 ? "PM" : "AM";
  const defaultHour12 = defaultHour24 % 12 || 12;
  const defaultMinute = String(nextSlot.getMinutes()).padStart(2, "0");
  return (
    <div
      className="date-time-fields"
      role="group"
      aria-label={optional ? "출발 날짜와 시간, 선택 사항" : "출발 날짜와 시간"}
    >
      <div className="date-time-head">
        <div className="date-time-title">
          출발 날짜와 시간 {optional && <span className="optional">선택</span>}
        </div>
        {optional && (
          <button
            type="button"
            className={`schedule-toggle ${enabled ? "active" : ""}`}
            aria-pressed={enabled}
            aria-expanded={enabled}
            onClick={() => setEnabled((value) => !value)}
          >
            {enabled ? "일정 사용" : "일정 미정"}
          </button>
        )}
      </div>
      {enabled ? <div className="date-time-grid">
        <label className="date-field">
          날짜
          <input required name="rideDate" type="date" min={localToday} defaultValue={localToday} />
        </label>
        <label>
          오전·오후
          <select required name="ridePeriod" defaultValue={defaultPeriod}>
            <option value="AM">오전</option>
            <option value="PM">오후</option>
          </select>
        </label>
        <label>
          시
          <select required name="rideHour" defaultValue={String(defaultHour12)}>
            {hours.map((hour) => (
              <option key={hour} value={hour}>
                {hour}시
              </option>
            ))}
          </select>
        </label>
        <label>
          분
          <select required name="rideMinute" defaultValue={defaultMinute}>
            <option value="00">00분</option>
            <option value="10">10분</option>
            <option value="20">20분</option>
            <option value="30">30분</option>
            <option value="40">40분</option>
            <option value="50">50분</option>
          </select>
        </label>
      </div> : (
        <p className="schedule-empty">날짜를 정하지 않고 계획만 저장합니다.</p>
      )}
      <small className="field-help">
        {optional && !enabled
          ? "나중에 내 라이딩에서 계획을 확인하고 출발할 수 있어요."
          : "예: 9월 5일 · 오전 8시 30분"}
      </small>
    </div>
  );
}

function CommonRideFields({ solo }: { solo: boolean }) {
  return (
    <>
      <RideDateTimeFields optional={solo} />
      <div className="two">
        <label>
          목표 평속
          <input
            name="paceKmh"
            required
            type="number"
            min="5"
            max="60"
            step="0.1"
            placeholder="예: 24.5"
          />
          <small>km/h</small>
        </label>
        {solo ? (
          <label key="rest-count">
            예상 휴식 횟수
            <input
              name="restCount"
              type="number"
              min="0"
              max="20"
              defaultValue="1"
            />
          </label>
        ) : (
          <label key="capacity">
            모집할 인원
            <input
              name="capacity"
              required
              type="number"
              min="1"
              max="49"
              defaultValue="5"
            />
            <small>방장 제외 · 1~49명</small>
          </label>
        )}
      </div>
      {!solo && (
        <label>
          집합 위치 상세 안내 <span className="optional">선택</span>
          <input
            name="meetingNote"
            maxLength={200}
            placeholder="예: 공원 남문 자전거 거치대 앞"
          />
          <small>선택한 출발지가 기본 집합 장소입니다. 출입구·랜드마크는 적거나 참여자 채팅에서 조율하세요.</small>
        </label>
      )}
      <label>
        부가 설명 <span className="optional">선택</span>
        <textarea
          name="description"
          rows={3}
          placeholder={
            solo
              ? "준비물, 보급 계획, 개인 목표 등을 적어주세요."
              : "준비물, 라이딩 성격, 주의사항 등을 적어주세요."
          }
        />
      </label>
    </>
  );
}

function CandidateResults({
  candidates,
  onReset,
  onCreated,
  solo,
  draft = {},
}: {
  candidates: RouteCandidate[];
  onReset: () => void;
  onCreated: () => void;
  solo: boolean;
  draft?: Partial<RidePlanInput>;
}) {
  const [selected, setSelected] = useState(() => {
    try {
      const saved = Number(sessionStorage.getItem("ridemate-create-selected") ?? 0);
      return Number.isInteger(saved) && saved >= 0 && saved < candidates.length ? saved : 0;
    } catch { return 0; }
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [pois, setPois] = useState<Stop[]>([]);
  const [poisLoading, setPoisLoading] = useState(false);
  const [facilityFilter, setFacilityFilter] = useState<FacilityFilterValue>("전체");
  const filteredPois = useMemo(() => visibleFacilities(pois, facilityFilter), [pois, facilityFilter]);
  const candidateMapRoutes = useMemo(
    () => candidates.map((candidate) => candidate.coordinates),
    [candidates],
  );
  useEffect(() => { try { sessionStorage.setItem("ridemate-create-selected", String(selected)); } catch { /* Private storage may be unavailable. */ } }, [selected]);
  useEffect(() => {
    let active = true;
    setPoisLoading(true);
    const coordinates = candidates[selected]?.coordinates ?? [];
    void searchCoursePois(coordinates)
      .then((rows) => {
        if (active) setPois(rows);
      })
      .catch(() => {
        if (active) setPois([]);
      })
      .finally(() => {
        if (active) setPoisLoading(false);
      });
    return () => {
      active = false;
    };
  }, [candidates, selected]);
  const store = async () => {
    const candidate = candidates[selected];
    const cached = (() => {
      try {
        return JSON.parse(
          sessionStorage.getItem("ridemate-create-draft") ?? "{}",
        ) as Partial<RidePlanInput>;
      } catch {
        return {};
      }
    })();
    const metadata = { ...cached, ...draft };
    const startName =
      candidate.startName ?? String(metadata.startName ?? "데이터 분석 출발지");
    setSaving(true);
    setSaveError("");
    try {
      if (!auth?.currentUser)
        throw new Error(
          "모집 방과 개인 계획을 저장하려면 먼저 로그인해 주세요.",
        );
      await createRidePlan({
        title: candidate.title,
        purpose: solo ? "solo" : "group",
        startName,
        startAddress: metadata.startAddress,
        endName: metadata.endName ?? candidate.title,
        endAddress: metadata.endAddress,
        startsAt: metadata.startsAt,
        distanceKm: candidate.distanceKm,
        elevationM: candidate.elevationM,
        paceKmh: metadata.paceKmh,
        capacity: metadata.capacity,
        description: metadata.description,
        meetingNote: metadata.meetingNote,
        coordinates: candidate.coordinates,
        elevationProfile: candidate.elevationProfile,
        climbSegments: candidate.climbSegments,
        stops: pois,
      });
      await trackProductEvent("course_created");
      sessionStorage.removeItem("ridemate-create-draft");
      sessionStorage.removeItem("ridemate-create-work");
      sessionStorage.removeItem("ridemate-create-selected");
      onCreated();
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "선택한 코스를 저장하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="candidate-results">
      <div className="result-head">
        <div>
          <h2>추천 코스 {candidates.length}개</h2>
        </div>
        <button className="text-button" onClick={onReset}>
          조건 수정
        </button>
      </div>
      <CourseMap
        routes={candidateMapRoutes}
        selected={selected}
        label="추천 후보 비교"
        stops={filteredPois}
        climbSegments={candidates[selected]?.climbSegments ?? []}
      />
      <ElevationChart points={candidates[selected]?.elevationProfile ?? []} />
      {(candidates[selected]?.climbSegments.length ?? 0) > 0 && (
        <article className="climb-list candidate-climbs">
          <b>빨간색 업힐 분석</b>
          {candidates[selected].climbSegments.slice(0, 5).map((segment, index) => (
            <span key={segment.id}>{index + 1}번째 · {segment.startKm}–{segment.endKm}km · +{segment.gainM}m · {segment.avgGradient}%</span>
          ))}
        </article>
      )}
      <article className="poi-summary"><b>코스 주변 시설</b>{pois.length > 0 && <FacilityFilter stops={pois} value={facilityFilter} onChange={setFacilityFilter} />}<FacilityList stops={filteredPois} loading={poisLoading} compact /></article>
      <div className="candidate-list">
        {candidates.map((candidate, index) => (
          <button
            key={candidate.id}
            className={`candidate-card ${selected === index ? "selected" : ""}`}
            onClick={() => setSelected(index)}
          >
            <span
              className="route-swatch"
              style={{ background: routeColors[index] }}
            />
            <div>
              <b>{candidate.title}</b>
              <small>
                {candidate.distanceKm}km · 상승 {candidate.elevationM}m
              </small>
            </div>
            <span
              className={`verified ${candidate.recommended ? "recommended" : ""}`}
            >
              {candidate.recommended ? "1순위 추천" : `${index + 1}순위`}
            </span>
          </button>
        ))}
      </div>
      {saveError && <p className="form-error" role="alert">{saveError}</p>}
      <button className="primary wide" disabled={saving} onClick={store}>
        {saving
          ? "저장 중…"
          : solo
            ? "내 라이딩 계획 저장"
            : "선택한 코스로 방 만들기"}
      </button>
    </section>
  );
}

function CourseExplorer({ onCreate }: { onCreate: () => void }) {
  const [tripType, setTripType] = useState<"round" | "oneway">("round");
  const [candidates, setCandidates] = useState<RouteCandidate[]>([]);
  const [selected, setSelected] = useState(0);
  const [pois, setPois] = useState<Stop[]>([]);
  const [loading, setLoading] = useState(false);
  const [poiLoading, setPoiLoading] = useState(false);
  const [facilityFilter, setFacilityFilter] = useState<FacilityFilterValue>("전체");
  const filteredPois = useMemo(() => visibleFacilities(pois, facilityFilter), [pois, facilityFilter]);
  const [error, setError] = useState("");
  useEffect(() => {
    const route = candidates[selected]?.coordinates;
    if (!route?.length) return;
    let active = true;
    setPoiLoading(true);
    void searchCoursePois(route)
      .then((rows) => active && setPois(rows))
      .catch(() => active && setPois([]))
      .finally(() => active && setPoiLoading(false));
    return () => { active = false; };
  }, [candidates, selected]);
  if (candidates.length) {
    const candidate = candidates[selected];
    return (
      <section className="page course-explorer explorer-results">
        <div className="result-head">
          <div><h1>주변 코스 {candidates.length}개</h1></div>
          <button className="text-button" onClick={() => { setCandidates([]); setPois([]); }}>조건 수정</button>
        </div>
        <CourseMap routes={candidates.map((row) => row.coordinates)} selected={selected} stops={filteredPois} climbSegments={candidate.climbSegments} label="주변 코스 탐색 결과" />
        <div className="explorer-grid">
          <div>
            <ElevationChart points={candidate.elevationProfile} />
            <article className="poi-summary"><b>코스 주변 시설</b>{pois.length > 0 && <FacilityFilter stops={pois} value={facilityFilter} onChange={setFacilityFilter} />}<FacilityList stops={filteredPois} loading={poiLoading} compact /></article>
          </div>
          <div className="candidate-list">
            {candidates.map((row, index) => (
              <button key={row.id} className={`candidate-card ${selected === index ? "selected" : ""}`} onClick={() => setSelected(index)}>
                <span className="route-swatch" style={{ background: routeColors[index] }} />
                <div><b>{row.title}</b><p>{row.distanceKm}km · 상승 {row.elevationM}m</p></div>
                <span className={`verified ${row.recommended ? "recommended" : ""}`}>{row.recommended ? "1순위 추천" : "검증됨"}</span>
              </button>
            ))}
            <button className="primary wide" onClick={onCreate}>이 조건으로 라이딩 만들기</button>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="page course-explorer">
      <h1>주변 자전거 코스 찾기</h1>
      <form onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const startName = String(form.get("exploreStart") ?? "");
        const lat = Number(form.get("exploreStartLat"));
        const lng = Number(form.get("exploreStartLng"));
        if (!startName || !Number.isFinite(lat) || !Number.isFinite(lng)) return setError("출발지를 검색한 뒤 정확한 장소를 선택해 주세요.");
        setLoading(true); setError("");
        try {
          setCandidates(await requestCourseCandidates({ start: { lat, lng }, startName, distanceKm: Number(form.get("distanceKm")), uphill: String(form.get("uphill")) as "low" | "medium" | "high", tripType }));
          void trackProductEvent("course_explore").catch(() => undefined);
          setSelected(0);
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : "코스를 탐색하지 못했습니다.");
        } finally { setLoading(false); }
      }}>
        <PlacePicker name="exploreStart" label="어디에서 출발하나요?" placeholder="역·공원·정확한 장소명 검색" />
        <div className="explore-options">
          <label>희망 거리<input name="distanceKm" type="number" min="5" max="200" defaultValue="30" required /><small>km</small></label>
          <label>업힐 수준<select name="uphill" defaultValue="medium"><option value="low">평지 위주</option><option value="medium">균형</option><option value="high">도전</option></select></label>
        </div>
        <fieldset><legend>코스 형태</legend><div className="segmented"><button type="button" className={tripType === "round" ? "active" : ""} onClick={() => setTripType("round")}>왕복·순환</button><button type="button" className={tripType === "oneway" ? "active" : ""} onClick={() => setTripType("oneway")}>편도</button></div></fieldset>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary wide" disabled={loading}>{loading ? "자전거 경로와 고도 분석 중…" : "주변 코스 3개 탐색"}</button>
      </form>
    </section>
  );
}

function ManualRouteReview({ plan, via, busy, error, onEdit, onApprove }: {
  plan: RidePlanInput; via?: string; busy: boolean; error: string;
  onEdit: () => void; onApprove: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [visible, setVisible] = useState(false);
  const [facilityFilter, setFacilityFilter] = useState<FacilityFilterValue>("전체");
  const filteredStops = visibleFacilities(plan.stops ?? [], facilityFilter);
  const routes = useMemo(() => [plan.coordinates ?? []], [plan.coordinates]);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    setVisible(true);
    return () => dialog?.close();
  }, []);
  return <dialog ref={dialogRef} className="manual-route-review" aria-labelledby="manual-review-title" onCancel={(event) => { event.preventDefault(); if (!busy) onEdit(); }}>
    <div className="manual-review-heading"><div><h2 id="manual-review-title">코스를 확인하고 승인해 주세요</h2><p>아직 {plan.purpose === "solo" ? "계획이 저장되지" : "방이 만들어지지"} 않았습니다.</p></div></div>
    <p className="manual-review-path">{plan.startName} → {via ? `${via} (반환점) → ${plan.startName}` : plan.endName}</p>
    {visible && <CourseMap routes={routes} stops={filteredStops} climbSegments={plan.climbSegments ?? []} label="승인 전 자전거 코스 확인" />}
    <div className="manual-review-summary"><b>{via ? "왕복 전체" : "편도"} {plan.distanceKm}km</b><b>누적 상승 {plan.elevationM ?? 0}m</b><span>평속 {plan.paceKmh}km/h</span><span>{fmt(plan.startsAt ?? "")}</span>{plan.purpose === "group" && <span>방장 포함 {plan.capacity}명</span>}</div>
    <ElevationChart points={plan.elevationProfile ?? []} />
    {(plan.stops?.length ?? 0) > 0 && <FacilityFilter stops={plan.stops ?? []} value={facilityFilter} onChange={setFacilityFilter} />}
    <FacilityList stops={filteredStops} compact />
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="manual-review-actions"><button type="button" className="secondary" disabled={busy} onClick={onEdit}>돌아가서 수정</button><button type="button" className="primary" disabled={busy} onClick={onApprove}>{busy ? "저장 중…" : plan.purpose === "solo" ? "이 코스 승인하고 계획 저장" : "이 코스 승인하고 방 만들기"}</button></div>
  </dialog>;
}

function CreateRide({
  onCreated,
  onLogin,
  onBack,
}: {
  onCreated: () => void;
  onLogin: () => void;
  onBack: () => void;
}) {
  const restored = useRef<null | { purpose?: "group" | "solo"; mode?: "guided" | "manual"; tripType?: "round" | "oneway"; candidates?: RouteCandidate[]; draft?: Partial<RidePlanInput>; manualPreview?: { plan: RidePlanInput; via?: string } }>(null);
  if (restored.current === null) {
    try { restored.current = JSON.parse(sessionStorage.getItem("ridemate-create-work") ?? "{}"); }
    catch { restored.current = {}; }
  }
  const initialWork = restored.current ?? {};
  const [purpose, setPurpose] = useState<"group" | "solo">(initialWork.purpose ?? "group");
  const [mode, setMode] = useState<"guided" | "manual">(initialWork.mode ?? "guided");
  const [tripType, setTripType] = useState<"round" | "oneway">(initialWork.tripType ?? "round");
  const [candidates, setCandidates] = useState<RouteCandidate[]>(initialWork.candidates ?? []);
  const [draft, setDraft] = useState<Partial<RidePlanInput>>(initialWork.draft ?? {});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [manualDone, setManualDone] = useState(false);
  const [manualTrip, setManualTrip] = useState<"oneway" | "round">("oneway");
  const [manualPreview, setManualPreview] = useState<{ plan: RidePlanInput; via?: string } | null>(initialWork.manualPreview ?? null);
  const savingManual = useRef(false);
  const solo = purpose === "solo";
  useEffect(() => {
    if (manualDone) {
      try {
        sessionStorage.removeItem("ridemate-create-work");
        sessionStorage.removeItem("ridemate-create-draft");
        sessionStorage.removeItem("ridemate-create-selected");
      } catch { /* Storage may be unavailable in private browsing. */ }
      return;
    }
    try { sessionStorage.setItem("ridemate-create-work", JSON.stringify({ purpose, mode, tripType, candidates, draft, manualPreview })); }
    catch { /* The course remains available in memory for this screen. */ }
  }, [purpose, mode, tripType, candidates, draft, manualPreview, manualDone]);
  const submitGuided = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!auth?.currentUser) {
      setError("먼저 로그인한 뒤 코스를 만들 수 있어요.");
      return;
    }
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const moderationError = validateRideContent(
        String(form.get("description") ?? ""),
        String(form.get("meetingNote") ?? ""),
      );
      if (moderationError) throw new Error(moderationError);
      const selectedStart = {
        name: String(form.get("startName") ?? ""),
        lat: Number(form.get("startNameLat")),
        lng: Number(form.get("startNameLng")),
      };
      if (!selectedStart.name || !Number.isFinite(selectedStart.lat) || !Number.isFinite(selectedStart.lng))
        throw new Error("출발지를 검색한 뒤 정확한 장소를 선택해 주세요.");
      const metadata: Partial<RidePlanInput> = {
        startName: selectedStart.name,
        startAddress: String(form.get("startNameAddress") ?? ""),
        endName: tripType === "round" ? selectedStart.name : "추천 경로 도착 지점",
        endAddress: tripType === "round" ? String(form.get("startNameAddress") ?? "") : "",
        startsAt: startsAtFrom(form),
        paceKmh: Number(form.get("paceKmh")),
        capacity: solo ? 1 : Number(form.get("capacity")) + 1,
        description: String(form.get("description") ?? ""),
        meetingNote: String(form.get("meetingNote") ?? ""),
      };
      setDraft(metadata);
      sessionStorage.setItem("ridemate-create-draft", JSON.stringify(metadata));
      const result = await requestCourseCandidates({
        start: { lat: selectedStart.lat, lng: selectedStart.lng },
        startName: selectedStart.name,
        distanceKm: Number(form.get("distanceKm")),
        uphill: String(form.get("uphill")) as "low" | "medium" | "high",
        tripType,
      });
      setCandidates(result);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "코스를 추천하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setLoading(false);
    }
  };
  const submitManual = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!auth?.currentUser) {
      setError("먼저 로그인한 뒤 저장할 수 있어요.");
      return;
    }
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const moderationError = validateRideContent(
        String(form.get("title") ?? ""),
        String(form.get("description") ?? ""),
        String(form.get("meetingNote") ?? ""),
      );
      if (moderationError) throw new Error(moderationError);
      const manualStartName = String(form.get("manualStart") ?? "");
      const manualEndName = String(form.get("manualEnd") ?? "");
      const start = { lat: Number(form.get("manualStartLat")), lng: Number(form.get("manualStartLng")) };
      const end = { lat: Number(form.get("manualEndLat")), lng: Number(form.get("manualEndLng")) };
      if (!manualStartName || !manualEndName || !Number.isFinite(start.lat) || !Number.isFinite(start.lng) || !Number.isFinite(end.lat) || !Number.isFinite(end.lng))
        throw new Error("출발지와 도착지를 검색 결과에서 각각 선택해 주세요.");
      if (start.lat === end.lat && start.lng === end.lng) throw new Error("출발지와 다른 도착지 또는 반환점을 선택해 주세요.");
      const routed = await requestManualRoute(start, end, manualTrip);
      if (routed.coordinates.length < 2 || routed.distanceKm < 1 || routed.distanceKm > 300) throw new Error("1~300km 범위의 유효한 코스를 다시 선택해 주세요.");
      const stops = await searchCoursePois(routed.coordinates).catch(()=>[] as Stop[]);
      setManualPreview({ via: manualTrip === "round" ? manualEndName : undefined, plan: {
        title: String(form.get("title")),
        purpose,
        startName: manualStartName,
        startAddress: String(form.get("manualStartAddress") ?? ""),
        endName: manualTrip === "round" ? manualStartName : manualEndName,
        endAddress: String(form.get(manualTrip === "round" ? "manualStartAddress" : "manualEndAddress") ?? ""),
        startsAt: startsAtFrom(form),
        distanceKm: routed.distanceKm,
        elevationM: routed.elevationM,
        paceKmh: Number(form.get("paceKmh")),
        capacity: solo ? 1 : Number(form.get("capacity")) + 1,
        description: String(form.get("description") ?? ""),
        meetingNote: String(form.get("meetingNote") ?? ""),
        coordinates: routed.coordinates,
        elevationProfile: routed.elevationProfile,
        climbSegments: (routed as { climbSegments?: ClimbSegment[] }).climbSegments ?? [],
        stops,
      } });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "라이딩을 저장하지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  };
  const approveManual = async () => {
    if (!manualPreview || savingManual.current) return;
    savingManual.current = true;
    setLoading(true);
    setError("");
    try {
      await createRidePlan(manualPreview.plan);
      void trackProductEvent("course_created").catch(() => undefined);
      setManualPreview(null);
      setManualDone(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      savingManual.current = false;
      setLoading(false);
    }
  };
  if (manualDone)
    return (
      <section className="result">
        <div className="success">✓</div>
        <h1>
          {solo ? "혼자 라이딩 계획을 저장했어요" : "라이딩 정보를 저장했어요"}
        </h1>
        <p>
          {solo
            ? "내 라이딩에서 언제든 다시 확인할 수 있어요."
            : "승인한 코스로 모집 방을 만들었습니다."}
        </p>
        <button className="primary wide" onClick={onCreated}>
          라이딩 보기
        </button>
      </section>
    );
  return (
    <section className="page create-page">
      {manualPreview && <ManualRouteReview plan={manualPreview.plan} via={manualPreview.via} busy={loading} error={error} onEdit={() => { setManualPreview(null); setError(""); }} onApprove={() => void approveManual()} />}
      <button type="button" className="back create-back" onClick={onBack}>← 홈으로</button>
      <h1>{solo ? "혼자 라이딩 계획" : "라이딩 만들기"}</h1>
      {!auth?.currentUser && (
        <aside className="auth-required" role="status">
          <div>
            <b>저장하려면 로그인이 필요해요</b>
            <span>먼저 로그인하면 입력 도중 막히지 않습니다.</span>
          </div>
          <button type="button" className="secondary" onClick={onLogin}>
            로그인
          </button>
        </aside>
      )}
      <div className="purpose-tabs" role="group" aria-label="라이딩 목적">
        <button
          className={!solo ? "active" : ""}
          onClick={() => {
            setPurpose("group");
            setCandidates([]);
          }}
        >
          <Users />
          <b>함께 라이딩</b>
        </button>
        <button
          className={solo ? "active" : ""}
          onClick={() => {
            setPurpose("solo");
            setCandidates([]);
          }}
        >
          <CircleUserRound />
          <b>혼자 라이딩</b>
        </button>
      </div>
      <div className="mode-cards">
        <button
          className={mode === "guided" ? "active" : ""}
          onClick={() => {
            setMode("guided");
            setCandidates([]);
          }}
        >
          <Route />
          <b>조건으로 코스 찾기</b>
        </button>
        <button
          className={mode === "manual" ? "active" : ""}
          onClick={() => {
            setMode("manual");
            setCandidates([]);
          }}
        >
          <MapPin />
          <b>모두 직접 입력</b>
        </button>
      </div>
      {mode === "guided" && candidates.length ? (
        <CandidateResults
          candidates={candidates}
          draft={draft}
          onReset={() => setCandidates([])}
          onCreated={onCreated}
          solo={solo}
        />
      ) : mode === "guided" ? (
        <form onSubmit={submitGuided}>
          <PlacePicker name="startName" label="출발 지점" placeholder="역·공원·정확한 장소명 검색" />
          <div className="two distance-row">
            <label>
              희망 거리
              <input
                name="distanceKm"
                required
                type="number"
                min="5"
                max="200"
                defaultValue="40"
              />
              <small>km</small>
            </label>
          </div>
          <fieldset className="uphill-picker">
            <legend>희망 업힐 정도</legend>
            <div>
              <label>
                <input type="radio" name="uphill" value="low" />
                <span><b>평지 위주</b></span>
              </label>
              <label>
                <input type="radio" name="uphill" value="medium" defaultChecked />
                <span><b>균형</b></span>
              </label>
              <label>
                <input type="radio" name="uphill" value="high" />
                <span><b>도전</b></span>
              </label>
            </div>
          </fieldset>
          <fieldset>
            <legend>라이딩 유형</legend>
            <div className="segmented">
              <button
                type="button"
                className={tripType === "round" ? "active" : ""}
                onClick={() => setTripType("round")}
              >
                왕복·순환
              </button>
              <button
                type="button"
                className={tripType === "oneway" ? "active" : ""}
                onClick={() => setTripType("oneway")}
              >
                편도
              </button>
            </div>
          </fieldset>
          <CommonRideFields solo={solo} />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary wide" type="submit" disabled={loading}>
            {loading
              ? "자전거 도로 탐색·거리·고도 분석 중…"
              : "조건으로 코스 3개 계산"}
          </button>
        </form>
      ) : (
        <form onSubmit={submitManual}>
          <label>
            라이딩 제목
            <input
              name="title"
              required
              placeholder={
                solo ? "예: 일요일 개인 훈련" : "예: 주말 한강 라이딩"
              }
            />
          </label>
          <PlacePicker name="manualStart" label="출발 지점" placeholder="출발 장소 검색 후 선택" />
          <fieldset><legend>라이딩 유형</legend><div className="segmented">
            <button type="button" className={manualTrip === "oneway" ? "active" : ""} aria-pressed={manualTrip === "oneway"} onClick={() => setManualTrip("oneway")}>편도</button>
            <button type="button" className={manualTrip === "round" ? "active" : ""} aria-pressed={manualTrip === "round"} onClick={() => setManualTrip("round")}>왕복</button>
          </div></fieldset>
          <PlacePicker name="manualEnd" label={manualTrip === "round" ? "반환 지점" : "도착 지점"} placeholder={manualTrip === "round" ? "돌아올 지점 검색 후 선택" : "도착 장소 검색 후 선택"} />
          <div className="two">
            <label>
              경로 거리
              <input
                name="manualDistance"
                type="number"
                readOnly
                placeholder="경로로 자동 계산"
              />
              <small>km</small>
            </label>
            <label>
              정차 횟수
              <input
                name="restCount"
                required
                type="number"
                min="0"
                max="20"
                defaultValue="1"
              />
            </label>
          </div>
          <CommonRideFields solo={solo} />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary wide" type="submit" disabled={loading}>
            {loading
              ? "자전거 경로·고도 검증 중…"
              : "큰 지도에서 코스 확인"}
          </button>
        </form>
      )}
    </section>
  );
}

const legalCopy = {
  terms: {
    title: "이용약관",
    body: "라이드메이트는 라이딩 계획과 참여자 연결을 돕는 서비스입니다. 사용자는 교통법규와 안전수칙을 준수하고, 본인의 건강·장비 상태를 직접 확인해야 합니다. 타인을 사칭하거나 위험한 라이딩을 강요하고, 괴롭힘·노쇼·허위 신고를 하는 행위는 제한됩니다.",
  },
  privacy: {
    title: "개인정보처리방침",
    body: "계정 이메일, 닉네임, 라이딩 참여·노쇼 기록, 선택 입력한 비상연락처와 알림 설정을 서비스 제공·안전 운영 목적으로 처리합니다. 비상연락처와 세부 노쇼 기록은 공개 프로필에 노출하지 않습니다. 위치 공유는 사용자가 켠 경우에만 최대 15분 보관 후 만료되도록 설계하며, 탈퇴·삭제 요청은 운영자에게 접수할 수 있습니다.",
  },
  location: {
    title: "위치기반서비스 안내",
    body: "출발지 검색, 코스 추천, 주변 편의시설과 라이딩 중 선택적 위치 공유에 위치정보를 사용합니다. 위치 공유는 참여자가 직접 시작·종료하며 참여 라이딩의 안전 확인 목적에 한정합니다. 실제 사업자 정보, 위치정보관리책임자와 신고 연락처는 정식 출시 전 운영자가 확정해야 합니다.",
  },
};

function LegalSheet({
  kind,
  onClose,
}: {
  kind: keyof typeof legalCopy;
  onClose: () => void;
}) {
  const copy = legalCopy[kind];
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <section
        className="legal-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="close-modal" aria-label="닫기" onClick={onClose}>
          <X />
        </button>
        <h1 id="legal-title">{copy.title}</h1>
        <p>{copy.body}</p>
        <p className="legal-note">
          시행 예정일: 정식 출시일 · 문의: cheonmyungjun0725@gmail.com
        </p>
      </section>
    </div>
  );
}

function LegalLinks() {
  const [legal, setLegal] = useState<keyof typeof legalCopy | null>(null);
  return (
    <>
      <div className="legal-links">
        <button onClick={() => setLegal("terms")}>이용약관</button>
        <button onClick={() => setLegal("privacy")}>개인정보처리방침</button>
        <button onClick={() => setLegal("location")}>위치서비스 안내</button>
      </div>
      {legal && <LegalSheet kind={legal} onClose={() => setLegal(null)} />}
    </>
  );
}

function ProfileTools() {
  const [settings, setSettings] = useState<RiderSettings | null>(null);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [saved, setSaved] = useState("");
  useEffect(() => {
    let active = true;
    setLoadError("");
    void getRiderSettings()
      .then((value) => { if (active) setSettings(value); })
      .catch(() => { if (active) setLoadError("프로필을 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요."); });
    return () => { active = false; };
  }, [retry]);
  if (loadError) return <div className="form-error" role="alert">{loadError}<button className="secondary" onClick={() => setRetry((value) => value + 1)}>다시 시도</button></div>;
  if (!settings)
    return (
      <div className="skeleton-card" aria-label="프로필 설정 불러오는 중" />
    );
  return (
    <>
      <form
        className="profile-tools"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          try {
            await saveRiderSettings({
              displayName: String(form.get("displayName")),
              emergencyName: String(form.get("emergencyName")),
              emergencyPhone: String(form.get("emergencyPhone")),
              notifyRide: form.get("notifyRide") === "on",
              notifyChat: form.get("notifyChat") === "on",
              notifySafety: form.get("notifySafety") === "on",
              onboardingComplete: true,
            });
            setSaved("설정을 안전하게 저장했습니다.");
          } catch (error) {
            setSaved(
              error instanceof Error
                ? error.message
                : "설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
            );
          }
        }}
      >
        <h2>안전 프로필</h2>
        <label>
          닉네임
          <input
            name="displayName"
            minLength={2}
            maxLength={20}
            defaultValue={settings.displayName}
            placeholder="다른 라이더에게 보일 이름"
          />
        </label>
        <div className="verification-row">
          <ShieldCheck />
          <div>
            <b>본인·휴대폰 인증</b>
            <small>
              {settings.identityStatus === "verified"
                ? "인증 완료"
                : "외부 본인인증 사업자 연동 전 · 미인증"}
            </small>
          </div>
          <span>
            {settings.identityStatus === "verified" ? "완료" : "준비 중"}
          </span>
        </div>
        <div className="two">
          <label>
            비상 연락 대상
            <input
              name="emergencyName"
              defaultValue={settings.safety.emergencyName}
              placeholder="예: 가족"
            />
          </label>
          <label>
            비상 연락처
            <input
              name="emergencyPhone"
              inputMode="tel"
              defaultValue={settings.safety.emergencyPhone}
              placeholder="01012345678"
            />
          </label>
        </div>
        <h2 id="notification-settings" tabIndex={-1}>알림 설정</h2>
        <label className="switch-row">
          <span><b>라이딩 일정·참여</b><small>출발 시간과 방 참여 상태를 알려드려요.</small></span>
          <input
            name="notifyRide"
            type="checkbox"
            defaultChecked={settings.notifications.ride}
            aria-label="라이딩 일정과 참여 알림"
          />
        </label>
        <label className="switch-row">
          <span><b>참여자 채팅</b><small>참여 중인 방의 새 메시지를 알려드려요.</small></span>
          <input
            name="notifyChat"
            type="checkbox"
            defaultChecked={settings.notifications.chat}
            aria-label="참여자 채팅 알림"
          />
        </label>
        <label className="switch-row">
          <span><b>안전·노쇼 투표</b><small>안전 안내와 라이딩 종료 후 투표를 알려드려요.</small></span>
          <input
            name="notifySafety"
            type="checkbox"
            defaultChecked={settings.notifications.safety}
            aria-label="안전과 노쇼 투표 알림"
          />
        </label>
        <button
          type="button"
          className="secondary wide"
          onClick={async () => {
            try {
              const { enablePushNotifications } = await import("./push");
              setSaved(await enablePushNotifications());
            } catch (error) {
              setSaved(
                error instanceof Error
                  ? error.message
                  : "푸시 알림을 켜지 못했습니다.",
              );
            }
          }}
        >
          <Bell size={17} />이 기기 푸시 알림 켜기
        </button>
        {saved && (
          <p className="status-message" role="status">
            {saved}
          </p>
        )}
        <button className="primary wide">안전 프로필·알림 저장</button>
      </form>
    </>
  );
}

function LoginPanel() {
  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(
    () =>
      auth
        ? onAuthStateChanged(auth, (next) => {
            setUser(next);
            if (next)
              void next
                .getIdTokenResult()
                .then((token) => setIsAdmin(token.claims.admin === true));
            else setIsAdmin(false);
          })
        : undefined,
    [],
  );
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!auth) return setMessage("Firebase 연결 설정이 필요합니다.");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setBusy(true);
    setMessage("");
    try {
      if (mode === "signup")
        await createUserWithEmailAndPassword(auth, email, password);
      else await signInWithEmailAndPassword(auth, email, password);
    } catch (reason) {
      const code = (reason as { code?: string }).code;
      setMessage(
        code === "auth/email-already-in-use"
          ? "이미 가입된 이메일입니다."
          : code === "auth/invalid-credential"
            ? "이메일 또는 비밀번호를 확인해 주세요."
            : code === "auth/weak-password"
              ? "비밀번호는 6자 이상 입력해 주세요."
              : "로그인 처리 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  };
  const requestAdmin = async () => {
    setBusy(true);
    setMessage("");
    try {
      await bootstrapAdmin();
      await user?.getIdToken(true);
      setIsAdmin(true);
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "관리자 권한을 확인하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };
  if (user)
    return (
      <section className="page profile">
        <CircleUserRound size={66} />
        <h1>라이더 프로필</h1>
        <p className="sub">
          <b>{user.email}</b>
          <br />
          로그인되어 있습니다.
        </p>
        {!user.emailVerified && (
          <button
            className="primary wide"
            onClick={() =>
              sendEmailVerification(user)
                .then(() =>
                  setMessage(
                    "인증 메일을 전송했습니다. 메일 인증 후 다시 로그인해 주세요.",
                  ),
                )
                .catch((error) =>
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : "인증 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.",
                  ),
                )
            }
          >
            이메일 인증 보내기
          </button>
        )}
        {isAdmin ? (
          <button
            className="admin-entry wide"
            onClick={() => {
              window.location.search = "?admin=1";
            }}
          >
            <ShieldCheck size={18} />
            관리자 페이지
          </button>
        ) : (
          <button
            className="secondary wide"
            disabled={busy}
            onClick={requestAdmin}
          >
            관리자 권한 확인
          </button>
        )}
        {message && <p className="form-error">{message}</p>}
        <ProfileTools />
        <button
          className="secondary wide"
          onClick={() => auth && signOut(auth)}
        >
          로그아웃
        </button>
        <article className="notice">
          <b>노쇼 정책</b>
          <p>
            라이딩 종료 후 참여자 투표에서 최소 3표·과반으로 확정된 경우에만
            기록됩니다.
          </p>
        </article>
      </section>
    );
  return (
    <section className="page profile login-panel">
      <CircleUserRound size={58} />
      <h1>{mode === "login" ? "로그인" : "이메일 회원가입"}</h1>
      <p className="sub">라이딩 참여와 계획 저장을 위해 로그인해 주세요.</p>
      <form onSubmit={submit}>
        <label>
          이메일
          <input
            required
            name="email"
            type="email"
            autoComplete="email"
            placeholder="rider@example.com"
          />
        </label>
        <label>
          비밀번호
          <input
            required
            name="password"
            type="password"
            minLength={6}
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            placeholder="6자 이상"
          />
        </label>
        {message && (
          <p className="form-error" role="alert" id="login-error">
            {message}
          </p>
        )}
        <button
          className="primary wide"
          type="submit"
          disabled={busy}
          aria-describedby={message ? "login-error" : undefined}
        >
          {busy
            ? "처리 중…"
            : mode === "login"
              ? "이메일로 로그인"
              : "회원가입 완료"}
        </button>
      </form>
      <button
        className="social-login wide"
        disabled={busy}
        onClick={async () => {
          if (!auth) return;
          setBusy(true);
          setMessage("");
          try {
            await signInWithPopup(auth, new GoogleAuthProvider());
          } catch (error) {
            const code = (error as { code?: string }).code;
            setMessage(
              code === "auth/operation-not-allowed"
                ? "Firebase 콘솔에서 Google 로그인 제공업체를 켜야 합니다."
                : "Google 로그인을 완료하지 못했습니다.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        G&nbsp; Google로 계속하기
      </button>
      <button
        className="text-button auth-switch"
        onClick={() => {
          setMode(mode === "login" ? "signup" : "login");
          setMessage("");
        }}
      >
        {mode === "login"
          ? "처음이신가요? 이메일로 회원가입"
          : "이미 계정이 있나요? 로그인"}
      </button>
      {mode === "login" && <button className="text-button" disabled={busy} onClick={async () => {
        const input = document.querySelector<HTMLInputElement>('.login-panel input[name="email"]');
        if (!input || !input.value.trim() || !input.reportValidity()) { input?.focus(); setMessage("이메일을 입력한 뒤 비밀번호 재설정을 눌러 주세요."); return; }
        if (!auth) { setMessage("로그인 연결을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요."); return; }
        setBusy(true); setMessage("");
        try { await sendPasswordResetEmail(auth, input.value.trim()); setMessage("가입된 이메일이라면 재설정 안내가 발송됩니다. 스팸함도 확인해 주세요."); }
        catch { setMessage("안내 메일 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요."); }
        finally { setBusy(false); }
      }}>비밀번호를 잊으셨나요?</button>}
      <article className="notice">
        <b>카카오 로그인</b>
        <p>
          카카오 계정 연결은 OAuth 보안 설정 후 제공됩니다. 현재는 이메일
          로그인을 이용해 주세요.
        </p>
      </article>
    </section>
  );
}

function SavedRideDetail({ plan, onBack }: { plan: SavedPlan; onBack: () => void }) {
  const [poiError, setPoiError] = useState("");
  const [poiRetry, setPoiRetry] = useState(0);
  const [route, setRoute] = useState<Coordinate[]>(plan.course.coordinates ?? []);
  const mapRoutes = useMemo(() => [route], [route]);
  const [stops, setStops] = useState(plan.course.stops ?? []);
  const [facilityFilter, setFacilityFilter] = useState<FacilityFilterValue>("전체");
  const filteredStops = useMemo(() => visibleFacilities(stops, facilityFilter), [stops, facilityFilter]);
  const [loadingPois, setLoadingPois] = useState(false);
  const [routeRecovery, setRouteRecovery] = useState<"idle" | "loading" | "error">("idle");
  const [routeMessage, setRouteMessage] = useState("이 라이딩에는 경로 좌표가 저장되어 있지 않습니다.");
  const [status, setStatus] = useState(plan.status);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  useEffect(() => {
    if (route.length >= 2) return;
    const startName = String(plan.course.startName ?? plan.startName ?? "").trim();
    const endName = String(plan.course.endName ?? "").trim();
    if (!startName) {
      setRouteRecovery("error");
      setRouteMessage("출발지 정보가 없어 경로를 자동 복구할 수 없습니다.");
      return;
    }
    let active = true;
    setRouteRecovery("loading");
    void recoverStoredRoute(startName, endName, Number(plan.course.distanceKm ?? 0))
      .then(async (repaired) => {
        if (!active) return;
        setRoute(repaired.coordinates);
        setRouteRecovery("idle");
        await repairRideCourse({ rideId: plan.id, ...repaired }).catch(() => undefined);
      })
      .catch(() => {
        if (!active) return;
        setRouteRecovery("error");
        setRouteMessage("기존 경로를 복구하지 못했습니다. 출발·도착지를 확인해 주세요.");
      });
    return () => {
      active = false;
    };
  }, [plan.id, plan.course.startName, plan.course.endName, plan.course.distanceKm, plan.startName, route.length]);
  useEffect(() => {
    if (stops.length || route.length < 2) return;
    let active = true;
    setPoiError("");
    setLoadingPois(true);
    void searchCoursePois(route)
      .then(rows => { if (active) { setStops(rows); setLoadingPois(false); } })
      .catch(() => { if (active) setPoiError("편의시설을 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요."); })
      .finally(() => { if (active) setLoadingPois(false); });
    return () => { active = false; };
  }, [route, stops.length, poiRetry]);
  return (
    <section className="page detail saved-detail">
      <button className="back" onClick={onBack}>← 내 라이딩으로</button>
      {routeRecovery === "loading" ? (
        <div className="map live-map"><div className="map-state" role="status"><b>출발·도착지로 자전거 경로 복구 중…</b></div></div>
      ) : (
        <CourseMap
          routes={mapRoutes}
          label={`${plan.title} 저장 코스`}
          stops={filteredStops}
          climbSegments={plan.course.climbSegments ?? []}
          missingRouteMessage={routeMessage}
        />
      )}
      {stops.length > 0 && <FacilityFilter stops={stops} value={facilityFilter} onChange={setFacilityFilter} />}
      <div className="detail-head">
        <div><span className="eyebrow">{status}</span><h1>{plan.title}</h1><p>{plan.startsAt ? fmt(plan.startsAt) : "날짜·시간 미정"}</p></div>
        {status === "진행중" ? (
          <button className="primary" disabled={busy} onClick={async()=>{setBusy(true);setActionError("");try{await finishPublicRide(plan.id);setStatus("완료")}catch(e){setActionError(e instanceof Error ? e.message : "라이딩 종료 처리를 완료하지 못했습니다.")}finally{setBusy(false)}}}>라이딩 종료</button>
        ) : ["계획","모집중","마감"].includes(status) ? (
          <button className="primary" disabled={busy} onClick={async()=>{setBusy(true);setActionError("");try{await startPublicRide(plan.id);setStatus("진행중")}catch(e){setActionError(e instanceof Error ? e.message : "라이딩 시작 처리를 완료하지 못했습니다.")}finally{setBusy(false)}}}>라이딩 시작</button>
        ) : null}
      </div>
      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      {["계획", "모집중", "마감", "완료"].includes(status) && <CancelRideButton rideId={plan.id} onCancelled={onBack} />}
      <div className="stat-grid">
        <span><Route />{Number(plan.course.distanceKm ?? 0)} km<small>거리</small></span>
        <span><Mountain />{Number(plan.course.elevationM ?? 0)} m<small>누적 상승</small></span>
        <span><Clock3 />{Number(plan.paceKmh ?? 0)} km/h<small>목표 평속</small></span>
      </div>
      {(plan.course.elevationProfile?.length ?? 0) > 1 && <ElevationChart points={plan.course.elevationProfile ?? []} />}
      {(plan.course.climbSegments?.length ?? 0) > 0 && (
        <article className="info climb-list"><h2><Mountain /> 업힐 구간</h2>{(plan.course.climbSegments ?? []).map((segment, index) => <p key={segment.id}><b>{index + 1}번째 업힐</b><span>{segment.startKm}–{segment.endKm}km · +{segment.gainM}m · 평균 {segment.avgGradient}%</span></p>)}</article>
      )}
      <article className="info">
        <h2>코스 주변 편의시설</h2>
        {poiError && <div role="alert"><p>{poiError}</p><button className="secondary" onClick={() => setPoiRetry(value => value + 1)}>편의시설 다시 불러오기</button></div>}
        <FacilityList stops={filteredStops} loading={loadingPois} />
      </article>
      {plan.description && <article className="info"><h2>라이딩 메모</h2><p>{plan.description}</p></article>}
    </section>
  );
}

function SavedGroupRide({ plan, onBack }: { plan: SavedPlan; onBack: () => void }) {
  const [ride, setRide] = useState<Ride | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setError("");
    void getRideDetails(plan.id)
      .then(setRide)
      .catch(() => setError("라이딩 상세를 불러오지 못했습니다. 다시 시도해 주세요."));
  }, [plan.id]);
  if (ride) return <RideDetail ride={ride} onBack={onBack} />;
  return (
    <section className="page">
      <button className="back" onClick={onBack}>← 내 라이딩으로</button>
      {error ? (
        <>
          <p className="form-error">{error}</p>
          <button className="secondary wide" onClick={() => {
            setError("");
            void getRideDetails(plan.id)
              .then(setRide)
              .catch(() => setError("라이딩 상세를 불러오지 못했습니다. 다시 시도해 주세요."));
          }}>다시 시도</button>
        </>
      ) : (
        <div className="skeleton-card" aria-label="라이딩 상세 불러오는 중" />
      )}
    </section>
  );
}

const localDateKey = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
function RideCalendar({ plans, selectedDate, onSelectDate }: { plans: SavedPlan[]; selectedDate: string; onSelectDate: (date: string) => void }) {
  const initial = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const next = plans
      .filter(plan => localDateKey(plan.startsAt) && new Date(plan.startsAt ?? 0).getTime() >= today.getTime())
      .sort((a, b) => new Date(a.startsAt ?? 0).getTime() - new Date(b.startsAt ?? 0).getTime())[0];
    const source = next?.startsAt ? new Date(next.startsAt) : new Date();
    return new Date(source.getFullYear(), source.getMonth(), 1);
  }, [plans]);
  const [month, setMonth] = useState(initial);
  useEffect(() => setMonth(initial), [initial]);
  const counts = useMemo(() => plans.reduce<Record<string, number>>((result, plan) => {
    const key = localDateKey(plan.startsAt);
    if (key) result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {}), [plans]);
  const firstOffset = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const todayKey = localDateKey(new Date().toISOString());
  return <section className="ride-calendar" aria-label="내 라이딩 캘린더">
    <div className="calendar-head">
      <button type="button" aria-label="이전 달" onClick={() => setMonth(value => new Date(value.getFullYear(), value.getMonth() - 1, 1))}>‹</button>
      <h2>{month.getFullYear()}년 {month.getMonth() + 1}월</h2>
      <button type="button" aria-label="다음 달" onClick={() => setMonth(value => new Date(value.getFullYear(), value.getMonth() + 1, 1))}>›</button>
    </div>
    <div className="calendar-weekdays" aria-hidden="true">{["일", "월", "화", "수", "목", "금", "토"].map(day => <span key={day}>{day}</span>)}</div>
    <div className="calendar-days">{Array.from({ length: firstOffset + days }, (_, index) => {
      if (index < firstOffset) return <span className="calendar-empty" key={`empty-${index}`} />;
      const day = index - firstOffset + 1;
      const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const count = counts[key] ?? 0;
      return <button type="button" key={key} className={`${selectedDate === key ? "selected" : ""} ${todayKey === key ? "today" : ""}`.trim()} aria-pressed={selectedDate === key} aria-current={todayKey === key ? "date" : undefined} aria-label={`${month.getMonth() + 1}월 ${day}일${todayKey === key ? ", 오늘" : ""}${count ? `, 라이딩 ${count}개` : ""}`} onClick={() => onSelectDate(selectedDate === key ? "" : key)}>
        <span>{day}</span>{count > 0 && <b>{count}</b>}
      </button>;
    })}</div>
  </section>;
}

function MyRides({ onLogin, onCreate }: { onLogin: () => void; onCreate: () => void }) {
  const [revision, setRevision] = useState(0);
  const [plans, setPlans] = useState<SavedPlan[]>(readPlans);
  const [selected, setSelected] = useState<SavedPlan | null>(null);
  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null);
  const [authReady, setAuthReady] = useState(!auth);
  const [loading, setLoading] = useState(Boolean(auth?.currentUser));
  const [loadError, setLoadError] = useState("");
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  useEffect(() => {
    if (!auth) return;
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, (next) => {
      if (!active) return;
      setUser(next);
      setAuthReady(true);
      if (!next) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError("");
      void listMyRidePlans()
        .then((rows) => active && setPlans(rows))
        .catch(() => active && setLoadError("저장한 라이딩을 불러오지 못했습니다."))
        .finally(() => active && setLoading(false));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [revision]);
  const returnToList = () => { setSelected(null); setRevision(value => value + 1); };
  if (!authReady)
    return <section className="page"><div className="skeleton-card" aria-label="로그인 상태 확인 중" /></section>;
  if (!user)
    return (
      <section className="page login-required-page">
        <CircleUserRound size={52} aria-hidden="true" />
        <h1>내 라이딩</h1>
        <p className="sub">로그인하면 저장한 코스와 참여 중인 라이딩을 확인할 수 있어요.</p>
        <button className="primary wide" onClick={onLogin}>로그인하러 가기</button>
      </section>
    );
  if (selected) return selected.purpose === "group" ? <SavedGroupRide plan={selected} onBack={returnToList} /> : <SavedRideDetail plan={selected} onBack={returnToList} />;
  const visiblePlans = selectedDate ? plans.filter(plan => localDateKey(plan.startsAt) === selectedDate) : plans;
  return (
    <section className="page">
      <div className="my-rides-head"><h1>내 라이딩</h1><button className="secondary" disabled={loading} onClick={() => setRevision(value => value + 1)}>{loading ? "불러오는 중…" : "새로고침"}</button></div>
      <RideCalendar plans={plans} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
      <div className="section-title"><div><h2>{selectedDate ? `${Number(selectedDate.slice(5, 7))}월 ${Number(selectedDate.slice(8, 10))}일 일정` : "전체 일정"}</h2><small>{visiblePlans.length}개</small></div>{selectedDate && <button onClick={() => setSelectedDate("")}>전체 보기</button>}</div>
      <div className="list">
        {loading && <div className="skeleton-card" aria-label="내 라이딩 불러오는 중" />}
        {loadError && <p className="form-error" role="alert">{loadError}</p>}
        {visiblePlans.map((plan) => (
          <article className="saved-plan" key={plan.id}>
            <button className="saved-plan-button" onClick={() => setSelected(plan)}>
              <span>{plan.purpose === "solo" ? "혼자 라이딩" : plan.status}</span>
              <ChevronRight size={18} />
              <h3>{plan.title}</h3>
              <p><MapPin size={14} />{String(plan.course.startName ?? plan.startName ?? "출발지 미정")}</p>
              <div><b>{Number(plan.course.distanceKm ?? plan.distanceKm ?? 0)}km</b><b>상승 {Number(plan.course.elevationM ?? plan.elevationM ?? 0)}m</b></div>
            </button>
            <button
              className="saved-plan-remove"
              aria-label={`${plan.title} 내 목록에서 삭제`}
              title="내 목록에서 삭제"
              onClick={() => setRemoveConfirmId(plan.id)}
            >
              <Trash2 size={17} aria-hidden="true" />
            </button>
            {removeConfirmId === plan.id && (
              <div className="saved-plan-confirm" role="alertdialog" aria-label="라이딩 목록 삭제 확인">
                <p>내 라이딩 목록에서 삭제할까요?</p>
                <small>다른 참여자의 방과 기록은 삭제되지 않습니다.</small>
                <div>
                  <button className="secondary" onClick={() => setRemoveConfirmId(null)}>취소</button>
                  <button
                    className="danger"
                    disabled={removingId === plan.id}
                    onClick={async () => {
                      setRemovingId(plan.id);
                      setLoadError("");
                      try {
                        await removeRideFromMyList(plan.id);
                        setPlans((current) => current.filter((row) => row.id !== plan.id));
                        setRemoveConfirmId(null);
                        try {
                          const legacy = readPlans().filter((row) => row.id !== plan.id);
                          localStorage.setItem("ridemate-plans", JSON.stringify(legacy));
                        } catch { /* 로컬 이전 데이터 정리는 실패해도 서버 목록에 영향 없음 */ }
                      } catch (error) {
                        setLoadError(error instanceof Error ? error.message : "목록에서 삭제하지 못했습니다.");
                      } finally {
                        setRemovingId(null);
                      }
                    }}
                  >
                    {removingId === plan.id ? "삭제 중…" : "목록에서 삭제"}
                  </button>
                </div>
              </div>
            )}
          </article>
        ))}
        {!loading && !loadError && !visiblePlans.length && (
          <div className="empty">
            <p>{selectedDate ? "이 날짜에는 라이딩이 없습니다." : "아직 저장한 라이딩이 없습니다."}</p>
            {!selectedDate && <button className="secondary wide" onClick={onCreate}><Plus size={16} aria-hidden="true" /> 첫 라이딩 만들기</button>}
          </div>
        )}
      </div>
    </section>
  );
}

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function App() {
  const [tab, setTab] = useState<Tab>(() => {
    const view = new URLSearchParams(window.location.search).get("view");
    if (view === "search") return "home";
    return ["home", "courses", "create", "my", "profile"].includes(String(view))
      ? (view as Tab)
      : "home";
  });
  const [selected, setSelected] = useState<Ride | null>(null);
  const [query, setQuery] = useState("");
  const [notificationRequested, setNotificationRequested] = useState(false);
  useEffect(() => {
    if (!notificationRequested || tab !== "profile" || selected) return;
    const focusSettings = () => {
      const target = document.getElementById("notification-settings");
      if (!target) return;
      target.scrollIntoView({ block: "start" });
      target.focus({ preventScroll: true });
      setNotificationRequested(false);
    };
    const observer = new MutationObserver(focusSettings);
    observer.observe(document.getElementById("main-content") ?? document.body, { childList: true, subtree: true });
    focusSettings();
    return () => observer.disconnect();
  }, [notificationRequested, tab, selected]);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(timer);
  }, [query]);
  const [rides, setRides] = useState<Ride[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState("");
  const [feedVersion, setFeedVersion] = useState(0);
  const [maxDistance, setMaxDistance] = useState(200);
  const [maxPace, setMaxPace] = useState(60);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [withinWeek, setWithinWeek] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
    null,
  );
  const [showOnboarding, setShowOnboarding] = useState(
    () => localStorage.getItem("ridemate-onboarded") !== "yes",
  );
  const [onboardingStep, setOnboardingStep] = useState(0);
  const isAdminView = useMemo(
    () => new URLSearchParams(window.location.search).get("admin") === "1",
    [],
  );
  useEffect(() => {
    setFeedLoading(true);
    setFeedError("");
    try {
      const cached = JSON.parse(
        localStorage.getItem("ridemate-public-feed") ?? "[]",
      ) as Ride[];
      if (cached.length) setRides(cached);
    } catch {
      /* 손상된 공개 캐시는 무시 */
    }
    void listPublicRides()
      .then((next) => {
        setRides(next);
        localStorage.setItem(
          "ridemate-public-feed",
          JSON.stringify(next.slice(0, 40)),
        );
      })
      .catch(() => setFeedError("새 목록을 불러오지 못해 저장된 최근 라이딩을 표시합니다."))
      .finally(() => setFeedLoading(false));
    void trackProductEvent("app_open").catch(() => undefined);
  }, [feedVersion]);
  useEffect(() => {
    const rideId = new URLSearchParams(window.location.search).get("ride");
    if (!rideId) return;
    void getRideDetails(rideId)
      .then(setSelected)
      .catch(() => setFeedError("공유된 라이딩을 찾을 수 없거나 모집이 종료되었습니다."));
  }, []);
  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);
  const filtered = useMemo(
    () => filterPublicRides(rides, debouncedQuery, maxDistance, maxPace, {
      onlyAvailable,
      upcomingOnly: true,
      withinDays: withinWeek ? 7 : undefined,
    }),
    [rides, debouncedQuery, maxDistance, maxPace, onlyAvailable, withinWeek],
  );
  const hasActiveFilters = Boolean(query || maxDistance < 200 || maxPace < 60 || onlyAvailable || withinWeek);
  const resetFilters = () => {
    setQuery("");
    setMaxDistance(200);
    setMaxPace(60);
    setOnlyAvailable(false);
    setWithinWeek(false);
  };
  const prevTab = useRef(tab);
  useEffect(() => {
    if (prevTab.current !== tab || selected) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      const mainContent = document.getElementById("main-content");
      if (mainContent) mainContent.focus({ preventScroll: true });
    }
    prevTab.current = tab;
  }, [tab, selected]);
  if (isAdminView)
    return (
      <main className="admin-app-shell">
        <Suspense
          fallback={
            <div
              className="skeleton-card"
              aria-label="관리자 페이지 불러오는 중"
            />
          }
        >
          <AdminPanel
            onClose={() => {
              window.location.href = window.location.pathname;
            }}
          />
        </Suspense>
      </main>
    );
  const finishOnboarding = () => {
    localStorage.setItem("ridemate-onboarded", "yes");
    setShowOnboarding(false);
    if (auth?.currentUser)
      void saveRiderSettings({ onboardingComplete: true }).catch(
        () => undefined,
      );
  };
  const content = selected ? (
    <RideDetail ride={selected} onBack={() => {
      setSelected(null);
      setFeedLoading(true);
      void listPublicRides().then(next => {
        setRides(next); setFeedError("");
        try { localStorage.setItem("ridemate-public-feed", JSON.stringify(next.slice(0, 40))); } catch { /* Storage may be unavailable. */ }
      }).catch(() => setFeedError("변경된 목록을 불러오지 못했습니다. 다시 접속해 주세요.")).finally(() => setFeedLoading(false));
      window.history.replaceState({}, "", window.location.pathname);
    }} />
  ) : tab === "create" ? (
    <CreateRide onCreated={() => setTab("my")} onLogin={() => setTab("profile")} onBack={() => setTab("home")} />
  ) : tab === "courses" ? (
    <CourseExplorer onCreate={() => setTab("create")} />
  ) : tab === "my" ? (
    <MyRides onLogin={() => setTab("profile")} onCreate={() => setTab("create")} />
  ) : tab === "profile" ? (
    <LoginPanel />
  ) : (
    <section className="page home-page">
      <div className="hero">
        <h1>
          오늘 함께 달릴
          <br />
          라이딩을 찾아보세요
        </h1>
      </div>
      <section className="home-search-panel" aria-labelledby="ride-search-title">
      <h2 id="ride-search-title">라이딩 찾기</h2>
      <div className="search" role="search">
        <Search size={18} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="지역 또는 코스 검색"
          aria-label="지역 또는 코스 검색"
        />
        {query && (
          <button aria-label="검색어 지우기" onClick={() => setQuery("")}>
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="filter-bar" role="group" aria-label="라이딩 필터">
        <div className="filter-field"><span>최대 거리</span>
          <SelectMenu label="최대 거리" value={String(maxDistance)} onChange={value => setMaxDistance(Number(value))} options={[{value:"30",label:"30km"},{value:"60",label:"60km"},{value:"100",label:"100km"},{value:"200",label:"전체"}]} />
        </div>
        <div className="filter-field"><span>최대 평속</span>
          <SelectMenu label="최대 평속" value={String(maxPace)} onChange={value => setMaxPace(Number(value))} options={[{value:"20",label:"20km/h"},{value:"25",label:"25km/h"},{value:"30",label:"30km/h"},{value:"60",label:"전체"}]} />
        </div>
      </div>
      <div className="quick-filters" role="group" aria-label="빠른 필터">
        <button
          className={onlyAvailable ? "active" : ""}
          aria-pressed={onlyAvailable}
          onClick={() => setOnlyAvailable((value) => !value)}
        >
          자리 있음
        </button>
        <button
          className={withinWeek ? "active" : ""}
          aria-pressed={withinWeek}
          onClick={() => setWithinWeek((value) => !value)}
        >
          7일 이내
        </button>
        {hasActiveFilters && <button className="reset" onClick={resetFilters}>초기화</button>}
      </div>
      </section>
      <div className="section-title">
        <div>
          <h2>{hasActiveFilters ? "검색 결과" : "지금 모집 중인 라이딩"}</h2>
          {!feedLoading && <small>{filtered.length}개의 라이딩</small>}
        </div>
        <button onClick={() => setFeedVersion((value) => value + 1)}>새로고침</button>
      </div>
      <div className="list">
        {feedLoading && (
          <>
            <div className="skeleton-card" />
            <div className="skeleton-card" />
          </>
        )}
        {feedError && (
          <p className="form-error" role="alert">
            {feedError}
            <button
              className="text-button"
              onClick={() => window.location.reload()}
            >
              다시 시도
            </button>
          </p>
        )}
        {filtered.map((ride) => (
          <RideCard
            key={ride.id}
            ride={ride}
            onOpen={() => {
              setSelected(ride);
              const url = new URL(window.location.href);
              url.search = "";
              url.searchParams.set("ride", ride.id);
              window.history.replaceState({}, "", url);
            }}
          />
        ))}
        {!feedLoading && !filtered.length && (
          <div className="empty" role="status">
            <p>조건에 맞는 라이딩이 없습니다.</p>
            <div className="empty-actions">
              {hasActiveFilters && <button className="secondary" onClick={resetFilters}>검색 조건 초기화</button>}
              <button className="primary" onClick={() => setTab("create")}>
                <Plus size={16} aria-hidden="true" /> 새 라이딩 만들기
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
  return (
    <main className="app-shell">
      <a href="#main-content" className="skip-nav">본문 바로가기</a>
      <header role="banner">
        <button
          onClick={() => {
            setTab("home");
            setSelected(null);
          }}
          className="logo"
        >
          RIDEMATE<span>라이딩 메이트</span>
        </button>
        <div className="header-actions">
          <button
            type="button"
            className="bell"
            aria-label="알림 설정"
            title="알림 설정"
            onClick={() => {
              setSelected(null);
              setTab("profile");
              setNotificationRequested(true);
              window.history.replaceState({}, "", `${window.location.pathname}?view=profile`);
            }}
          >
            <Bell size={20} />
          </button>
          <button
            type="button"
            className={`profile-shortcut ${tab === "profile" ? "current" : ""}`}
            aria-label="프로필"
            title="프로필"
            aria-current={tab === "profile" ? "page" : undefined}
            onClick={() => {
              setSelected(null);
              setTab("profile");
              setNotificationRequested(false);
              window.history.replaceState({}, "", `${window.location.pathname}?view=profile`);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <CircleUserRound size={21} />
          </button>
        </div>
      </header>
      {installPrompt && (
        <aside className="install-banner" role="complementary" aria-label="앱 설치 안내">
          <div>
            <b>홈 화면에 라이드메이트 설치</b>
            <small>더 빠르게 열고 최근 코스를 오프라인에서도 확인하세요.</small>
          </div>
          <button
            className="primary"
            onClick={async () => {
              await installPrompt.prompt();
              await installPrompt.userChoice;
              setInstallPrompt(null);
              void trackProductEvent("install_prompt").catch(() => undefined);
            }}
          >
            설치
          </button>
          <button
            aria-label="설치 안내 닫기"
            onClick={() => setInstallPrompt(null)}
          >
            <X />
          </button>
        </aside>
      )}
      <div id="main-content" tabIndex={-1}>
        {content}
      </div>
      <footer className="app-footer">
        <LegalLinks />
      </footer>
      {!selected && (
        <nav role="navigation" aria-label="메인 메뉴">
          {(
            [
              ["home", "홈"],
              ["courses", "코스"],
              ["create", "만들기"],
              ["my", "내 라이딩"],
            ] as [Tab, string][]
          ).map(([id, label]) => (              <button
                key={id}
                onClick={() => setTab(id)}
                className={`${tab === id ? "current" : ""} ${id === "create" ? "create-nav" : ""}`}
                aria-current={tab === id ? "page" : undefined}
              >
              {id === "create" ? (
                <Plus size={22} />
              ) : id === "courses" ? (
                <Compass size={21} />
              ) : id === "my" ? (
                <CalendarDays size={21} />
              ) : (
                <Route size={21} />
              )}
              <span>{label}</span>
            </button>
          ))}
        </nav>
      )}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {selected ? "라이딩 상세 화면으로 이동" : tab === "home" ? "홈 및 라이딩 탐색 화면" : tab === "courses" ? "코스 탐색 화면" : tab === "create" ? "라이딩 만들기 화면" : tab === "my" ? "내 라이딩 화면" : "프로필 화면"}
      </div>
      {showOnboarding && (
        <div className="modal-backdrop" onClick={finishOnboarding} onKeyDown={(e) => { if (e.key === "Escape") finishOnboarding(); }}>
          <section
            className="onboarding"
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboarding-title"
            aria-describedby="onboarding-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <span>{onboardingStep + 1}/3</span>
            <div className="onboarding-icon">
              {onboardingStep === 0 ? (
                <Route />
              ) : onboardingStep === 1 ? (
                <Users />
              ) : (
                <ShieldCheck />
              )}
            </div>
            <h1 id="onboarding-title">
              {onboardingStep === 0
                ? "검증된 자전거 코스"
                : onboardingStep === 1
                  ? "조건이 맞는 라이더와 함께"
                  : "안전을 직접 통제하세요"}
            </h1>
            <p id="onboarding-desc">
              {onboardingStep === 0
                ? "거리·업힐을 입력하면 자전거 경로와 실제 상승고도를 검증해 3개 후보를 보여드려요."
                : onboardingStep === 1
                  ? "지역·거리·평속으로 방을 찾고, 참여자 채팅으로 정차 지점을 정할 수 있어요."
                  : "비상연락처, 신고·차단, 15분 위치 공유와 노쇼 투표로 안전한 만남을 도와요."}
            </p>
            <div className="onboarding-actions">
              <button className="text-button" onClick={finishOnboarding}>
                건너뛰기
              </button>
              <button
                className="primary"
                onClick={() =>
                  onboardingStep < 2
                    ? setOnboardingStep(onboardingStep + 1)
                    : finishOnboarding()
                }
              >
                {onboardingStep < 2 ? "다음" : "시작하기"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
