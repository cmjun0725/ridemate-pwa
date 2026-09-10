import { describe, expect, it } from "vitest";
import {
  buildRideStart,
  filterPublicRides,
  isNoShowConfirmed,
  validateRideContent,
} from "./domain";
import type { Ride } from "./types";

const ride = (distanceKm: number, paceKmh: number, title = "한강 라이딩") =>
  ({
    id: title,
    title,
    startsAt: "2026-09-01T00:00:00.000Z",
    paceKmh,
    capacity: 6,
    memberCount: 1,
    status: "모집중",
    host: { id: "host", name: "방장", noShowCount: 0 },
    course: {
      id: "course",
      title,
      startName: "여의나루역",
      endName: "반포",
      distanceKm,
      elevationM: 20,
      coordinates: [],
      stops: [],
      createdAt: "",
    },
  }) as Ride;

describe("라이딩 도메인 정책", () => {
  it("존재하지 않는 날짜와 잘못된 시각을 거부한다", () => {
    expect(() => buildRideStart("2026-02-30", "AM", 8, "00")).toThrow();
    expect(() => buildRideStart("2026-09-05", "AM", 0, "00")).toThrow();
    expect(() => buildRideStart("2026-09-05", "AM", 8, "60")).toThrow();
    expect(() => buildRideStart("2026-09-05", "invalid", 8, "00")).toThrow();
    expect(buildRideStart("", "AM", 8, "00")).toBeUndefined();
    expect(buildRideStart("2028-02-29", "PM", 12, "00")).toBe("2028-02-29T03:00:00.000Z");
  });
  it("오전·오후를 명확한 24시간 시각으로 변환한다", () => {
    expect(buildRideStart("2026-09-05", "AM", 12, "30")).toContain(
      "2026-09-04T15:30:00.000Z",
    );
    expect(buildRideStart("2026-09-05", "PM", 8, "30")).toContain(
      "2026-09-05T11:30:00.000Z",
    );
  });
  it("검색어·거리·평속을 모두 만족하는 라이딩만 반환한다", () => {
    expect(
      filterPublicRides([ride(40, 24), ride(80, 30, "북한강")], "한강", 60, 25),
    ).toHaveLength(1);
  });
  it("자리 있음·기간 필터를 함께 적용한다", () => {
    const open = ride(40, 24);
    open.startsAt = "2026-09-05T00:00:00.000Z";
    const full = ride(40, 24, "마감 코스");
    full.startsAt = "2026-09-06T00:00:00.000Z";
    full.memberCount = full.capacity;
    expect(filterPublicRides([open, full], "", 200, 60, {
      onlyAvailable: true,
      withinDays: 7,
      now: new Date("2026-09-02T00:00:00.000Z"),
    })).toEqual([open]);
  });
  it("출발 시각이 지났어도 24시간 유예 중인 모집방은 홈에 유지한다", () => {
    const recent = ride(40, 24, "방금 출발한 방");
    recent.startsAt = "2026-09-06T04:00:00.000Z";
    const expired = ride(40, 24, "하루 지난 방");
    expired.startsAt = "2026-09-05T03:59:59.000Z";
    expect(filterPublicRides([recent, expired], "", 200, 60, {
      recentHours: 24,
      now: new Date("2026-09-06T05:00:00.000Z"),
    })).toEqual([recent]);
  });
  it("노쇼는 최소 3표이면서 유효표 과반일 때만 확정한다", () => {
    expect(isNoShowConfirmed(2, 2)).toBe(false);
    expect(isNoShowConfirmed(4, 2)).toBe(false);
    expect(isNoShowConfirmed(3, 2)).toBe(true);
  });
  it("자리 있음 필터는 출발 시각이 지난 방을 제외한다", () => {
    expect(filterPublicRides([ride(40, 24)], "", Infinity, 60, {
      onlyAvailable: true, now: new Date("2026-09-01T00:00:00.000Z"),
    })).toEqual([]);
  });
  it("거리 전체는 200km를 넘는 라이딩도 표시한다", () => {
    expect(filterPublicRides([ride(250, 24)], "", Infinity, 60)).toHaveLength(1);
  });
  it("방 제목과 설명의 금지 표현을 띄어쓰기 우회까지 검출한다", () => {
    expect(validateRideContent("주말 한강 라이딩", "초보 환영")).toBeUndefined();
    expect(validateRideContent("건강 섹 스 라이딩")).toContain("사용할 수 없는");
  });
});
