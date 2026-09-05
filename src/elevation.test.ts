import { describe, expect, it } from "vitest";
import { analyzeElevation } from "../functions/src/elevation";
const distance = (a: number[], b: number[]) => Math.abs(b[0] - a[0]);
describe("고도 보정", () => {
  it("등속 상승과 하강을 계산", () => {
    const r = analyzeElevation([[0, 0, 0], [1, 0, 100], [2, 0, 0]], distance);
    expect(r.ascent).toBeGreaterThanOrEqual(95);
    expect(r.descent).toBe(r.ascent);
    expect(r.profile.length).toBeLessThanOrEqual(120);
    expect(r.profile.at(-1)?.distanceKm).toBe(2);
  });
  it("좌표 밀도에 따라 상승고도가 달라지지 않음", () => {
    const sparse = analyzeElevation([[0, 0, 0], [1, 0, 100]], distance);
    const dense = analyzeElevation(Array.from({ length: 101 }, (_, i) => [i / 100, 0, i]), distance);
    expect(sparse.ascent).toBe(dense.ascent);
  });
  it("작은 평지 노이즈를 누적하지 않음", () => {
    const r = analyzeElevation(Array.from({ length: 101 }, (_, i) => [i / 40, 0, 10 + i % 2]), distance);
    expect(r.ascent).toBeLessThanOrEqual(1);
  });
  it("고도 누락을 0으로 오인하지 않음", () => {
    expect(() => analyzeElevation([[0, 0, 1], [1, 0]], distance)).toThrow();
    expect(() => analyzeElevation([[0, 0, NaN], [1, 0, 1]], distance)).toThrow();
  });
  it("중복 좌표와 해수면 아래 고도를 처리", () => {
    const r = analyzeElevation([[0, 0, -10], [0, 0, -10], [1, 0, -5]], distance);
    expect(r.ascent).toBe(5);
    expect(r.profile[0].elevationM).toBe(-10);
  });
});
