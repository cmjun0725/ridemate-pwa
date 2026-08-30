import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'
import type { Coordinate, RouteCandidate } from './types'

export async function requestCourseCandidates(input: { start: Coordinate; startName: string; distanceKm: number; uphill: 'low' | 'medium' | 'high'; tripType: 'round' | 'oneway' }) {
  if (!functions) throw new Error('Firebase 연결 설정이 필요합니다.')
  const call = httpsCallable<typeof input, { candidates: RouteCandidate[] }>(functions, 'recommendCourses')
  return (await call(input)).data.candidates
}
