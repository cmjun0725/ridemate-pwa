export const LOCATION_FRESH_MS = 75_000;
export const SEPARATION_SUSTAIN_MS = 40_000;
export const SEPARATION_COOLDOWN_MS = 10 * 60_000;

export type SeparationState = {
  farSince?: number;
  farSamples?: number;
  lastAlertAt?: number;
};

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function assessSeparation(input: {
  now: number;
  distanceM: number;
  currentAccuracyM: number;
  peerAccuracyM: number;
  peerUpdatedAt: number;
  previous?: SeparationState;
}) {
  const previous = input.previous ?? {};
  const accurate = [input.currentAccuracyM, input.peerAccuracyM].every(value => Number.isFinite(value) && value >= 0 && value <= 100);
  const fresh = Number.isFinite(input.peerUpdatedAt) && input.now - input.peerUpdatedAt <= LOCATION_FRESH_MS;
  if (!accurate || !fresh || !Number.isFinite(input.distanceM))
    return { state: previous, alert: false, eligible: false };

  // GPS 오차를 합산한 값보다 충분히 먼 경우만 이탈로 판단합니다.
  const farThresholdM = Math.max(350, (input.currentAccuracyM + input.peerAccuracyM) * 2.5);
  if (input.distanceM <= 250)
    return { state: previous.lastAlertAt ? { lastAlertAt: previous.lastAlertAt } : {}, alert: false, eligible: true };
  if (input.distanceM < farThresholdM)
    return { state: previous, alert: false, eligible: true };

  const farSince = previous.farSince ?? input.now;
  const farSamples = (previous.farSamples ?? 0) + 1;
  const cooledDown = !previous.lastAlertAt || input.now - previous.lastAlertAt >= SEPARATION_COOLDOWN_MS;
  const alert = farSamples >= 3 && input.now - farSince >= SEPARATION_SUSTAIN_MS && cooledDown;
  const state: SeparationState = { farSince, farSamples };
  if (alert) state.lastAlertAt = input.now;
  else if (previous.lastAlertAt) state.lastAlertAt = previous.lastAlertAt;
  return {
    state,
    alert,
    eligible: true,
  };
}
