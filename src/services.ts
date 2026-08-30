import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'
import type { Coordinate, RouteCandidate } from './types'

export async function requestCourseCandidates(input: { start: Coordinate; startName: string; distanceKm: number; uphill: 'low' | 'medium' | 'high'; tripType: 'round' | 'oneway' }) {
  if (!functions) throw new Error('Firebase 연결 설정이 필요합니다.')
  const call = httpsCallable<typeof input, { candidates: RouteCandidate[] }>(functions, 'recommendCourses')
  return (await call(input)).data.candidates
}

export type RidePlanInput = { title: string; purpose: 'group' | 'solo'; startName: string; endName?: string; startsAt?: string; distanceKm: number; elevationM?: number; paceKmh?: number; capacity?: number; description?: string; coordinates?: Coordinate[]; elevationProfile?: Array<{ distanceKm: number; elevationM: number }> }
export type StoredRidePlan = { id: string; title: string; purpose: 'group' | 'solo'; status: string; startsAt?: string; createdAt?: string; course: { startName?: string; endName?: string; distanceKm?: number; elevationM?: number } }
export type AdminDashboardData = { stats: { users: number; rides: number; openReports: number; noShows: number }; users: Array<Record<string, unknown> & { id: string }>; rides: Array<Record<string, unknown> & { id: string }>; reports: Array<Record<string, unknown> & { id: string }>; logs: Array<Record<string, unknown> & { id: string }> }

async function callable<Input, Output>(name: string, input: Input) { if (!functions) throw new Error('Firebase 연결 설정이 필요합니다.'); return (await httpsCallable<Input, Output>(functions, name)(input)).data }
export const createRidePlan = (input: RidePlanInput) => callable<RidePlanInput, { id: string }>('createRidePlan', input)
export const listMyRidePlans = () => callable<Record<string, never>, { plans: StoredRidePlan[] }>('listMyRidePlans', {}).then(result => result.plans)
export const bootstrapAdmin = () => callable<Record<string, never>, { ok: boolean }>('bootstrapAdmin', {})
export const getAdminDashboard = () => callable<Record<string, never>, AdminDashboardData>('getAdminDashboard', {})
export const adminModerate = (input: { action: string; targetId: string; reason?: string }) => callable<typeof input, { ok: boolean }>('adminModerate', input)
