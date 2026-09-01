import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CalendarDays,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Heart,
  LifeBuoy,
  MapPin,
  MessageCircle,
  Mountain,
  Plus,
  Route,
  Search,
  ShieldCheck,
  Star,
  Users,
  X,
} from "lucide-react";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
const AdminPanel = lazy(() => import("./AdminPanel"));
import { auth } from "./firebase";
import { buildRideStart, filterPublicRides } from "./domain";
import { geocodePlace, loadKakaoMaps, searchCoursePois } from "./kakao";
import {
  bootstrapAdmin,
  createRideReview,
  createRidePlan,
  getRideDetails,
  getRiderSettings,
  getRideWeather,
  joinPublicRide,
  leavePublicRide,
  listFavoriteRides,
  listMyRidePlans,
  listPublicRides,
  listRideMessages,
  reportUser,
  requestCourseCandidates,
  requestManualRoute,
  saveRiderSettings,
  sendRideMessage,
  setFavoriteRide,
  setUserBlocked,
  trackProductEvent,
  updateLiveLocation,
  type RideMessage,
  type RidePlanInput,
  type RiderSettings,
} from "./services";
import type { Coordinate, ElevationPoint, Ride, RouteCandidate, Stop } from "./types";

type Tab = "home" | "search" | "create" | "my" | "profile";
const fmt = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
const routeColors = ["#087458", "#ef7d5f", "#4e65c5"];
const emptyStops: Stop[] = [];
type SavedPlan = {
  id: string;
  title: string;
  purpose: "group" | "solo";
  distanceKm: number;
  elevationM: number;
  startName: string;
  createdAt: string;
};
const readPlans = (): SavedPlan[] => {
  try {
    return JSON.parse(
      localStorage.getItem("ridemate-plans") ?? "[]",
    ) as SavedPlan[];
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
const parseGpx = async (file?: File) => {
  if (!file) return undefined;
  const xml = new DOMParser().parseFromString(
    await file.text(),
    "application/xml",
  );
  if (xml.querySelector("parsererror"))
    throw new Error("GPX 파일 형식을 확인해 주세요.");
  const points = [...xml.querySelectorAll("trkpt, rtept")]
    .map((node) => ({
      lat: Number(node.getAttribute("lat")),
      lng: Number(node.getAttribute("lon")),
      elevationM: Number(node.querySelector("ele")?.textContent ?? 0),
    }))
    .filter(
      (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng),
    );
  if (points.length < 2)
    throw new Error("GPX에 경로 지점이 2개 이상 필요합니다.");
  let distanceKm = 0;
  let elevationM = 0;
  const profile = points.map((point, index) => {
    if (index) {
      const previous = points[index - 1];
      const lat = (point.lat - previous.lat) * 111;
      const lng = (point.lng - previous.lng) * 88;
      distanceKm += Math.hypot(lat, lng);
      elevationM += Math.max(0, point.elevationM - previous.elevationM);
    }
    return {
      distanceKm: Math.round(distanceKm * 100) / 100,
      elevationM: Math.round(point.elevationM),
    };
  });
  const step = Math.max(1, Math.ceil(profile.length / 120));
  return {
    coordinates: points.map(({ lat, lng }) => ({ lat, lng })),
    distanceKm: Math.round(distanceKm * 10) / 10,
    elevationM: Math.round(elevationM),
    elevationProfile: profile.filter(
      (_, index) => index % step === 0 || index === profile.length - 1,
    ),
  };
};

function CourseMap({
  routes,
  selected = 0,
  label = "코스 지도",
  stops = emptyStops,
}: {
  routes: Coordinate[][];
  selected?: number;
  label?: string;
  stops?: Stop[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [message, setMessage] = useState("카카오맵 불러오는 중…");
  useEffect(() => {
    let active = true;
    setStatus("loading");
    loadKakaoMaps()
      .then((kakao) => {
        if (
          !active ||
          !container.current ||
          !routes.some((route) => route.length)
        )
          return;
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
        stops.forEach(stop=>new kakao.maps.Marker({position:new kakao.maps.LatLng(stop.coordinate.lat,stop.coordinate.lng),map,title:`${stop.kind} · ${stop.name}`}));
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
  }, [routes, selected, stops]);
  return (
    <div
      className={`map live-map ${status === "error" ? "map-error" : ""}`}
      ref={container}
      aria-label={label}
    >
      {status !== "ready" && (
        <div className="map-state">
          <b>{status === "error" ? "지도를 표시할 수 없어요" : message}</b>
          {status === "error" && (
            <small>
              {message}
              <br />
              카카오 JavaScript SDK 도메인에 현재 주소를 등록해 주세요.
            </small>
          )}
        </div>
      )}
      {status === "ready" && (
        <>
          <span className="map-label">카카오맵 위 · 자전거 경로</span>
          <span className="cycle-badge">자동차 길찾기 아님 · ORS cycling</span>
        </>
      )}
    </div>
  );
}

function ElevationChart({ points }: { points: ElevationPoint[] }) {
  if (points.length < 2) return null;
  const width = 420;
  const height = 145;
  const padX = 12;
  const padTop = 12;
  const padBottom = 24;
  const min = Math.min(...points.map((point) => point.elevationM));
  const max = Math.max(...points.map((point) => point.elevationM));
  const range = Math.max(max - min, 1);
  const distance = Math.max(points.at(-1)?.distanceKm ?? 1, 1);
  const coordinates = points.map((point) => ({
    x: padX + (point.distanceKm / distance) * (width - padX * 2),
    y:
      padTop +
      ((max - point.elevationM) / range) * (height - padTop - padBottom),
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
        aria-label={`거리 ${distance.toFixed(1)}킬로미터의 고도 그래프`}
      >
        <path className="elevation-area" d={area} />
        <path className="elevation-line" d={line} />
        <text x={padX} y={height - 6}>
          0km
        </text>
        <text x={width - padX} y={height - 6} textAnchor="end">
          {distance.toFixed(1)}km
        </text>
      </svg>
    </article>
  );
}

function RideCard({ ride, onOpen }: { ride: Ride; onOpen: () => void }) {
  return (
    <button className="ride-card" onClick={onOpen}>
      <div className="ride-date">
        <CalendarDays size={16} />
        {fmt(ride.startsAt)}
      </div>
      <h3>{ride.title}</h3>
      <p>
        {ride.course.startName} · {ride.course.distanceKm}km · 상승{" "}
        {ride.course.elevationM}m
      </p>
      <div className="ride-meta">
        <span>
          <Users size={16} />
          {ride.memberCount ?? ride.members?.length ?? 1}/{ride.capacity}
        </span>
        <span>{ride.paceKmh}km/h</span>
        <span className="open">{ride.status}</span>
        <ChevronRight size={18} />
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
  const [favorite, setFavorite] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [weather, setWeather] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
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
    if (joined)
      void listRideMessages(ride.id)
        .then(setChat)
        .catch(() => undefined);
  }, [joined, ride.id]);
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
    } finally {
      setBusy(false);
    }
  };
  const toggleLocation = async () => {
    if (sharing) {
      await updateLiveLocation({ rideId: ride.id, active: false });
      setSharing(false);
      return;
    }
    if (!navigator.geolocation)
      return setMessage("이 기기에서는 위치 공유를 지원하지 않습니다.");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          await updateLiveLocation({
            rideId: ride.id,
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            active: true,
          });
          setSharing(true);
          setMessage("15분 동안 참여자 안전 확인용 위치를 공유합니다.");
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
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };
  const targetId = ride.hostId ?? ride.host?.id;
  const members = ride.members ?? [];
  const stops = ride.course.stops ?? [];
  return (
    <section className="page detail">
      <button className="back" onClick={onBack}>
        ← 목록으로
      </button>
      <CourseMap
        routes={[ride.course.coordinates ?? []]}
        label={ride.course.title}
        stops={ride.course.stops ?? emptyStops}
      />
      <div className="detail-head">
        <div>
          <span className="eyebrow">{ride.status}</span>
          <h1>{ride.title}</h1>
          <p>{fmt(ride.startsAt)}</p>
        </div>
        <button
          disabled={busy}
          className={joined ? "secondary" : "primary"}
          onClick={toggleJoin}
        >
          {busy ? "처리 중…" : joined ? "참여 취소" : "라이딩 참여"}
        </button>
      </div>
      {message && (
        <p className="status-message" role="status">
          {message}
        </p>
      )}
      <div className="detail-actions">
        <button
          aria-pressed={favorite}
          onClick={async () => {
            if (!auth?.currentUser) return setMessage("로그인이 필요합니다.");
            await setFavoriteRide(ride.id, !favorite);
            setFavorite(!favorite);
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
            <textarea name="details" maxLength={1000} />
          </label>
          <div className="inline-actions">
            <button
              type="button"
              className="secondary"
              onClick={async () => {
                await setUserBlocked(targetId, true);
                setReportOpen(false);
                setMessage("이 사용자를 차단했습니다.");
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
      <div className="stat-grid">
        <span>
          <Route />
          {ride.course.distanceKm} km<small>거리</small>
        </span>
        <span>
          <Mountain />
          {ride.course.elevationM} m<small>누적 상승</small>
        </span>
        <span>
          <Clock3 />
          {ride.paceKmh} km/h<small>목표 평속</small>
        </span>
      </div>
      {weather && (
        <article className="info weather">
          <h2>출발지 날씨</h2>
          <p>{weather}</p>
        </article>
      )}
      <article className="info">
        <h2>집합 장소</h2>
        <p>
          <MapPin size={17} />
          {ride.meetingNote || ride.course.startName}
        </p>
        {ride.description && <p>{ride.description}</p>}
      </article>
      <article className="info">
        <h2>코스 정차 지점</h2>
        {stops.length ? (
          stops.map((stop) => (
            <p key={stop.id}>
              <span className="dot" />
              {stop.name}
              <em>
                {stop.kind}
                {stop.selected ? " · 확정" : ""}
              </em>
            </p>
          ))
        ) : (
          <p className="muted">아직 확정된 정차 지점이 없습니다.</p>
        )}
      </article>
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
              <Star /> 라이딩 후기
            </h2>
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                await createRideReview({
                  rideId: ride.id,
                  targetUserId: String(form.get("targetUserId")),
                  rating: Number(form.get("rating")),
                  comment: String(form.get("comment") ?? ""),
                });
                setMessage("후기를 등록했습니다.");
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
        <article className="info chat">
          <h2>
            <MessageCircle /> 참여자 대화
          </h2>
          <div className="chat-log" aria-live="polite">
            {chat.map((row) => (
              <p key={row.id}>
                <b>{row.authorName}</b>
                <span>{row.text}</span>
              </p>
            ))}
            {!chat.length && (
              <p className="muted">집합 장소와 정차 지점을 함께 정해보세요.</p>
            )}
          </div>
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
  const hours = Array.from({ length: 12 }, (_, index) => index + 1);
  return (
    <fieldset className="date-time-fields">
      <legend>
        출발 날짜와 시간 {optional && <span className="optional">선택</span>}
      </legend>
      <div className="date-time-grid">
        <label className="date-field">
          날짜
          <input required={!optional} name="rideDate" type="date" />
        </label>
        <label>
          오전·오후
          <select required={!optional} name="ridePeriod" defaultValue="AM">
            <option value="AM">오전</option>
            <option value="PM">오후</option>
          </select>
        </label>
        <label>
          시
          <select required={!optional} name="rideHour" defaultValue="8">
            {hours.map((hour) => (
              <option key={hour} value={hour}>
                {hour}시
              </option>
            ))}
          </select>
        </label>
        <label>
          분
          <select required={!optional} name="rideMinute" defaultValue="00">
            <option value="00">00분</option>
            <option value="10">10분</option>
            <option value="20">20분</option>
            <option value="30">30분</option>
            <option value="40">40분</option>
            <option value="50">50분</option>
          </select>
        </label>
      </div>
      <small className="field-help">
        {optional
          ? "일정을 정하지 않았다면 비워두어도 됩니다."
          : "예: 9월 5일 · 오전 8시 30분"}
      </small>
    </fieldset>
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
            모집 인원
            <input
              name="capacity"
              required
              type="number"
              min="2"
              max="50"
              defaultValue="6"
            />
          </label>
        )}
      </div>
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
  const [selected, setSelected] = useState(0);
  const [saving, setSaving] = useState(false);
  const [pois,setPois]=useState<Stop[]>([]); const [poisLoading,setPoisLoading]=useState(false);
  useEffect(()=>{let active=true;setPoisLoading(true);void searchCoursePois(candidates[selected]?.coordinates??[]).then(rows=>{if(active)setPois(rows)}).catch(()=>{if(active)setPois([])}).finally(()=>{if(active)setPoisLoading(false)});return()=>{active=false}},[candidates,selected]);
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
      candidate.startName ?? String(metadata.startName ?? "AI 추천 출발지");
    setSaving(true);
    try {
      if (!auth?.currentUser)
        throw new Error(
          "모집 방과 개인 계획을 저장하려면 먼저 로그인해 주세요.",
        );
      await createRidePlan({
        title: candidate.title,
        purpose: solo ? "solo" : "group",
        startName,
        endName: candidate.title,
        startsAt: metadata.startsAt,
        distanceKm: candidate.distanceKm,
        elevationM: candidate.elevationM,
        paceKmh: metadata.paceKmh,
        capacity: metadata.capacity,
        description: metadata.description,
        coordinates: candidate.coordinates,
        elevationProfile: candidate.elevationProfile,
        stops: pois,
      });
      await trackProductEvent("course_created");
      sessionStorage.removeItem("ridemate-create-draft");
      onCreated();
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="candidate-results">
      <div className="result-head">
        <div>
          <span className="eyebrow">자전거 경로·고도 검증 완료</span>
          <h2>추천 코스 {candidates.length}개</h2>
        </div>
        <button className="text-button" onClick={onReset}>
          조건 수정
        </button>
      </div>
      <CourseMap
        routes={candidates.map((candidate) => candidate.coordinates)}
        selected={selected}
        label="추천 후보 비교"
        stops={pois}
      />
      <ElevationChart points={candidates[selected]?.elevationProfile ?? []} />
      <article className="poi-summary"><b>코스 주변 시설</b><p>{poisLoading?'편의점·화장실·정비소 찾는 중…':pois.length?`${pois.filter(p=>p.kind==='편의점').length} 편의점 · ${pois.filter(p=>p.kind==='화장실').length} 화장실 · ${pois.filter(p=>p.kind==='정비소').length} 정비소`:'주변 시설 검색 결과가 없습니다.'}</p><div>{pois.slice(0,6).map(stop=><span key={stop.id}>{stop.kind} · {stop.name}</span>)}</div></article>
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
              <p>{candidate.summary}</p>
              <small>
                {candidate.distanceKm}km · 상승 {candidate.elevationM}m · km당{" "}
                {candidate.climbRate}m
              </small>
            </div>
            <span
              className={`verified ${candidate.recommended ? "recommended" : ""}`}
            >
              {candidate.recommended
                ? `추천 · ${candidate.waterwayName ?? "수변길"}`
                : "검증됨"}
            </span>
          </button>
        ))}
      </div>
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

function CreateRide({ onCreated }: { onCreated: () => void }) {
  const [purpose, setPurpose] = useState<"group" | "solo">("group");
  const [mode, setMode] = useState<"ai" | "manual">("ai");
  const [tripType, setTripType] = useState<"round" | "oneway">("round");
  const [candidates, setCandidates] = useState<RouteCandidate[]>([]);
  const [, setDraft] = useState<Partial<RidePlanInput>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [manualDone, setManualDone] = useState(false);
  const solo = purpose === "solo";
  const submitAi = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!auth?.currentUser) {
      setError("먼저 로그인한 뒤 코스를 만들 수 있어요.");
      return;
    }
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const place = await geocodePlace(String(form.get("startName")));
      const metadata: Partial<RidePlanInput> = {
        startName: place.name,
        startsAt: startsAtFrom(form),
        paceKmh: Number(form.get("paceKmh")),
        capacity: solo ? 1 : Number(form.get("capacity")),
        description: String(form.get("description") ?? ""),
      };
      setDraft(metadata);
      sessionStorage.setItem("ridemate-create-draft", JSON.stringify(metadata));
      const result = await requestCourseCandidates({
        start: { lat: place.lat, lng: place.lng },
        startName: place.name,
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
      const file =
        form.get("gpx") instanceof File && (form.get("gpx") as File).size
          ? (form.get("gpx") as File)
          : undefined;
      const uploaded = await parseGpx(file);
      const routed =
        uploaded ??
        (await (async () => {
          const [start, end] = await Promise.all([
            geocodePlace(String(form.get("manualStart"))),
            geocodePlace(String(form.get("manualEnd"))),
          ]);
          return requestManualRoute(
            { lat: start.lat, lng: start.lng },
            { lat: end.lat, lng: end.lng },
          );
        })());
      const stops = await searchCoursePois(routed.coordinates).catch(()=>[] as Stop[]);
      await createRidePlan({
        title: String(form.get("title")),
        purpose,
        startName: String(form.get("manualStart")),
        endName: String(form.get("manualEnd")),
        startsAt: startsAtFrom(form),
        distanceKm:
          uploaded?.distanceKm ||
          Number(form.get("manualDistance")) ||
          routed.distanceKm,
        elevationM: routed.elevationM,
        paceKmh: Number(form.get("paceKmh")),
        capacity: solo ? 1 : Number(form.get("capacity")),
        description: String(form.get("description") ?? ""),
        coordinates: routed.coordinates,
        elevationProfile: routed.elevationProfile,
        stops,
      });
      await trackProductEvent("course_created");
      setManualDone(true);
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
            : "입력한 내용으로 모집 방을 만들 준비가 됐습니다."}
        </p>
        <button className="primary wide" onClick={onCreated}>
          라이딩 보기
        </button>
      </section>
    );
  return (
    <section className="page create-page">
      <h1>{solo ? "혼자 라이딩 계획" : "라이딩 만들기"}</h1>
      <p className="sub">
        함께 달릴 방을 만들거나 나만의 코스를 계획할 수 있어요.
      </p>
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
          <small>라이더를 모집해요</small>
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
          <small>내 계획만 저장해요</small>
        </button>
      </div>
      <div className="mode-cards">
        <button
          className={mode === "ai" ? "active" : ""}
          onClick={() => {
            setMode("ai");
            setCandidates([]);
          }}
        >
          <Route />
          <b>AI 코스 추천</b>
          <small>거리·업힐 조건으로 3개 추천</small>
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
          <small>출발·도착·정차 정보를 수동 작성</small>
        </button>
      </div>
      {mode === "ai" && candidates.length ? (
        <CandidateResults
          candidates={candidates}
          onReset={() => setCandidates([])}
          onCreated={onCreated}
          solo={solo}
        />
      ) : mode === "ai" ? (
        <form onSubmit={submitAi}>
          <label>
            출발 지점
            <input
              name="startName"
              required
              placeholder="예: 여의나루역, 광나루 자전거공원"
            />
          </label>
          <div className="two">
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
            <label>
              희망 업힐 정도
              <select name="uphill" defaultValue="medium">
                <option value="low">평지 위주</option>
                <option value="medium">적당한 업힐</option>
                <option value="high">업힐 도전</option>
              </select>
            </label>
          </div>
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
              ? "AI 후보 생성·자전거 경로·고도 검증 중…"
              : "추천 코스 3개 찾기"}
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
          <label>
            출발 지점
            <input
              name="manualStart"
              required
              placeholder="출발 장소를 입력하세요"
            />
          </label>
          <label>
            도착 지점
            <input
              name="manualEnd"
              required
              placeholder="도착 장소를 입력하세요"
            />
          </label>
          <div className="two">
            <label>
              예상 거리
              <input
                name="manualDistance"
                required
                type="number"
                min="1"
                step="0.1"
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
          <label>
            코스 파일 <span className="optional">선택</span>
            <input name="gpx" type="file" accept=".gpx,application/gpx+xml" />
          </label>
          <CommonRideFields solo={solo} />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary wide" type="submit" disabled={loading}>
            {loading
              ? "자전거 경로·고도 검증 중…"
              : solo
                ? "혼자 라이딩 계획 저장"
                : "직접 입력으로 방 만들기"}
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
    <div className="modal-backdrop" role="presentation">
      <section
        className="legal-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-title"
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

function LegalLinks(){const [legal,setLegal]=useState<keyof typeof legalCopy|null>(null);return <><div className="legal-links"><button onClick={()=>setLegal('terms')}>이용약관</button><button onClick={()=>setLegal('privacy')}>개인정보처리방침</button><button onClick={()=>setLegal('location')}>위치서비스 안내</button></div>{legal&&<LegalSheet kind={legal} onClose={()=>setLegal(null)}/>}</>}

function ProfileTools() {
  const [settings, setSettings] = useState<RiderSettings | null>(null);
  const [saved, setSaved] = useState("");
  const [legal, setLegal] = useState<keyof typeof legalCopy | null>(null);
  useEffect(() => {
    void getRiderSettings()
      .then(setSettings)
      .catch(() => undefined);
  }, []);
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
        <h2>알림 설정</h2>
        <label className="switch-row">
          <input
            name="notifyRide"
            type="checkbox"
            defaultChecked={settings.notifications.ride}
          />
          라이딩 일정·참여 알림
        </label>
        <label className="switch-row">
          <input
            name="notifyChat"
            type="checkbox"
            defaultChecked={settings.notifications.chat}
          />
          참여자 채팅 알림
        </label>
        <label className="switch-row">
          <input
            name="notifySafety"
            type="checkbox"
            defaultChecked={settings.notifications.safety}
          />
          안전·노쇼 투표 알림
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
      <div className="legal-links">
        <button onClick={() => setLegal("terms")}>이용약관</button>
        <button onClick={() => setLegal("privacy")}>개인정보처리방침</button>
        <button onClick={() => setLegal("location")}>위치서비스 안내</button>
      </div>
      {legal && <LegalSheet kind={legal} onClose={() => setLegal(null)} />}
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
              sendEmailVerification(user).then(() =>
                setMessage(
                  "인증 메일을 전송했습니다. 메일 인증 후 다시 로그인해 주세요.",
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
          <p className="form-error" role="alert">
            {message}
          </p>
        )}
        <button className="primary wide" type="submit" disabled={busy}>
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
      <article className="notice">
        <b>카카오 로그인</b>
        <p>
          카카오 계정 연결은 OAuth 보안 설정 후 제공됩니다. 현재는 이메일
          로그인을 이용해 주세요.
        </p>
      </article>
      <LegalLinks />
    </section>
  );
}

function MyRides() {
  const [plans, setPlans] = useState(readPlans);
  const remove = (id: string) => {
    const next = plans.filter((plan) => plan.id !== id);
    localStorage.setItem("ridemate-plans", JSON.stringify(next));
    setPlans(next);
  };
  useEffect(() => {
    if (auth?.currentUser)
      void listMyRidePlans()
        .then((rows) =>
          setPlans(
            rows.map((row) => ({
              id: row.id,
              title: row.title,
              purpose: row.purpose,
              distanceKm: Number(row.course.distanceKm ?? 0),
              elevationM: Number(row.course.elevationM ?? 0),
              startName: String(row.course.startName ?? "-"),
              createdAt: row.createdAt ?? "",
            })),
          ),
        )
        .catch(() => undefined);
  }, []);
  return (
    <section className="page">
      <h1>내 라이딩</h1>
      <p className="sub">이 기기에 저장한 모집 방과 혼자 라이딩 계획입니다.</p>
      <div className="list">
        {plans.map((plan) => (
          <article className="saved-plan" key={plan.id}>
            <span>
              {plan.purpose === "solo" ? "혼자 라이딩" : "함께 라이딩"}
            </span>
            <button
              aria-label={`${plan.title} 삭제`}
              onClick={() => remove(plan.id)}
            >
              <X size={16} />
            </button>
            <h3>{plan.title}</h3>
            <p>
              <MapPin size={14} />
              {plan.startName}
            </p>
            <div>
              <b>{plan.distanceKm}km</b>
              <b>
                상승 {plan.elevationM ? `${plan.elevationM}m` : "수동 입력"}
              </b>
            </div>
          </article>
        ))}
        {!plans.length && (
          <p className="empty">
            아직 저장한 라이딩이 없습니다.
            <br />
            만들기에서 첫 계획을 세워보세요.
          </p>
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
    return ["home", "search", "create", "my", "profile"].includes(String(view))
      ? (view as Tab)
      : "home";
  });
  const [selected, setSelected] = useState<Ride | null>(null);
  const [query, setQuery] = useState("");
  const [rides, setRides] = useState<Ride[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState("");
  const [maxDistance, setMaxDistance] = useState(200);
  const [maxPace, setMaxPace] = useState(60);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
    null,
  );
  const [showOnboarding, setShowOnboarding] = useState(
    () => localStorage.getItem("ridemate-onboarded") !== "yes",
  );
  const [onboardingStep, setOnboardingStep] = useState(0);
  useEffect(() => {
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
    () => filterPublicRides(rides, query, maxDistance, maxPace),
    [rides, query, maxDistance, maxPace],
  );
  if (new URLSearchParams(window.location.search).get("admin") === "1")
    return (
      <main className="app-shell">
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
    <RideDetail ride={selected} onBack={() => setSelected(null)} />
  ) : tab === "create" ? (
    <CreateRide onCreated={() => setTab("my")} />
  ) : tab === "my" ? (
    <MyRides />
  ) : tab === "profile" ? (
    <LoginPanel />
  ) : (
    <section className="page">
      <div className="hero">
        <span>함께 달리는 더 안전한 라이딩</span>
        <h1>
          오늘, 누구와
          <br />
          어디로 달릴까요?
        </h1>
        <button className="hero-action" onClick={() => setTab("create")}>
          <Plus size={18} />
          라이딩 만들기
        </button>
      </div>
      <div className="search">
        <Search size={18} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="지역 또는 코스 검색"
        />
        <button aria-label="검색어 지우기" onClick={() => setQuery("")}>
          <X size={16} />
        </button>
      </div>
      <div className="filter-bar" aria-label="라이딩 필터">
        <label>
          최대 거리
          <select
            value={maxDistance}
            onChange={(event) => setMaxDistance(Number(event.target.value))}
          >
            <option value="30">30km</option>
            <option value="60">60km</option>
            <option value="100">100km</option>
            <option value="200">전체</option>
          </select>
        </label>
        <label>
          최대 평속
          <select
            value={maxPace}
            onChange={(event) => setMaxPace(Number(event.target.value))}
          >
            <option value="20">20km/h</option>
            <option value="25">25km/h</option>
            <option value="30">30km/h</option>
            <option value="60">전체</option>
          </select>
        </label>
      </div>
      <div className="section-title">
        <h2>{tab === "search" ? "검색 결과" : "지금 모집 중인 라이딩"}</h2>
        <button onClick={() => setTab("search")}>전체 보기</button>
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
            onOpen={() => setSelected(ride)}
          />
        ))}
        {!feedLoading && !filtered.length && (
          <p className="empty">조건에 맞는 라이딩이 없습니다.</p>
        )}
      </div>
    </section>
  );
  return (
    <main className="app-shell">
      <header>
        <button
          onClick={() => {
            setTab("home");
            setSelected(null);
          }}
          className="logo"
        >
          RIDEMATE<span>라이딩 메이트</span>
        </button>
        <button
          className="bell"
          aria-label="알림 설정"
          onClick={() => setTab("profile")}
        >
          <Bell size={20} />
        </button>
      </header>
      {installPrompt && (
        <aside className="install-banner">
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
      {content}
      {!selected && (
        <nav>
          {(
            [
              ["home", "홈"],
              ["search", "탐색"],
              ["create", "만들기"],
              ["my", "내 라이딩"],
              ["profile", "프로필"],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={tab === id ? "current" : ""}
            >
              {id === "create" ? (
                <Plus size={22} />
              ) : id === "search" ? (
                <Search size={21} />
              ) : id === "profile" ? (
                <CircleUserRound size={21} />
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
      {showOnboarding && (
        <div className="modal-backdrop">
          <section
            className="onboarding"
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboarding-title"
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
            <p>
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
