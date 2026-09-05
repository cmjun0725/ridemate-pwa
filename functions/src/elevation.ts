// Distance-based sampling avoids dependence on the routing engine's vertex density.
export function analyzeElevation(geometry: number[][], distanceBetween: (a: number[], b: number[]) => number) {
  if (geometry.length < 2 || geometry.some(p => p.length < 3 || !p.slice(0, 3).every(Number.isFinite)))
    throw new Error("경로의 고도 데이터가 누락되었습니다. 다시 경로를 계산해 주세요.");
  const distances = [0];
  for (let i = 1; i < geometry.length; i++) distances.push(distances[i - 1] + distanceBetween(geometry[i - 1], geometry[i]));
  const total = distances.at(-1)!;
  if (!Number.isFinite(total) || total <= 0) throw new Error("유효한 경로 거리가 없습니다.");
  const step = Math.max(0.025, total / 12000);
  const samples: number[][] = [];
  const sampleDistances: number[] = [];
  let cursor = 1;
  for (let d = 0; ; d = Math.min(total, d + step)) {
    while (cursor < distances.length - 1 && distances[cursor] < d) cursor++;
    const span = distances[cursor] - distances[cursor - 1];
    const fraction = span > 0 ? (d - distances[cursor - 1]) / span : 0;
    samples.push(geometry[cursor - 1].slice(0, 3).map((v, axis) => v + (geometry[cursor][axis] - v) * fraction));
    sampleDistances.push(d);
    if (d === total) break;
  }
  const smoothed = samples.map((p, i) => {
    if (i === 0 || i === samples.length - 1) return p;
    const values = samples.slice(i - 1, i + 2).map(s => s[2]).sort((a, b) => a - b);
    return [p[0], p[1], values[1]];
  });
  // Count reversals only after 3 m; sub-threshold terrain noise cannot accumulate.
  let ascent = 0, descent = 0, anchor = smoothed[0][2];
  for (const point of smoothed.slice(1)) {
    const delta = point[2] - anchor;
    if (Math.abs(delta) >= 3) {
      ascent += Math.max(0, delta);
      descent += Math.max(0, -delta);
      anchor = point[2];
    }
  }
  const remainder = smoothed.at(-1)![2] - anchor;
  ascent += Math.max(0, remainder);
  descent += Math.max(0, -remainder);
  // Keep local minima/maxima in distance buckets, not every Nth vertex.
  const indices = new Set([0, smoothed.length - 1]);
  for (let bucket = 0; bucket < 59; bucket++) {
    const from = Math.floor(bucket * smoothed.length / 59);
    const to = Math.floor((bucket + 1) * smoothed.length / 59);
    if (from >= to) continue;
    let low = from, high = from;
    for (let i = from + 1; i < to; i++) {
      if (smoothed[i][2] < smoothed[low][2]) low = i;
      if (smoothed[i][2] > smoothed[high][2]) high = i;
    }
    indices.add(low); indices.add(high);
  }
  return {
    geometry: smoothed,
    ascent: Math.round(ascent), descent: Math.round(descent),
    profile: [...indices].sort((a, b) => a - b).map(i => ({ distanceKm: Math.round(sampleDistances[i] * 1000) / 1000, elevationM: Math.round(smoothed[i][2] * 10) / 10 })),
  };
}
