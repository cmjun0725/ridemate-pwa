import { describe, expect, it } from "vitest";
import { DAY_MS, expiryTime, groupLimitReached } from "../functions/src/lifecycle";

describe("라이딩 자동 정리 정책", () => {
  it("미출발은 예정 시간 + 24시간", () => expect(expiryTime(1000, null, 40, 20)).toBe(1000 + DAY_MS));
  it("시작한 경우 실제 출발 + 거리/평속 + 24시간", () => expect(expiryTime(1000, 5000, 40, 20)).toBe(5000 + 7_200_000 + DAY_MS));
  it("예상 소요 시간은 분 단위 올림", () => expect(expiryTime(null, 0, 1, 23)).toBe(180_000 + DAY_MS));
  it("일정 없는 개인 계획은 만료하지 않음", () => expect(expiryTime(null, null, 40, 20)).toBeNull());
  it("잘못된 기존 경로 데이터로 삭제하지 않음", () => expect(expiryTime(1000, 5000, 40, 0)).toBeNull());
  it("함께 라이딩 네 개 제한, 개인 무제한", () => {
    expect(groupLimitReached("group", 3)).toBe(false);
    expect(groupLimitReached("group", 4)).toBe(true);
    expect(groupLimitReached("solo", 1000)).toBe(false);
  });
});
