import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.resetModules();
});

async function mockSearch(status?: string) {
  vi.stubEnv("VITE_KAKAO_MAP_KEY", "test-key");
  vi.stubGlobal("window", {
    setTimeout,
    clearTimeout,
    kakao: {
      maps: {
        load: (callback: () => void) => callback(),
        services: {
          Status: { OK: "OK", ZERO_RESULT: "ZERO_RESULT" },
          Places: class {
            keywordSearch(_query: string, callback: (rows: unknown[], status: string) => void) {
              if (status) callback([], status);
            }
          },
        },
      },
    },
  });
  return (await import("./kakao")).searchPlaces;
}

describe("장소 검색 상태", () => {
  it("검색 결과 없음을 정상적인 빈 배열로 반환한다", async () => {
    const search = await mockSearch("ZERO_RESULT");
    await expect(search("양재천")).resolves.toEqual([]);
  });
  it("API 오류를 결과 없음과 구별한다", async () => {
    const search = await mockSearch("ERROR");
    await expect(search("양재천")).rejects.toThrow("연결하지 못했습니다");
  });
  it("응답이 없는 요청을 10초 뒤 종료한다", async () => {
    vi.useFakeTimers();
    const search = await mockSearch();
    const result = expect(search("양재천")).rejects.toThrow("응답이 늦어지고");
    await vi.advanceTimersByTimeAsync(10000);
    await result;
  });
});
