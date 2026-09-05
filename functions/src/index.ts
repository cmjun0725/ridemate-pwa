import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { HttpsError, onCall } from "firebase-functions/https";
import { onDocumentCreated } from "firebase-functions/firestore";
import { defineSecret } from "firebase-functions/params";
import { createHash } from "node:crypto";

initializeApp();
const db = getFirestore();
const region = "asia-northeast3";
const openRouteServiceKey = defineSecret("OPENROUTESERVICE_API_KEY");
const adminEmails = defineSecret("ADMIN_EMAILS");
const requireAuth = (uid?: string) => {
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
};
const requireAdmin = (request: {
  auth?: { token?: Record<string, unknown>; uid?: string };
}) => {
  requireAuth(request.auth?.uid);
  if (request.auth?.token?.admin !== true)
    throw new HttpsError("permission-denied", "관리자 권한이 필요합니다.");
};
const audit = (
  adminId: string,
  action: string,
  targetType: string,
  targetId: string,
  details: Record<string, unknown> = {},
) =>
  db.collection("auditLogs").add({
    adminId,
    action,
    targetType,
    targetId,
    details,
    createdAt: FieldValue.serverTimestamp(),
  });

const blockedRideTerms = [
  "씨발",
  "시발",
  "개새끼",
  "병신",
  "좆",
  "보지",
  "자지",
  "섹스",
  "강간",
  "fuck",
  "sex",
];
const hasBlockedRideContent = (...values: Array<string | undefined>) => {
  const normalized = values
    .join(" ")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s._\-~!@#$%^&*()+=[\]{}|\\/<>?,:;'"`]+/g, "");
  return blockedRideTerms.some((term) => normalized.includes(term));
};

type Point = { lat: number; lng: number };
type TripType = "round" | "oneway";
type UphillLevel = "low" | "medium" | "high";
type RouteSeed = {
  bearing: number;
  direction: string;
  waypoints: Point[];
};
type ClimbSegment = {
  id: string;
  startKm: number;
  endKm: number;
  gainM: number;
  avgGradient: number;
  coordinates: Point[];
};

const isPoint = (point?: Point) =>
  Boolean(
    point &&
      Number.isFinite(point.lat) &&
      Number.isFinite(point.lng) &&
      point.lat >= 33 &&
      point.lat <= 39 &&
      point.lng >= 124 &&
      point.lng <= 132,
  );
