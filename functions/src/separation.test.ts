import { describe, expect, it } from "vitest";
import { assessSeparation, distanceMeters, SEPARATION_COOLDOWN_MS } from "./separation.js";

describe("라이딩 일행 이탈 판정", () => {
  it("한 번 멀어진 좌표나 40초 미만의 신호에는 알리지 않는다", () => {
    const first = assessSeparation({ now: 0, distanceM: 500, currentAccuracyM: 10, peerAccuracyM: 10, peerUpdatedAt: 0 });
    const second = assessSeparation({ now: 20_000, distanceM: 500, currentAccuracyM: 10, peerAccuracyM: 10, peerUpdatedAt: 20_000, previous: first.state });
    expect(first.alert).toBe(false);
    expect(second.alert).toBe(false);
  });

  it("정확한 최신 좌표가 3회·40초 이상 멀 때 알린다", () => {
    const first = assessSeparation({ now: 1000, distanceM: 500, currentAccuracyM: 8, peerAccuracyM: 12, peerUpdatedAt: 1000 });
    const second = assessSeparation({ now: 21_000, distanceM: 480, currentAccuracyM: 8, peerAccuracyM: 12, peerUpdatedAt: 21_000, previous: first.state });
    const third = assessSeparation({ now: 41_000, distanceM: 470, currentAccuracyM: 8, peerAccuracyM: 12, peerUpdatedAt: 41_000, previous: second.state });
    expect(third.alert).toBe(true);
  });

  it("오래된 좌표와 정확도 낮은 좌표를 제외한다", () => {
    expect(assessSeparation({ now: 100_000, distanceM: 900, currentAccuracyM: 10, peerAccuracyM: 10, peerUpdatedAt: 0 }).eligible).toBe(false);
    expect(assessSeparation({ now: 0, distanceM: 900, currentAccuracyM: 120, peerAccuracyM: 10, peerUpdatedAt: 0 }).eligible).toBe(false);
  });

  it("가까워지면 누적 판정을 초기화하고 재알림은 10분 제한한다", () => {
    const near = assessSeparation({ now: 50_000, distanceM: 100, currentAccuracyM: 10, peerAccuracyM: 10, peerUpdatedAt: 50_000, previous: { farSince: 0, farSamples: 4, lastAlertAt: 40_000 } });
    expect(near.state.farSamples).toBeUndefined();
    const far = assessSeparation({ now: 40_000 + SEPARATION_COOLDOWN_MS - 1, distanceM: 600, currentAccuracyM: 10, peerAccuracyM: 10, peerUpdatedAt: 40_000 + SEPARATION_COOLDOWN_MS - 1, previous: { farSince: 0, farSamples: 5, lastAlertAt: 40_000 } });
    expect(far.alert).toBe(false);
  });

  it("두 좌표 사이 실제 거리를 계산한다", () => {
    expect(distanceMeters({ lat: 37.5, lng: 127 }, { lat: 37.5, lng: 127.004 })).toBeGreaterThan(300);
  });
});
