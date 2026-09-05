import type { Ride } from "./types";

export function buildRideStart(
  date: string,
  period: string,
  hourValue: number,
  minute: string,
) {
  if (!date) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !["AM", "PM"].includes(period) || !Number.isInteger(hourValue) || hourValue < 1 || hourValue > 12 || !/^\d{2}$/.test(minute) || Number(minute) > 59)
    throw new Error("날짜와 시간을 올바르게 입력해 주세요.");
  const calendarDate = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== date)
    throw new Error("존재하지 않는 날짜입니다.");
  let hour = hourValue;
  if (period === "PM" && hour < 12) hour += 12;
  if (period === "AM" && hour === 12) hour = 0;
  return new Date(
    `${date}T${String(hour).padStart(2, "0")}:${minute}:00+09:00`,
  ).toISOString();
}

export function filterPublicRides(
  rides: Ride[],
  query: string,
  maxDistance: number,
  maxPace: number,
  options: { onlyAvailable?: boolean; withinDays?: number; upcomingOnly?: boolean; now?: Date } = {},
) {
  const normalized = query.trim().toLowerCase();
  const now = options.now ?? new Date();
  const deadline = options.withinDays
    ? now.getTime() + options.withinDays * 86400000
    : Number.POSITIVE_INFINITY;
  return rides.filter(
    (ride) => {
      const startsAt = new Date(ride.startsAt).getTime();
      const memberCount = ride.memberCount ?? ride.members?.length ?? 1;
      return `${ride.title} ${ride.course.startName} ${ride.course.endName}`
        .toLowerCase()
        .includes(normalized) &&
      ride.course.distanceKm <= maxDistance &&
      ride.paceKmh <= maxPace &&
      (!options.onlyAvailable || (ride.status === "모집중" && memberCount < ride.capacity)) &&
      (!options.upcomingOnly || startsAt >= now.getTime()) &&
      (!options.withinDays || (startsAt >= now.getTime() && startsAt <= deadline));
    },
  );
}

export function isNoShowConfirmed(
  totalVotes: number,
  affirmativeVotes: number,
) {
  return totalVotes >= 3 && affirmativeVotes * 2 > totalVotes;
}

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

export function validateRideContent(...values: Array<string | undefined>) {
  const normalized = values
    .join(" ")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s._\-~!@#$%^&*()+=[\]{}|\\/<>?,:;'"`]+/g, "");
  return blockedRideTerms.some((term) => normalized.includes(term))
    ? "라이딩 제목이나 설명에 사용할 수 없는 표현이 포함되어 있습니다."
    : undefined;
}
