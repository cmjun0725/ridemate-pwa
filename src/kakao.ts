import type { Coordinate } from "./types";
import type { Stop } from "./types";

let kakaoPromise: Promise<any> | undefined;

export type PlaceSearchResult = Coordinate & {
  id: string;
  name: string;
  address: string;
  category: string;
};

export function loadKakaoMaps() {
  if (kakaoPromise) return kakaoPromise;
  kakaoPromise = new Promise((resolve, reject) => {
    const key = import.meta.env.VITE_KAKAO_MAP_KEY;
    if (!key) {
      reject(new Error("카카오 JavaScript 키가 설정되지 않았습니다."));
      return;
    }
    const finish = () => {
      if (!window.kakao?.maps) {
        reject(new Error("카카오맵 SDK 객체를 찾지 못했습니다."));
        return;
      }
      window.kakao.maps.load(() => resolve(window.kakao));
    };
    if (window.kakao?.maps) {
      finish();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-kakao-map]",
    );
    if (existing) {
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("카카오맵 SDK를 불러오지 못했습니다.")),
        { once: true },
      );
      return;
    }
    const script = document.createElement("script");
    script.dataset.kakaoMap = "true";
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false&libraries=services`;
    script.async = true;
    script.onload = finish;
    script.onerror = () =>
      reject(
        new Error(
          "카카오맵 SDK 도메인 허용 설정을 확인해 주세요.",
        ),
      );
    document.head.appendChild(script);
    window.setTimeout(
      () =>
        reject(
          new Error(
            "카카오맵 응답 시간이 초과되었습니다. JavaScript SDK 도메인을 확인해 주세요.",
          ),
        ),
      12000,
    );
  });
  void kakaoPromise.catch(() => {
    document.querySelector<HTMLScriptElement>("script[data-kakao-map]")?.remove();
    kakaoPromise = undefined;
  });
  return kakaoPromise;
}

export async function geocodePlace(
  query: string,
): Promise<Coordinate & { name: string }> {
  const kakao = await loadKakaoMaps();
  return new Promise((resolve, reject) => {
    const places = new kakao.maps.services.Places();
    places.keywordSearch(
      query,
      (
        results: Array<{
          y: string;
          x: string;
          place_name: string;
        }>,
        status: string,
      ) => {
        if (status !== kakao.maps.services.Status.OK || !results[0]) {
          reject(
            new Error(
              "출발지를 찾지 못했습니다. 더 구체적으로 입력해 주세요.",
            ),
          );
          return;
        }
        resolve({
          lat: Number(results[0].y),
          lng: Number(results[0].x),
          name: results[0].place_name,
        });
      },
    );
  });
}

export async function searchPlaces(query: string): Promise<PlaceSearchResult[]> {
  const normalized = query.trim();
  if (normalized.length < 2) return [];
  const kakao = await loadKakaoMaps();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("장소 검색 응답이 늦어지고 있습니다. 다시 검색해 주세요.")), 10000);
    const places = new kakao.maps.services.Places();
    places.keywordSearch(
      normalized,
      (
        results: Array<{
          id: string;
          place_name: string;
          road_address_name?: string;
          address_name?: string;
          category_group_name?: string;
          category_name?: string;
          y: string;
          x: string;
        }>,
        status: string,
      ) => {
        window.clearTimeout(timer);
        if (status === kakao.maps.services.Status.ZERO_RESULT) return resolve([]);
        if (status !== kakao.maps.services.Status.OK) return reject(new Error("장소 검색에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."));
        resolve(results.slice(0, 7).map((row) => ({
              id: row.id,
              name: row.place_name,
              address: row.road_address_name || row.address_name || "주소 정보 없음",
              category: row.category_group_name || row.category_name?.split(" > ").at(-1) || "장소",
              lat: Number(row.y),
              lng: Number(row.x),
            })));
      },
    );
  });
}

export async function searchCoursePois(
  route: Coordinate[],
): Promise<Stop[]> {
  const kakao = await loadKakaoMaps();
  if (!route.length) return [];

  const sampleCount = Math.min(8, Math.max(3, Math.ceil(route.length / 180)));
  const samples = Array.from({ length: sampleCount }, (_, index) =>
    route[
      Math.min(
        route.length - 1,
        Math.round((index * (route.length - 1)) / (sampleCount - 1)),
      )
    ],
  );

  const searches: Array<Promise<Stop[]>> = [];
  for (const point of samples) {
    const places = new kakao.maps.services.Places();
    const run = (
      kind: Stop["kind"],
      radius: number,
      size: number,
      keyword?: string,
      category?: string,
    ) =>
      new Promise<Stop[]>((resolve) => {
        const options = {
          location: new kakao.maps.LatLng(point.lat, point.lng),
          radius,
          size,
          sort: kakao.maps.services.SortBy.DISTANCE,
        };
        const callback = (
          rows: Array<{
            id: string;
            place_name: string;
            y: string;
            x: string;
          }>,
          status: string,
        ) =>
          resolve(
            status === kakao.maps.services.Status.OK
              ? rows.map((row) => ({
                  id: `${kind}-${row.id}`,
                  name: row.place_name,
                  kind,
                  coordinate: {
                    lat: Number(row.y),
                    lng: Number(row.x),
                  },
                }))
              : [],
          );
        if (category) places.categorySearch(category, callback, options);
        else places.keywordSearch(keyword, callback, options);
      });

    searches.push(
      run("편의점", 850, 7, undefined, "CS2"),
      run("화장실", 1100, 5, "공중화장실"),
      run("정비소", 2200, 7, "자전거 수리점"),
    );
  }

  const unique = new Map<string, Stop>();
  const results = await Promise.allSettled(searches);
  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const stop of result.value) {
        unique.set(stop.id, stop);
      }
    }
  }
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const distanceMeters = (a: Coordinate, b: Coordinate) => {
    const lat = toRadians(b.lat - a.lat);
    const lng = toRadians(b.lng - a.lng);
    const startLat = toRadians(a.lat);
    const endLat = toRadians(b.lat);
    const haversine =
      Math.sin(lat / 2) ** 2 +
      Math.cos(startLat) * Math.cos(endLat) * Math.sin(lng / 2) ** 2;
    return (
      6371000 *
      2 *
      Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
    );
  };

  const routeStep = Math.max(1, Math.ceil(route.length / 450));
  const routeProbes = route
    .map((coordinate, index) => ({ coordinate, index }))
    .filter(({ index }) => index % routeStep === 0 || index === route.length - 1);
  const ranked = [...unique.values()].map((stop) => {
    let closest = { distance: Number.POSITIVE_INFINITY, routeIndex: 0 };
    for (const probe of routeProbes) {
      const distance = distanceMeters(stop.coordinate, probe.coordinate);
      if (distance < closest.distance)
        closest = { distance, routeIndex: probe.index };
    }
    return {
      ...stop,
      distanceFromRouteM: Math.round(closest.distance / 10) * 10,
      routeIndex: closest.routeIndex,
    };
  });
  const toStop = (stop: (typeof ranked)[number]): Stop => ({
    id: stop.id,
    name: stop.name,
    kind: stop.kind,
    coordinate: stop.coordinate,
    distanceFromRouteM: stop.distanceFromRouteM,
    selected: stop.selected,
  });

  const selectDistributed = (
    kind: Stop["kind"],
    limit: number,
    maxDistanceM: number,
  ) => {
    const candidates = ranked
      .filter(
        (stop) =>
          stop.kind === kind &&
          (stop.distanceFromRouteM ?? Number.POSITIVE_INFINITY) <= maxDistanceM,
      )
      .sort(
        (a, b) =>
          (a.distanceFromRouteM ?? 0) - (b.distanceFromRouteM ?? 0),
      );
    const buckets = new Map<number, (typeof candidates)[number]>();
    for (const stop of candidates) {
      const progress = stop.routeIndex / Math.max(1, route.length - 1);
      const bucket = Math.min(limit - 1, Math.floor(progress * limit));
      if (!buckets.has(bucket)) buckets.set(bucket, stop);
    }
    const selected = [...buckets.values()];
    for (const stop of candidates) {
      if (selected.length >= limit) break;
      if (!selected.some((row) => row.id === stop.id)) selected.push(stop);
    }
    return selected
      .sort((a, b) => a.routeIndex - b.routeIndex)
      .map(toStop);
  };

  const repairs = ranked
    .filter(
      (stop) =>
        stop.kind === "정비소" &&
        (stop.distanceFromRouteM ?? Number.POSITIVE_INFINITY) <= 2000,
    )
    .sort((a, b) => a.routeIndex - b.routeIndex)
    .slice(0, 10)
    .map(toStop);

  return [
    ...selectDistributed("편의점", 6, 550),
    ...selectDistributed("화장실", 5, 750),
    ...repairs,
  ];
}
