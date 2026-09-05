export const DAY_MS = 86_400_000;
export function expiryTime(startsAt: number | null, startedAt: number | null, distanceKm: number, paceKmh: number): number | null {
  if (startedAt !== null) {
    if (!Number.isFinite(distanceKm) || distanceKm <= 0 || !Number.isFinite(paceKmh) || paceKmh <= 0) return null;
    return startedAt + Math.ceil(distanceKm / paceKmh * 60) * 60_000 + DAY_MS;
  }
  return startsAt === null ? null : startsAt + DAY_MS;
}
export function groupLimitReached(purpose: string, existing: number): boolean {
  return purpose === "group" && existing >= 4;
}
