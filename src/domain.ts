import type { Ride } from "./types";

export function buildRideStart(
  date: string,
  period: string,
  hourValue: number,
  minute: string,
) {
  if (!date) return undefined;
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
) {
  const normalized = query.trim().toLowerCase();
  return rides.filter(
    (ride) =>
      `${ride.title} ${ride.course.startName} ${ride.course.endName}`
        .toLowerCase()
        .includes(normalized) &&
      ride.course.distanceKm <= maxDistance &&
      ride.paceKmh <= maxPace,
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
