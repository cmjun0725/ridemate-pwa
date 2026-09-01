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
