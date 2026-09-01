import { describe, expect, it } from "vitest";
import { buildRideStart, filterPublicRides, isNoShowConfirmed } from "./domain";
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
  it("노쇼는 최소 3표이면서 유효표 과반일 때만 확정한다", () => {
    expect(isNoShowConfirmed(2, 2)).toBe(false);
    expect(isNoShowConfirmed(4, 2)).toBe(false);
    expect(isNoShowConfirmed(3, 2)).toBe(true);
  });
});