const destinationPoint = (
  origin: Point,
  distanceKm: number,
  bearing: number,
): Point => {
  const radius = 6371;
  const angular = distanceKm / radius;
  const angle = (bearing * Math.PI) / 180;
  const lat1 = (origin.lat * Math.PI) / 180;
  const lng1 = (origin.lng * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(angle),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(angle) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
};
const segmentDistanceKm = (a: number[], b: number[]) => {
  const radius = 6371;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const deltaLat = lat2 - lat1;
  const deltaLng = ((b[0] - a[0]) * Math.PI) / 180;
  const value =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};
const buildRouteSeeds = (
  start: Point,
  distanceKm: number,
  tripType: TripType,
): RouteSeed[] => {
  const directions = [
    [15, "북동쪽"],
    [75, "동쪽"],
    [135, "남동쪽"],
    [195, "남서쪽"],
    [255, "서쪽"],
    [315, "북서쪽"],
  ] as const;
  return directions.map(([bearing, direction]) => {
    if (tripType === "oneway") {
      return {
        bearing,
        direction,
        waypoints: [destinationPoint(start, distanceKm * 0.76, bearing)],
      };
    }
    const radius = Math.max(1.5, distanceKm / 3.35);
    return {
      bearing,
      direction,
      waypoints: [
        destinationPoint(start, radius, bearing - 32),
        destinationPoint(start, radius, bearing + 32),
      ],
    };
  });
};
const detectClimbs = (geometry: number[][]): ClimbSegment[] => {
  const distances = [0];
  for (let index = 1; index < geometry.length; index += 1) {
    distances[index] =
      distances[index - 1] + segmentDistanceKm(geometry[index - 1], geometry[index]);
  }
  const climbs: ClimbSegment[] = [];
  let startIndex: number | null = null;
  let gain = 0;
  let gapDistance = 0;
  const finish = (endIndex: number) => {
    if (startIndex === null || endIndex <= startIndex) return;
    const climbStart = startIndex;
    const lengthKm = distances[endIndex] - distances[climbStart];
    if (lengthKm >= 0.18 && gain >= 8) {
      const sampleEvery = Math.max(1, Math.ceil((endIndex - climbStart + 1) / 45));
      const coordinates = geometry
        .slice(climbStart, endIndex + 1)
        .filter((_, index) => index % sampleEvery === 0 || index === endIndex - climbStart)
        .map(([lng, lat]) => ({ lat, lng }));
      climbs.push({
        id: `climb-${climbs.length + 1}`,
        startKm: Math.round(distances[climbStart] * 10) / 10,
        endKm: Math.round(distances[endIndex] * 10) / 10,
        gainM: Math.round(gain),
        avgGradient: Math.round((gain / (lengthKm * 1000)) * 1000) / 10,
        coordinates,
      });
    }
    startIndex = null;
    gain = 0;
    gapDistance = 0;
  };
  for (let index = 1; index < geometry.length; index += 1) {
    const segmentKm = distances[index] - distances[index - 1];
    const elevationGain = Number(geometry[index][2]) - Number(geometry[index - 1][2]);
    const gradient = segmentKm > 0 ? (elevationGain / (segmentKm * 1000)) * 100 : 0;
    if (Number.isFinite(gradient) && gradient >= 2.2 && elevationGain > 0) {
      if (startIndex === null) startIndex = index - 1;
      gain += elevationGain;
      gapDistance = 0;
    } else if (startIndex !== null && segmentKm <= 0.08 && gapDistance + segmentKm <= 0.16) {
      gapDistance += segmentKm;
      if (elevationGain > 0) gain += elevationGain;
    } else {
      finish(index - 1);
    }
  }
  finish(geometry.length - 1);
  return climbs.sort((a, b) => b.gainM - a.gainM).slice(0, 12);
};
const callOrs = async (coordinates: Point[]) => {
  const response = await fetch(
    "https://api.openrouteservice.org/v2/directions/cycling-regular/geojson",
    {
      method: "POST",
      headers: {
        Authorization: openRouteServiceKey.value(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        coordinates: coordinates.map((point) => [point.lng, point.lat]),
        elevation: true,
        instructions: false,
      }),
    },
  );
  if (!response.ok) throw new Error(`ORS ${response.status}`);
  const data = (await response.json()) as {
    features?: Array<{
      geometry?: { coordinates?: number[][] };
      properties?: { summary?: { distance?: number; ascent?: number } };
    }>;
  };
  const route = data.features?.[0];
  if (!route?.geometry?.coordinates || !route.properties?.summary)
    throw new Error("ORS route missing");
  const elevations = route.geometry.coordinates
    .map((point) => point[2])
    .filter(Number.isFinite);
  const geometryAscent = elevations.reduce(
    (total, elevation, index) =>
      index === 0 ? 0 : total + Math.max(0, elevation - elevations[index - 1]),
    0,
  );
  const ascent =
    route.properties.summary.ascent ??
    (elevations.length > 1 ? geometryAscent : undefined);
  if (!Number.isFinite(ascent)) throw new Error("ORS elevation missing");
  let cumulativeDistance = 0;
  const fullProfile = route.geometry.coordinates.map((point, index) => {
    if (index)
      cumulativeDistance += segmentDistanceKm(
        route.geometry!.coordinates![index - 1],
        point,
      );
    return {
      distanceKm: Math.round(cumulativeDistance * 100) / 100,
      elevationM: Math.round(point[2]),
    };
  });
  const sampleEvery = Math.max(1, Math.ceil(fullProfile.length / 80));
  const elevationProfile = fullProfile.filter(
    (_, index) => index % sampleEvery === 0 || index === fullProfile.length - 1,
  );
  return {
    coordinates: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
    distanceKm: Math.round((route.properties.summary.distance ?? 0) / 100) / 10,
    elevationM: Math.round(ascent!),
    elevationProfile,
    climbSegments: detectClimbs(route.geometry.coordinates),
  };
};
const enforceRecommendationLimit = async (ip: string) => {
  const key = createHash("sha256")
    .update(ip || "unknown")
    .digest("hex")
    .slice(0, 32);
  const ref = db.collection("recommendationRateLimits").doc(key);
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const row = await tx.get(ref);
    const data = row.data() as
      | { count?: number; windowStartedAt?: number }
      | undefined;
    const freshWindow =
      !data?.windowStartedAt || now - data.windowStartedAt > 3600000;
    const count = freshWindow ? 0 : (data.count ?? 0);
    if (count >= 10)
      throw new HttpsError(
        "resource-exhausted",
        "코스 추천은 시간당 10회까지 가능합니다.",
      );
    tx.set(ref, {
      count: count + 1,
      windowStartedAt: freshWindow ? now : data!.windowStartedAt,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
};

export const recommendCourses = onCall(
  {
    region,
    secrets: [openRouteServiceKey],
    timeoutSeconds: 90,
    memory: "512MiB",
  },
  async (request) => {
    const { start, startName, distanceKm, uphill, tripType } = request.data as {
      start?: Point;
      startName?: string;
      distanceKm?: number;
      uphill?: UphillLevel;
      tripType?: TripType;
    };
    if (
      !isPoint(start) ||
      !startName ||
      !distanceKm ||
      distanceKm < 5 ||
      distanceKm > 200 ||
      !["low", "medium", "high"].includes(uphill ?? "") ||
      !["round", "oneway"].includes(tripType ?? "")
    )
      throw new HttpsError(
        "invalid-argument",
        "추천 조건을 다시 확인해 주세요.",
      );
    await enforceRecommendationLimit(request.rawRequest.ip ?? "unknown");
    const seeds = buildRouteSeeds(start!, distanceKm, tripType!);
    const targetClimbRate = { low: 4, medium: 10, high: 19 }[uphill!];
    const results = await Promise.allSettled(
      seeds.map(async (seed, index) => {
        const routePoints = [
          start!,
          ...seed.waypoints,
          ...(tripType === "round" ? [start!] : []),
        ];
        let verified = await callOrs(routePoints);
        const initialDifference = Math.abs(verified.distanceKm - distanceKm);
        if (initialDifference > Math.max(3, distanceKm * 0.25) && seed.waypoints.length) {
          const scale = Math.min(2, Math.max(0.5, distanceKm / Math.max(verified.distanceKm, 1)));
          const adjusted = seed.waypoints.map(point => ({ lat: start!.lat + (point.lat - start!.lat) * scale, lng: start!.lng + (point.lng - start!.lng) * scale })).filter(isPoint);
          if (adjusted.length === seed.waypoints.length) { try { const retry = await callOrs([start!, ...adjusted, ...(tripType === "round" ? [start!] : [])]); if (Math.abs(retry.distanceKm - distanceKm) < initialDifference) verified = retry; } catch { /* 원본 검증 경로를 유지 */ } }
        }
        const climbRate =
          verified.elevationM / Math.max(verified.distanceKm, 1);
        const distanceDifferenceKm = Math.abs(verified.distanceKm - distanceKm);
        const distanceErrorPercent = distanceDifferenceKm / Math.max(distanceKm, 1) * 100;
        const uphillErrorPercent = Math.abs(climbRate - targetClimbRate) / Math.max(targetClimbRate, 1) * 100;
        const weightedDistanceError = distanceErrorPercent * 0.7;
        const weightedUphillError = uphillErrorPercent * 0.3;
        const score = weightedDistanceError + weightedUphillError;
        const distanceMatchPercent = Math.max(0, 100 - distanceErrorPercent);
        const uphillMatchPercent = Math.max(0, 100 - uphillErrorPercent);
        const intensity = climbRate < 7 ? "완만한" : climbRate < 15 ? "균형" : "업힐";
        return {
          id: `candidate-${index + 1}`,
          title: `${seed.direction} ${intensity} 코스`,
          summary: `자전거 가능 도로망과 실제 고도를 분석한 ${seed.direction} 후보입니다.`,
          startName,
          ...verified,
          climbRate: Math.round(climbRate * 10) / 10,
          distanceDifferenceKm:
            Math.round(distanceDifferenceKm * 10) / 10,
          score: Math.round(score * 10) / 10,
          criteria: {
            distanceWeight: 70,
            uphillWeight: 30,
            targetDistanceKm: distanceKm,
            targetClimbRate,
            distanceMatchPercent: Math.round(distanceMatchPercent),
            uphillMatchPercent: Math.round(uphillMatchPercent),
            distanceErrorPercent: Math.round(distanceErrorPercent * 10) / 10,
            uphillErrorPercent: Math.round(uphillErrorPercent * 10) / 10,
            weightedDistanceError: Math.round(weightedDistanceError * 10) / 10,
            weightedUphillError: Math.round(weightedUphillError * 10) / 10,
          },
          verified: true,
        };
      }),
    );
    const fulfilled = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    if (!fulfilled.length)
      throw new HttpsError(
        "unavailable",
        "현재 조건으로 검증 가능한 코스를 찾지 못했습니다. 출발지나 거리를 바꿔 다시 시도해 주세요.",
      );
    return {
      candidates: fulfilled
        .sort((a, b) => a.score - b.score)
        .slice(0, 3)
        .map((candidate, index) => ({ ...candidate, recommended: index === 0 })),
    };
  },
);

export const recommendRoute = onCall(
  { region, secrets: [openRouteServiceKey] },
  async (request) => {
    requireAuth(request.auth?.uid);
    const { start, end } = request.data as { start?: Point; end?: Point };
    if (
      !start ||
      !end ||
      !isPoint(start) ||
      !isPoint(end)
    )
      throw new HttpsError(
        "invalid-argument",
        "출발지와 도착지 좌표가 필요합니다.",
      );
    try {
      return await callOrs([start, end]);
    } catch {
      throw new HttpsError(
        "unavailable",
        "경로 서비스를 일시적으로 사용할 수 없습니다.",
      );
    }
  },
);

export const joinRide = onCall({ region }, async (request) => {
  requireAuth(request.auth?.uid);
  const { rideId } = request.data as { rideId: string };
  if (!rideId) throw new HttpsError("invalid-argument", "rideId가 필요합니다.");
  const rideRef = db.collection("rides").doc(rideId);
  const memberRef = db
    .collection("rideMembers")
    .doc(`${rideId}_${request.auth!.uid}`);
  await db.runTransaction(async (tx) => {
    const [ride, member] = await Promise.all([
      tx.get(rideRef),
      tx.get(memberRef),
    ]);
    if (!ride.exists)
      throw new HttpsError("not-found", "라이딩을 찾을 수 없습니다.");
    if (member.exists)
      throw new HttpsError("already-exists", "이미 참여했습니다.");
    const data = ride.data()!;
    const [blockedByUser, blockedByHost] = await Promise.all([tx.get(db.collection("userBlocks").doc(`${request.auth!.uid}_${data.hostId}`)), tx.get(db.collection("userBlocks").doc(`${data.hostId}_${request.auth!.uid}`))]);
    if (blockedByUser.exists || blockedByHost.exists) throw new HttpsError("permission-denied", "차단 관계가 있는 사용자와는 함께 라이딩할 수 없습니다.");
    if (data.status !== "모집중" || data.memberCount >= data.capacity)
      throw new HttpsError("failed-precondition", "모집이 마감되었습니다.");
    const startsAt = data.startsAt?.toDate?.() as Date | undefined;
    if (!startsAt || startsAt.getTime() <= Date.now())
      throw new HttpsError("failed-precondition", "이미 출발 시간이 지난 라이딩입니다.");
    tx.set(memberRef, {
      rideId,
      userId: request.auth!.uid,
      rideAt: data.startsAt,
      joinedAt: FieldValue.serverTimestamp(),
    });
    tx.update(rideRef, { memberCount: FieldValue.increment(1) });
  });
  return { ok: true };
});

export const castNoShowVote = onCall({ region }, async (request) => {
  requireAuth(request.auth?.uid);
  const { rideId, targetUserId, noShow } = request.data as {
    rideId: string;
    targetUserId: string;
    noShow: boolean;
  };
  if (!rideId || !targetUserId || targetUserId === request.auth!.uid || typeof noShow !== "boolean")
    throw new HttpsError("invalid-argument", "유효하지 않은 투표입니다.");
  const ride = await db.collection("rides").doc(rideId).get();
  if (!ride.exists || ride.data()!.status !== "완료")
    throw new HttpsError(
      "failed-precondition",
      "종료된 라이딩에서만 투표할 수 있습니다.",
    );
  const endsAt = ride.data()!.endsAt?.toDate?.() as Date | undefined;
  if (!endsAt || Date.now() > endsAt.getTime() + 86400000)
    throw new HttpsError("deadline-exceeded", "투표 기간이 지났습니다.");
  const [voter, target] = await Promise.all([
    db.collection("rideMembers").doc(`${rideId}_${request.auth!.uid}`).get(),
    db.collection("rideMembers").doc(`${rideId}_${targetUserId}`).get(),
  ]);
  if (!voter.exists || !target.exists)
    throw new HttpsError(
      "permission-denied",
      "해당 라이딩 참여자만 투표할 수 있습니다.",
    );
  const voteRef = db
    .collection("votes")
    .doc(`${rideId}_${targetUserId}_${request.auth!.uid}`);
  await db.runTransaction(async (tx) => {
    if ((await tx.get(voteRef)).exists)
      throw new HttpsError("already-exists", "이미 투표했습니다.");
    tx.set(voteRef, {
      rideId,
      targetUserId,
      voterId: request.auth!.uid,
      noShow,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true };
});

export const resolveNoShowVote = onDocumentCreated(
  { region, document: "votes/{voteId}" },
  async (event) => {
    const vote = event.data!.data();
    const voteRows = await db
      .collection("votes")
      .where("rideId", "==", vote.rideId)
      .where("targetUserId", "==", vote.targetUserId)
      .get();
    const affirmative = voteRows.docs.filter(
      (d) => d.data().noShow === true,
    ).length;
    if (voteRows.size < 3 || affirmative * 2 <= voteRows.size) return;
    const recordRef = db
      .collection("noShowRecords")
      .doc(`${vote.rideId}_${vote.targetUserId}`);
    await db.runTransaction(async (tx) => {
      const record = await tx.get(recordRef);
      if (record.exists) return;
      tx.set(recordRef, {
        rideId: vote.rideId,
        riderId: vote.targetUserId,
        voteCount: voteRows.size,
        confirmedAt: FieldValue.serverTimestamp(),
      });
      tx.update(db.collection("users").doc(vote.targetUserId), {
        noShowCount: FieldValue.increment(1),
      });
    });
  },
);

export const notifyVoteOpened = onDocumentCreated(
  { region, document: "rides/{rideId}/voteEvents/{eventId}" },
  async (event) => {
    const rideId = event.params.rideId;
    const members = await db
      .collection("rideMembers")
      .where("rideId", "==", rideId)
      .get();
    const ids = members.docs.map((d) => String(d.data().userId)).filter(Boolean);
    if (!ids.length) return;
    const profiles = await db.getAll(...ids.map((id) => db.collection("users").doc(id)));
    const enabled = profiles.filter((row) => row.data()?.notifications?.safety !== false).map((row) => row.id);
    const tokenRows = await Promise.all(Array.from({ length: Math.ceil(enabled.length / 10) }, (_, index) =>
      db.collection("deviceTokens").where("userId", "in", enabled.slice(index * 10, index * 10 + 10)).get(),
    ));
    const values = [...new Set(tokenRows.flatMap((rows) => rows.docs.map((d) => String(d.data().token ?? "")).filter(Boolean)))];
    for (let offset = 0; offset < values.length; offset += 500)
      await getMessaging().sendEachForMulticast({
        tokens: values.slice(offset, offset + 500),
        notification: {
          title: "노쇼 확인 투표",
          body: "라이딩 참여 여부를 확인해 주세요.",
        },
        data: { rideId },
      });
  },
);

export const bootstrapAdmin = onCall(
  { region, secrets: [adminEmails] },
  async (request) => {
    requireAuth(request.auth?.uid);
    const email = String(request.auth?.token?.email ?? "").toLowerCase();
    const allowed = adminEmails
      .value()
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (
      !email ||
      request.auth?.token?.email_verified !== true ||
      !allowed.includes(email)
    )
      throw new HttpsError(
        "permission-denied",
        "허용된 이메일의 인증 완료 계정만 관리자가 될 수 있습니다.",
      );
    await getAuth().setCustomUserClaims(request.auth!.uid, { admin: true });
    await db.collection("users").doc(request.auth!.uid).set(
      {
        email,
        role: "admin",
        status: "active",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await audit(
      request.auth!.uid,
      "bootstrap_admin",
      "user",
      request.auth!.uid,
    );
    return { ok: true };
  },
);

export const createRidePlan = onCall({ region }, async (request) => {
  requireAuth(request.auth?.uid);
  const data = request.data as {
    title?: string;
    purpose?: "group" | "solo";
    startName?: string;
    startAddress?: string;
    endName?: string;
    endAddress?: string;
    startsAt?: string;
    distanceKm?: number;
    elevationM?: number;
    paceKmh?: number;
    capacity?: number;
    description?: string;
    meetingNote?: string;
    coordinates?: Point[];
    elevationProfile?: Array<{ distanceKm: number; elevationM: number }>;
    climbSegments?: ClimbSegment[];
    stops?: Array<{ id?: string; name?: string; kind?: string; coordinate?: Point; distanceFromRouteM?: number; selected?: boolean }>;
  };
  if (
    !data.title?.trim() ||
    !data.startName?.trim() ||
    !["group", "solo"].includes(data.purpose ?? "") ||
    !Number.isFinite(data.distanceKm) ||
    data.distanceKm! < 1 ||
    data.distanceKm! > 300
  )
    throw new HttpsError(
      "invalid-argument",
      "라이딩 계획 정보를 확인해 주세요.",
    );
  if (data.purpose === "group" && (!data.startsAt || !Number.isFinite(new Date(data.startsAt).getTime()))) throw new HttpsError("invalid-argument", "함께 라이딩은 출발 날짜와 시간이 필요합니다.");
  if (data.purpose === "group" && new Date(data.startsAt!).getTime() <= Date.now()) throw new HttpsError("invalid-argument", "출발 날짜와 시간은 현재 이후로 설정해 주세요.");
  if (!Number.isFinite(data.paceKmh) || Number(data.paceKmh) < 5 || Number(data.paceKmh) > 60) throw new HttpsError("invalid-argument", "목표 평속은 5~60km/h로 입력해 주세요.");
  if (data.startsAt && !Number.isFinite(new Date(data.startsAt).getTime()))
    throw new HttpsError("invalid-argument", "출발 날짜와 시간을 확인해 주세요.");
  if (data.purpose === "group" && (!Number.isInteger(data.capacity) || data.capacity! < 2 || data.capacity! > 50))
    throw new HttpsError("invalid-argument", "모집 인원은 방장을 제외하고 1~49명이어야 합니다.");
  if (!Array.isArray(data.coordinates) || data.coordinates.length < 2 || !data.coordinates.every(isPoint))
    throw new HttpsError("invalid-argument", "유효한 자전거 경로가 필요합니다. 경로를 다시 계산해 주세요.");
  if (hasBlockedRideContent(data.title, data.description, data.meetingNote))
    throw new HttpsError(
      "invalid-argument",
      "라이딩 제목이나 설명에 사용할 수 없는 표현이 포함되어 있습니다.",
    );
  const userId = request.auth!.uid;
  const rideRef = db.collection("rides").doc();
  const courseRef = db.collection("courses").doc();
  const startsAt = data.startsAt ? new Date(data.startsAt) : null;
  const course = {
    title: data.title.trim().slice(0, 80),
    startName: data.startName.trim().slice(0, 100),
    startAddress: String(data.startAddress ?? "").trim().slice(0, 200),
    endName: (data.endName ?? data.startName).trim().slice(0, 100),
    endAddress: String(data.endAddress ?? "").trim().slice(0, 200),
    distanceKm: data.distanceKm,
    elevationM: Math.max(0, Number(data.elevationM ?? 0)),
    coordinates: (data.coordinates ?? []).filter(isPoint).slice(0, 3000),
    elevationProfile: (data.elevationProfile ?? []).slice(0, 120),
    climbSegments: (data.climbSegments ?? []).slice(0, 12).map((segment, index) => ({
      id: String(segment.id ?? `climb-${index + 1}`).slice(0, 80),
      startKm: Math.max(0, Number(segment.startKm ?? 0)),
      endKm: Math.max(0, Number(segment.endKm ?? 0)),
      gainM: Math.max(0, Number(segment.gainM ?? 0)),
      avgGradient: Math.max(0, Number(segment.avgGradient ?? 0)),
      coordinates: (segment.coordinates ?? []).filter(isPoint).slice(0, 100),
    })),
    stops: (data.stops ?? []).filter(stop=>stop.name && isPoint(stop.coordinate)).slice(0,30).map(stop=>({id:String(stop.id??'').slice(0,120),name:String(stop.name).slice(0,100),kind:String(stop.kind??'휴식').slice(0,20),coordinate:stop.coordinate,distanceFromRouteM:Number.isFinite(Number((stop as {distanceFromRouteM?:number}).distanceFromRouteM))?Math.max(0,Math.min(5000,Math.round(Number((stop as {distanceFromRouteM?:number}).distanceFromRouteM)))):null,selected:stop.selected===true})),
    visibility: data.purpose === "solo" ? "private" : "public",
    createdBy: userId,
    createdAt: FieldValue.serverTimestamp(),
  };
  const ride = {
    title: course.title,
    courseId: courseRef.id,
    hostId: userId,
    purpose: data.purpose,
    visibility: data.purpose === "solo" ? "private" : "public",
    startsAt,
    paceKmh: Math.max(0, Number(data.paceKmh ?? 0)),
    capacity:
      data.purpose === "solo"
        ? 1
        : Math.min(50, Math.max(2, Number(data.capacity ?? 6))),
    memberCount: 1,
    status: data.purpose === "solo" ? "계획" : "모집중",
    description: String(data.description ?? "").slice(0, 1000),
    meetingNote: String(data.meetingNote ?? "").trim().slice(0, 200),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const batch = db.batch();
  batch.set(courseRef, course);
  batch.set(rideRef, ride);
  batch.set(db.collection("rideMembers").doc(`${rideRef.id}_${userId}`), {
    rideId: rideRef.id,
    userId,
    role: "host",
    rideAt: startsAt,
    joinedAt: FieldValue.serverTimestamp(),
  });
  batch.set(
    db.collection("users").doc(userId),
    {
      email: request.auth?.token?.email ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await batch.commit();
  return { id: rideRef.id };
});

export const repairRideCourse = onCall({ region }, async (request) => {
  requireAuth(request.auth?.uid);
  const data = request.data as {
    rideId?: string;
    coordinates?: Point[];
    distanceKm?: number;
    elevationM?: number;
    elevationProfile?: Array<{ distanceKm: number; elevationM: number }>;
    climbSegments?: ClimbSegment[];
  };
  const coordinates = (data.coordinates ?? []).filter(isPoint).slice(0, 3000);
  if (!data.rideId || coordinates.length < 2)
    throw new HttpsError("invalid-argument", "복구할 경로 좌표를 확인해 주세요.");
  const ride = await db.collection("rides").doc(data.rideId).get();
  if (!ride.exists) throw new HttpsError("not-found", "라이딩을 찾을 수 없습니다.");
  if (ride.data()?.hostId !== request.auth!.uid)
    throw new HttpsError("permission-denied", "방장만 저장된 경로를 복구할 수 있습니다.");
  const courseId = String(ride.data()?.courseId ?? "");
  if (!courseId) throw new HttpsError("failed-precondition", "코스 정보가 없습니다.");
  await db.collection("courses").doc(courseId).set(
    {
      coordinates,
      distanceKm: Math.max(0, Number(data.distanceKm ?? 0)),
      elevationM: Math.max(0, Number(data.elevationM ?? 0)),
      elevationProfile: (data.elevationProfile ?? []).slice(0, 120),
      climbSegments: (data.climbSegments ?? []).slice(0, 12).map((segment, index) => ({
        id: String(segment.id ?? `climb-${index + 1}`).slice(0, 80),
        startKm: Math.max(0, Number(segment.startKm ?? 0)),
        endKm: Math.max(0, Number(segment.endKm ?? 0)),
        gainM: Math.max(0, Number(segment.gainM ?? 0)),
        avgGradient: Math.max(0, Number(segment.avgGradient ?? 0)),
        coordinates: (segment.coordinates ?? []).filter(isPoint).slice(0, 100),
      })),
      repairedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return { ok: true };
});

export const listMyRidePlans = onCall({ region }, async (request) => {
  requireAuth(request.auth?.uid);
  const memberships = await db
    .collection("rideMembers")
    .where("userId", "==", request.auth!.uid)
    .limit(50)
    .get();
  const archiveRows = await Promise.all(
    memberships.docs.map((member) =>
      db.collection("rideArchives").doc(`${request.auth!.uid}_${String(member.data().rideId)}`).get(),
    ),
  );
  const visibleMemberships = memberships.docs.filter((_, index) => !archiveRows[index].exists);
  const rideRows = await Promise.all(
    visibleMemberships.map((member) =>
      db.collection("rides").doc(String(member.data().rideId)).get(),
    ),
  );
  const rows = rideRows
    .filter((row) => row.exists)
    .sort(
      (a, b) =>
        (b.data()?.createdAt?.toMillis?.() ?? 0) -
        (a.data()?.createdAt?.toMillis?.() ?? 0),
    )
    .slice(0, 30);
  const courseIds = rows.map((row) => row.data()!.courseId).filter(Boolean);
  const courseRows = await Promise.all(
    courseIds.map((id) => db.collection("courses").doc(id).get()),
  );
  const courses = new Map(courseRows.map((row) => [row.id, row.data()]));
  return {
    plans: rows.map((row) => {
      const ride = row.data()!;
      const course = courses.get(ride.courseId) ?? {};
      return {
        id: row.id,
        ...ride,
        startsAt: ride.startsAt?.toDate?.()?.toISOString?.() ?? null,
        createdAt: ride.createdAt?.toDate?.()?.toISOString?.() ?? null,
        course,
      };
    }),
  };
});

export const removeRideFromMyList = onCall({ region }, async (request) => {
  requireAuth(request.auth?.uid);
  const rideId = String((request.data as { rideId?: string }).rideId ?? "");
  if (!rideId) throw new HttpsError("invalid-argument", "라이딩 정보가 필요합니다.");
  const membership = await db.collection("rideMembers").doc(`${rideId}_${request.auth!.uid}`).get();
  if (!membership.exists)
    throw new HttpsError("permission-denied", "내 라이딩 목록에 있는 항목만 삭제할 수 있습니다.");
  await db.collection("rideArchives").doc(`${request.auth!.uid}_${rideId}`).set({
    userId: request.auth!.uid,
    rideId,
    archivedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

const serialize = (row: FirebaseFirestore.DocumentSnapshot) => {
  const value = row.data() ?? {};
  return {
    id: row.id,
    ...value,
    startsAt:
      (value as Record<string, any>).startsAt?.toDate?.()?.toISOString?.() ??
      null,
    createdAt:
      (value as Record<string, any>).createdAt?.toDate?.()?.toISOString?.() ??
      null,
    updatedAt:
      (value as Record<string, any>).updatedAt?.toDate?.()?.toISOString?.() ??
      null,
  };
};

export const listPublicRides = onCall({ region }, async (request) => {
  const rows = await db
    .collection("rides")
    .where("status", "in", ["모집중", "마감"])
    .where("startsAt", ">", new Date())
    .orderBy("startsAt", "asc")
    .limit(60)
    .get();
  const blockedIds = new Set<string>();
  if (request.auth?.uid) { const [mine, byOthers] = await Promise.all([db.collection("userBlocks").where("ownerId", "==", request.auth.uid).get(), db.collection("userBlocks").where("targetUserId", "==", request.auth.uid).get()]); mine.docs.forEach(row=>blockedIds.add(String(row.data().targetUserId))); byOthers.docs.forEach(row=>blockedIds.add(String(row.data().ownerId))); }
  const visible = rows.docs
    .filter((row) => row.data().visibility === "public" && !blockedIds.has(String(row.data().hostId)) && !hasBlockedRideContent(String(row.data().title ?? ""), String(row.data().description ?? "")))
    .sort(
      (a, b) =>
        (a.data().startsAt?.toMillis?.() ?? 0) -
        (b.data().startsAt?.toMillis?.() ?? 0),
    )
    .slice(0, 40);
  const courseRows = await Promise.all(
    visible.map((row) =>
      db.collection("courses").doc(String(row.data().courseId)).get(),
    ),
  );
  const userRows = await Promise.all(
    visible.map((row) =>
      db.collection("users").doc(String(row.data().hostId)).get(),
    ),
  );
  return {
    rides: visible.map((row, index) => ({
      ...serialize(row),
      course: serialize(courseRows[index]),
      host: {
        id: userRows[index].id,
        name: String(userRows[index].data()?.displayName ?? "라이더"),
        noShowCount: Number(userRows[index].data()?.noShowCount ?? 0),
      },
    })),
  };
});

export const getRideDetails = onCall({ region }, async (request) => {
  const rideId = String((request.data as { rideId?: string }).rideId ?? "");
  if (!rideId)
    throw new HttpsError("invalid-argument", "라이딩 정보가 필요합니다.");
  const ride = await db.collection("rides").doc(rideId).get();
  if (!ride.exists || ride.data()?.visibility !== "public" || ride.data()?.status === "숨김" || hasBlockedRideContent(String(ride.data()?.title ?? ""), String(ride.data()?.description ?? "")))
    throw new HttpsError("not-found", "라이딩을 찾을 수 없습니다.");
  const [course, members] = await Promise.all([
    db.collection("courses").doc(String(ride.data()!.courseId)).get(),
    db.collection("rideMembers").where("rideId", "==", rideId).limit(50).get(),
  ]);
  const profiles = await Promise.all(
    members.docs.map((member) =>
      db.collection("users").doc(String(member.data().userId)).get(),
    ),
  );
  return {
    ride: {
      ...serialize(ride),
      course: serialize(course),
      host: {
        id: String(ride.data()!.hostId),
        name: String(profiles.find((profile) => profile.id === ride.data()!.hostId)?.data()?.displayName ?? "라이더"),
        noShowCount: Number(profiles.find((profile) => profile.id === ride.data()!.hostId)?.data()?.noShowCount ?? 0),
      },
      members: profiles.map((profile) => ({
        id: profile.id,
        name: String(profile.data()?.displayName ?? "라이더"),
        noShowCount: Number(profile.data()?.noShowCount ?? 0),
      })),
      joined: Boolean(
        request.auth?.uid &&
          members.docs.some(
            (member) => member.data().userId === request.auth!.uid,
          ),
      ),
    },
  };
});

export const leaveRide = onCall({ region }, async (request) => {
  requireAuth(request.auth?.uid);
  const rideId = String((request.data as { rideId?: string }).rideId ?? "");
  const rideRef = db.collection("rides").doc(rideId);
  const memberRef = db
    .collection("rideMembers")
    .doc(`${rideId}_${request.auth!.uid}`);
  await db.runTransaction(async (tx) => {
    const [ride, member] = await Promise.all([
      tx.get(rideRef),
      tx.get(memberRef),
    ]);
    if (!ride.exists || !member.exists)
      throw new HttpsError("not-found", "참여 정보를 찾을 수 없습니다.");
    if (ride.data()!.hostId === request.auth!.uid)
      throw new HttpsError(
        "failed-precondition",
        "방장은 라이딩을 삭제하거나 다른 방장에게 위임해야 합니다.",
      );
    if (!["모집중", "마감"].includes(String(ride.data()!.status)))
      throw new HttpsError("failed-precondition", "출발 이후에는 참여 기록을 취소할 수 없습니다.");
    tx.delete(memberRef);
    tx.update(rideRef, {
      memberCount: FieldValue.increment(-1),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true };
});

export const startRide = onCall({ region }, async (request) => {
  requireAuth(request.auth?.uid);
  const rideId = String((request.data as { rideId?: string }).rideId ?? "");
  const rideRef = db.collection("rides").doc(rideId);
  await db.runTransaction(async (tx) => {
    const ride = await tx.get(rideRef);
    if (!ride.exists) throw new HttpsError("not-found", "라이딩을 찾을 수 없습니다.");
    const data = ride.data()!;
    if (data.hostId !== request.auth!.uid)
      throw new HttpsError("permission-denied", "방장만 라이딩을 시작할 수 있습니다.");
    if (!["모집중", "마감", "계획"].includes(String(data.status)))
      throw new HttpsError("failed-precondition", "시작할 수 있는 상태가 아닙니다.");
    tx.update(rideRef, {
      status: "진행중",
      startedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true };
});

export const finishRide = onCall({ region }, async (request) => {
  requireAuth(request.auth?.uid);
  const rideId = String((request.data as { rideId?: string }).rideId ?? "");
  const rideRef = db.collection("rides").doc(rideId);
  await db.runTransaction(async (tx) => {
    const ride = await tx.get(rideRef);
    if (!ride.exists) throw new HttpsError("not-found", "라이딩을 찾을 수 없습니다.");
    const data = ride.data()!;
    if (data.hostId !== request.auth!.uid)
      throw new HttpsError("permission-denied", "방장만 라이딩을 종료할 수 있습니다.");
    if (data.status !== "진행중")
      throw new HttpsError("failed-precondition", "진행 중인 라이딩이 아닙니다.");
    tx.update(rideRef, {
      status: "완료",
      endsAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  if ((await db.collection("rides").doc(rideId).get()).data()?.purpose === "group") {
    await db.collection("rides").doc(rideId).collection("voteEvents").add({
      openedAt: FieldValue.serverTimestamp(),
      closesAt: new Date(Date.now() + 86400000),
    });
  }
  return { ok: true };
});

export const listRideMessages = onCall({ region }, async (request) => {
  requireAuth(request.auth?.uid);
  const rideId = String((request.data as { rideId?: string }).rideId ?? "");
  if (
    !(
      await db
        .collection("rideMembers")
        .doc(`${rideId}_${request.auth!.uid}`)
        .get()
    ).exists
  )
    throw new HttpsError(
      "permission-denied",
      "참여자만 대화를 볼 수 있습니다.",
    );
  const rows = await db
    .collection("rideMessages")
    .where("rideId", "==", rideId)
    .orderBy("createdAt", "desc")
    .limit(80)
    .get();
  return { messages: rows.docs.map(serialize).reverse() };
});

export const sendRideMessage = onCall({ region }, async (request) => {
  requireAuth(request.auth?.uid);
  const { rideId, text } = request.data as { rideId?: string; text?: string };
  const message = String(text ?? "").trim();
  if (!rideId || !message || message.length > 500)
    throw new HttpsError(
      "invalid-argument",
      "메시지는 1~500자로 입력해 주세요.",
    );
  if (hasBlockedRideContent(message))
    throw new HttpsError(
      "invalid-argument",
      "대화에 사용할 수 없는 표현이 포함되어 있습니다.",
    );
  if (
    !(
      await db
        .collection("rideMembers")
        .doc(`${rideId}_${request.auth!.uid}`)
        .get()
    ).exists
  )
    throw new HttpsError(
      "permission-denied",
      "참여자만 메시지를 보낼 수 있습니다.",
    );
  const profile = await db.collection("users").doc(request.auth!.uid).get();
  const row = await db.collection("rideMessages").add({
    rideId,
    userId: request.auth!.uid,
    authorName: String(profile.data()?.displayName ?? "라이더"),
    text: message,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { id: row.id };
});

export const notifyRideMessage = onDocumentCreated(
  { region, document: "rideMessages/{messageId}" },
  async (event) => {
    const data = event.data?.data();
    const rideId = String(data?.rideId ?? "");
    const senderId = String(data?.userId ?? "");
    if (!rideId || !senderId) return;

    const members = await db
      .collection("rideMembers")
      .where("rideId", "==", rideId)
      .limit(50)
      .get();
    const recipientIds = Array.from(
      new Set(
        members.docs
          .map((row) => String(row.data().userId ?? ""))
          .filter((userId) => userId && userId !== senderId),
      ),
    );
    if (!recipientIds.length) return;

    const profiles = await db.getAll(
      ...recipientIds.map((userId) => db.collection("users").doc(userId)),
    );
    const enabledIds = profiles
      .filter((row) => row.data()?.notifications?.chat !== false)
      .map((row) => row.id);
    if (!enabledIds.length) return;

    const tokenRows = await Promise.all(
      Array.from({ length: Math.ceil(enabledIds.length / 10) }, (_, index) =>
        db
          .collection("deviceTokens")
          .where("userId", "in", enabledIds.slice(index * 10, index * 10 + 10))
          .get(),
      ),
    );
    const tokens = Array.from(
      new Set(
        tokenRows.flatMap((rows) =>
          rows.docs.map((row) => String(row.data().token ?? "")).filter(Boolean),
        ),
      ),
    ).slice(0, 500);
    if (!tokens.length) return;

    await getMessaging().sendEachForMulticast({
      tokens,
      notification: {
        title: `${String(data?.authorName ?? "참여자")}님의 새 메시지`,
        body: String(data?.text ?? "").slice(0, 100),
      },
      data: { rideId, url: "./?view=my" },
    });
  },
);

export const saveRiderSettings = onCall({ region }, async (request) => {
  requireAuth(request.auth?.uid);
  const data = request.data as {
    displayName?: string;
    emergencyName?: string;
    emergencyPhone?: string;
    notifyRide?: boolean;
    notifyChat?: boolean;
    notifySafety?: boolean;
    onboardingComplete?: boolean;
  };
  const displayName = String(data.displayName ?? "").trim();
  const emergencyName = String(data.emergencyName ?? "").trim();
  const emergencyPhone = String(data.emergencyPhone ?? "").replace(
    /[^0-9+-]/g,
    "",
  );
  if (displayName && (displayName.length < 2 || displayName.length > 20))
    throw new HttpsError(
      "invalid-argument",
      "닉네임은 2~20자로 입력해 주세요.",
    );
  if (emergencyPhone && emergencyPhone.length < 9)
    throw new HttpsError("invalid-argument", "비상 연락처를 확인해 주세요.");
  await db
    .collection("users")
    .doc(request.auth!.uid)
    .set(
      {
        ...(displayName ? { displayName } : {}),
        ...(data.emergencyName !== undefined || data.emergencyPhone !== undefined ? { safety: {
          ...(data.emergencyName !== undefined ? { emergencyName: emergencyName.slice(0, 30) } : {}),
          ...(data.emergencyPhone !== undefined ? { emergencyPhone: emergencyPhone.slice(0, 20) } : {}),
        } } : {}),
        ...(data.notifyRide !== undefined || data.notifyChat !== undefined || data.notifySafety !== undefined ? { notifications: {
          ...(data.notifyRide !== undefined ? { ride: data.notifyRide === true } : {}),
          ...(data.notifyChat !== undefined ? { chat: data.notifyChat === true } : {}),
          ...(data.notifySafety !== undefined ? { safety: data.notifySafety === true } : {}),
        } } : {}),
        ...(data.onboardingComplete !== undefined ? { onboardingComplete: data.onboardingComplete === true } : {}),
        email: request.auth?.token?.email ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  return { ok: true };
});

export const getRiderSettings = onCall({ region }, async (request) => {
  requireAuth(request.auth?.uid);
  const row = await db.collection("users").doc(request.auth!.uid).get();
  const value = row.data() ?? {};
  return {
    settings: {
      displayName: value.displayName ?? "",
      safety: value.safety ?? {},
      notifications: {
        ride: true,
        chat: true,
        safety: true,
        ...value.notifications,
      },
      onboardingComplete: value.onboardingComplete === true,
      identityStatus: value.safety?.identityStatus ?? "unverified",
    },
  };
});

export const registerDeviceToken = onCall({ region }, async (request) => {
  requireAuth(request.auth?.uid);
  const token = String((request.data as { token?: string }).token ?? "");
  if (token.length < 80 || token.length > 4096)
    throw new HttpsError("invalid-argument", "푸시 토큰을 확인해 주세요.");
  const id = createHash("sha256").update(token).digest("hex");
  await db
    .collection("deviceTokens")
    .doc(id)
    .set({
      userId: request.auth!.uid,
      token,
      platform: "web",
      updatedAt: FieldValue.serverTimestamp(),
    });
  return { ok: true };
});

export const reportUser = onCall({ region }, async (request) => {
  requireAuth(request.auth?.uid);
  const { targetUserId, rideId, category, details } = request.data as {
    targetUserId?: string;
    rideId?: string;
    category?: string;
    details?: string;
  };
  if (
    !targetUserId ||
    targetUserId === request.auth!.uid ||
    !["unsafe", "harassment", "no_show", "other"].includes(String(category))
  )
    throw new HttpsError("invalid-argument", "신고 정보를 확인해 주세요.");
  await db.collection("moderationReports").add({
    reporterId: request.auth!.uid,
    targetUserId,
    rideId: rideId ?? null,
    category,
    details: String(details ?? "").slice(0, 1000),
    status: "open",
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

export const setUserBlocked = onCall({ region }, async (request) => {
  requireAuth(request.auth?.uid);
  const { targetUserId, blocked } = request.data as {
    targetUserId?: string;
    blocked?: boolean;
  };
  if (!targetUserId || targetUserId === request.auth!.uid)
    throw new HttpsError("invalid-argument", "차단 대상을 확인해 주세요.");
  const ref = db
    .collection("userBlocks")
    .doc(`${request.auth!.uid}_${targetUserId}`);
  if (blocked === false) await ref.delete();
  else
    await ref.set({
      ownerId: request.auth!.uid,
      targetUserId,
      createdAt: FieldValue.serverTimestamp(),
    });
  return { ok: true };
});

export const setFavoriteRide = onCall({ region }, async (request) => {
  requireAuth(request.auth?.uid);
  const { rideId, favorite } = request.data as {
    rideId?: string;
    favorite?: boolean;
  };
  if (!rideId)
    throw new HttpsError("invalid-argument", "라이딩 정보가 필요합니다.");
  const ref = db
    .collection("rideFavorites")
    .doc(`${request.auth!.uid}_${rideId}`);
  if (favorite === false) await ref.delete();
  else
    await ref.set({
      userId: request.auth!.uid,
      rideId,
      createdAt: FieldValue.serverTimestamp(),
    });
  return { ok: true };
});

export const listFavoriteRides = onCall({ region }, async (request) => {
  requireAuth(request.auth?.uid);
  const rows = await db
    .collection("rideFavorites")
    .where("userId", "==", request.auth!.uid)
    .limit(100)
    .get();
  return { rideIds: rows.docs.map((row) => String(row.data().rideId)) };
});

export const createRideReview = onCall({ region }, async (request) => {
  requireAuth(request.auth?.uid);
  const { rideId, targetUserId, rating, comment } = request.data as {
    rideId?: string;
    targetUserId?: string;
    rating?: number;
    comment?: string;
  };
  if (
    !rideId ||
    !targetUserId ||
    targetUserId === request.auth!.uid ||
    !Number.isInteger(rating) ||
    rating! < 1 ||
    rating! > 5
  )
    throw new HttpsError("invalid-argument", "리뷰 정보를 확인해 주세요.");
  const [ride, author, target] = await Promise.all([
    db.collection("rides").doc(rideId).get(),
    db.collection("rideMembers").doc(`${rideId}_${request.auth!.uid}`).get(),
    db.collection("rideMembers").doc(`${rideId}_${targetUserId}`).get(),
  ]);
  if (
    !ride.exists ||
    ride.data()?.status !== "완료" ||
    !author.exists ||
    !target.exists
  )
    throw new HttpsError(
      "failed-precondition",
      "완료된 라이딩 참여자만 리뷰할 수 있습니다.",
    );
  await db
    .collection("rideReviews")
    .doc(`${rideId}_${request.auth!.uid}_${targetUserId}`)
    .create({
      rideId,
      authorId: request.auth!.uid,
      targetUserId,
      rating,
      comment: String(comment ?? "").slice(0, 500),
      createdAt: FieldValue.serverTimestamp(),
    });
  return { ok: true };
});

export const updateLiveLocation = onCall({ region }, async (request) => {
  requireAuth(request.auth?.uid);
  const { rideId, lat, lng, active } = request.data as {
    rideId?: string;
    lat?: number;
    lng?: number;
    active?: boolean;
  };
  const [membership, ride] = rideId
    ? await Promise.all([
        db.collection("rideMembers").doc(`${rideId}_${request.auth!.uid}`).get(),
        db.collection("rides").doc(rideId).get(),
      ])
    : [null, null];
  if (!rideId || !membership?.exists || !ride?.exists || (active !== false && ride.data()?.status !== "진행중"))
    throw new HttpsError(
      "permission-denied",
      "진행 중인 라이딩 참여자만 위치를 공유할 수 있습니다.",
    );
  const ref = db
    .collection("liveLocations")
    .doc(`${rideId}_${request.auth!.uid}`);
  if (active === false) await ref.delete();
  else {
    if (!isPoint({ lat: Number(lat), lng: Number(lng) }))
      throw new HttpsError("invalid-argument", "위치 정보를 확인해 주세요.");
    await ref.set({
      rideId,
      userId: request.auth!.uid,
      lat,
      lng,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  return { ok: true };
});

export const listRideLiveLocations = onCall({ region }, async (request) => {
  requireAuth(request.auth?.uid);
  const rideId = String((request.data as { rideId?: string }).rideId ?? "");
  if (!rideId) throw new HttpsError("invalid-argument", "라이딩 정보가 필요합니다.");
  const [membership, ride] = await Promise.all([
    db.collection("rideMembers").doc(`${rideId}_${request.auth!.uid}`).get(),
    db.collection("rides").doc(rideId).get(),
  ]);
  if (!membership.exists || !ride.exists || ride.data()?.status !== "진행중")
    throw new HttpsError("permission-denied", "해당 라이딩 참여자만 위치를 확인할 수 있습니다.");
  const locations = await db.collection("liveLocations").where("rideId", "==", rideId).limit(50).get();
  const active = locations.docs.filter((row) => (row.data().expiresAt?.toMillis?.() ?? 0) > Date.now());
  const profiles = await Promise.all(active.map((row) => db.collection("users").doc(String(row.data().userId)).get()));
  return {
    locations: active.map((row, index) => ({
      userId: String(row.data().userId),
      name: String(profiles[index].data()?.displayName ?? "라이더"),
      coordinate: { lat: Number(row.data().lat), lng: Number(row.data().lng) },
      updatedAt: row.data().updatedAt?.toDate?.()?.toISOString?.() ?? null,
    })),
  };
});

export const updateCourseStops = onCall({ region }, async (request) => {
  requireAuth(request.auth?.uid);
  const { rideId, selectedStopIds } = request.data as { rideId?: string; selectedStopIds?: string[] };
  if (!rideId || !Array.isArray(selectedStopIds) || selectedStopIds.length > 10)
    throw new HttpsError("invalid-argument", "정차 지점은 최대 10곳까지 선택할 수 있습니다.");
  const ride = await db.collection("rides").doc(rideId).get();
  if (!ride.exists || ride.data()?.hostId !== request.auth!.uid)
    throw new HttpsError("permission-denied", "방장만 정차 지점을 확정할 수 있습니다.");
  const courseRef = db.collection("courses").doc(String(ride.data()?.courseId ?? ""));
  const course = await courseRef.get();
  if (!course.exists) throw new HttpsError("not-found", "코스를 찾을 수 없습니다.");
  const selected = new Set(selectedStopIds.map(String));
  const stops = Array.isArray(course.data()?.stops) ? course.data()!.stops : [];
  await courseRef.update({
    stops: stops.map((stop: { id?: string }) => ({ ...stop, selected: selected.has(String(stop.id)) })),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

export const getRideWeather = onCall({ region }, async (request) => {
  const { lat, lng } = request.data as { lat?: number; lng?: number };
  if (!isPoint({ lat: Number(lat), lng: Number(lng) }))
    throw new HttpsError("invalid-argument", "위치를 확인해 주세요.");
  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation,wind_speed_10m&timezone=Asia%2FSeoul`,
  );
  if (!response.ok)
    throw new HttpsError("unavailable", "날씨 정보를 불러오지 못했습니다.");
  const body = (await response.json()) as { current?: Record<string, number> };
  return { weather: body.current ?? {} };
});

export const trackProductEvent = onCall({ region }, async (request) => {
  const name = String((request.data as { name?: string }).name ?? "");
  if (
    ![
      "app_open",
      "search",
      "ride_view",
      "ride_join",
      "course_explore",
      "course_created",
      "install_prompt",
    ].includes(name)
  )
    return { ok: false };
  await db.collection("productEvents").add({
    name,
    userId: request.auth?.uid ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

export const getAdminDashboard = onCall({ region }, async (request) => {
  requireAdmin(request);
  const [
    users,
    rides,
    reports,
    noShows,
    recentUsers,
    recentRides,
    recentReports,
    logs,
  ] = await Promise.all([
    db.collection("users").count().get(),
    db.collection("rides").count().get(),
    db
      .collection("moderationReports")
      .where("status", "==", "open")
      .count()
      .get(),
    db.collection("noShowRecords").count().get(),
    db.collection("users").orderBy("updatedAt", "desc").limit(20).get(),
    db.collection("rides").orderBy("createdAt", "desc").limit(20).get(),
    db
      .collection("moderationReports")
      .orderBy("createdAt", "desc")
      .limit(20)
      .get(),
    db.collection("auditLogs").orderBy("createdAt", "desc").limit(20).get(),
  ]);
  const clean = (row: FirebaseFirestore.QueryDocumentSnapshot) => {
    const value = row.data();
    return {
      id: row.id,
      ...value,
      createdAt: value.createdAt?.toDate?.()?.toISOString?.() ?? null,
      updatedAt: value.updatedAt?.toDate?.()?.toISOString?.() ?? null,
      startsAt: value.startsAt?.toDate?.()?.toISOString?.() ?? null,
    };
  };
  return {
    stats: {
      users: users.data().count,
      rides: rides.data().count,
      openReports: reports.data().count,
      noShows: noShows.data().count,
    },
    users: recentUsers.docs.map(clean),
    rides: recentRides.docs.map(clean),
    reports: recentReports.docs.map(clean),
    logs: logs.docs.map(clean),
  };
});

export const adminModerate = onCall({ region }, async (request) => {
  requireAdmin(request);
  const { action, targetId, reason } = request.data as {
    action?: string;
    targetId?: string;
    reason?: string;
  };
  if (!targetId || !action)
    throw new HttpsError("invalid-argument", "관리 작업 정보가 필요합니다.");
  const adminId = request.auth!.uid;
  if (action === "suspend_user" || action === "activate_user") {
    const disabled = action === "suspend_user";
    await getAuth().updateUser(targetId, { disabled });
    await db
      .collection("users")
      .doc(targetId)
      .set(
        {
          status: disabled ? "suspended" : "active",
          moderationReason: String(reason ?? "").slice(0, 500),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    await audit(adminId, action, "user", targetId, {
      reason: String(reason ?? "").slice(0, 500),
    });
  } else if (["hide_ride", "restore_ride", "close_ride"].includes(action)) {
    const status =
      action === "hide_ride"
        ? "숨김"
        : action === "close_ride"
          ? "마감"
          : "모집중";
    await db
      .collection("rides")
      .doc(targetId)
      .update({
        status,
        moderationReason: String(reason ?? "").slice(0, 500),
        updatedAt: FieldValue.serverTimestamp(),
      });
    await audit(adminId, action, "ride", targetId, {
      reason: String(reason ?? "").slice(0, 500),
    });
  } else if (action === "resolve_report" || action === "dismiss_report") {
    await db
      .collection("moderationReports")
      .doc(targetId)
      .update({
        status: action === "resolve_report" ? "resolved" : "dismissed",
        resolvedBy: adminId,
        resolutionNote: String(reason ?? "").slice(0, 500),
        resolvedAt: FieldValue.serverTimestamp(),
      });
    await audit(adminId, action, "report", targetId, {
      reason: String(reason ?? "").slice(0, 500),
    });
  } else
    throw new HttpsError("invalid-argument", "지원하지 않는 관리 작업입니다.");
  return { ok: true };
});
