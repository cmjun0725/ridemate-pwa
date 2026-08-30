import { initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getMessaging } from 'firebase-admin/messaging'
import { HttpsError, onCall } from 'firebase-functions/https'
import { onDocumentCreated } from 'firebase-functions/firestore'
import { defineSecret } from 'firebase-functions/params'
import { createHash } from 'node:crypto'

initializeApp(); const db = getFirestore(); const region = 'asia-northeast3'
const openRouteServiceKey = defineSecret('OPENROUTESERVICE_API_KEY')
const openRouterKey = defineSecret('OPENROUTER_API_KEY')
const requireAuth = (uid?: string) => { if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.') }

type Point = { lat: number; lng: number }
type TripType = 'round' | 'oneway'
type UphillLevel = 'low' | 'medium' | 'high'
type AiCandidate = { title: string; summary: string; waypoints: Point[] }

const isPoint = (point?: Point) => Boolean(point && Number.isFinite(point.lat) && Number.isFinite(point.lng) && point.lat >= 33 && point.lat <= 39 && point.lng >= 124 && point.lng <= 132)
const destinationPoint = (origin: Point, distanceKm: number, bearing: number): Point => {
  const radius = 6371; const angular = distanceKm / radius; const angle = bearing * Math.PI / 180; const lat1 = origin.lat * Math.PI / 180; const lng1 = origin.lng * Math.PI / 180
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(angle)); const lng2 = lng1 + Math.atan2(Math.sin(angle) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2))
  return { lat: lat2 * 180 / Math.PI, lng: lng2 * 180 / Math.PI }
}
const segmentDistanceKm = (a: number[], b: number[]) => {
  const radius = 6371; const lat1 = a[1] * Math.PI / 180; const lat2 = b[1] * Math.PI / 180; const deltaLat = lat2 - lat1; const deltaLng = (b[0] - a[0]) * Math.PI / 180
  const value = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}
const fallbackCandidates = (start: Point, distanceKm: number, tripType: TripType): AiCandidate[] => [35, 155, 275].map((bearing, index) => ({ title: `추천 코스 ${index + 1}`, summary: '도로 연결성과 고도 데이터를 기준으로 생성한 후보입니다.', waypoints: [destinationPoint(start, tripType === 'round' ? distanceKm / 2.4 : distanceKm * 0.78, bearing)] }))
const callOrs = async (coordinates: Point[]) => {
  const response = await fetch('https://api.openrouteservice.org/v2/directions/cycling-regular/geojson', { method: 'POST', headers: { Authorization: openRouteServiceKey.value(), 'Content-Type': 'application/json' }, body: JSON.stringify({ coordinates: coordinates.map(point => [point.lng, point.lat]), elevation: true, instructions: false }) })
  if (!response.ok) throw new Error(`ORS ${response.status}`)
  const data = await response.json() as { features?: Array<{ geometry?: { coordinates?: number[][] }; properties?: { summary?: { distance?: number; ascent?: number } } }> }; const route = data.features?.[0]
  if (!route?.geometry?.coordinates || !route.properties?.summary) throw new Error('ORS route missing')
  const elevations = route.geometry.coordinates.map(point => point[2]).filter(Number.isFinite)
  const geometryAscent = elevations.reduce((total, elevation, index) => index === 0 ? 0 : total + Math.max(0, elevation - elevations[index - 1]), 0)
  const ascent = route.properties.summary.ascent ?? (elevations.length > 1 ? geometryAscent : undefined)
  if (!Number.isFinite(ascent)) throw new Error('ORS elevation missing')
  let cumulativeDistance = 0
  const fullProfile = route.geometry.coordinates.map((point, index) => { if (index) cumulativeDistance += segmentDistanceKm(route.geometry!.coordinates![index - 1], point); return { distanceKm: Math.round(cumulativeDistance * 100) / 100, elevationM: Math.round(point[2]) } })
  const sampleEvery = Math.max(1, Math.ceil(fullProfile.length / 80)); const elevationProfile = fullProfile.filter((_, index) => index % sampleEvery === 0 || index === fullProfile.length - 1)
  return { coordinates: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })), distanceKm: Math.round((route.properties.summary.distance ?? 0) / 100) / 10, elevationM: Math.round(ascent!), elevationProfile }
}
const enforceRecommendationLimit = async (ip: string) => {
  const key = createHash('sha256').update(ip || 'unknown').digest('hex').slice(0, 32); const ref = db.collection('aiRateLimits').doc(key); const now = Date.now()
  await db.runTransaction(async tx => { const row = await tx.get(ref); const data = row.data() as { count?: number; windowStartedAt?: number } | undefined; const freshWindow = !data?.windowStartedAt || now - data.windowStartedAt > 3600000; const count = freshWindow ? 0 : data.count ?? 0; if (count >= 10) throw new HttpsError('resource-exhausted', '코스 추천은 시간당 10회까지 가능합니다.'); tx.set(ref, { count: count + 1, windowStartedAt: freshWindow ? now : data!.windowStartedAt, updatedAt: FieldValue.serverTimestamp() }) })
}

export const recommendCourses = onCall({ region, secrets: [openRouteServiceKey, openRouterKey], timeoutSeconds: 90, memory: '512MiB' }, async request => {
  const { start, startName, distanceKm, uphill, tripType } = request.data as { start?: Point; startName?: string; distanceKm?: number; uphill?: UphillLevel; tripType?: TripType }
  if (!isPoint(start) || !startName || !distanceKm || distanceKm < 5 || distanceKm > 200 || !['low', 'medium', 'high'].includes(uphill ?? '') || !['round', 'oneway'].includes(tripType ?? '')) throw new HttpsError('invalid-argument', '추천 조건을 다시 확인해 주세요.')
  await enforceRecommendationLimit(request.rawRequest.ip ?? 'unknown')
  const prompt = `대한민국 자전거 라이딩 코스 설계자 역할을 수행하세요. 출발지는 ${startName} (${start!.lat}, ${start!.lng}), 희망 거리는 ${distanceKm}km, 라이딩 유형은 ${tripType === 'round' ? '왕복/순환' : '편도'}, 업힐 선호는 ${uphill}입니다. 실제 자전거가 접근하기 좋은 서로 다른 방향의 후보 3개를 제안하세요. 각 후보의 경유지는 대한민국 범위의 WGS84 좌표여야 합니다. 설명은 한 문장으로 작성하세요.`
  let candidates: AiCandidate[] = []
  try {
    const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${openRouterKey.value()}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://cmjun0725.github.io/ridemate-pwa/', 'X-Title': 'RideMate' }, body: JSON.stringify({ model: 'google/gemini-2.5-flash', temperature: 0.35, messages: [{ role: 'system', content: '반드시 요청된 JSON 스키마만 반환하세요. 거리와 고도는 추측하지 말고 후보 지점만 제안하세요.' }, { role: 'user', content: prompt }], response_format: { type: 'json_schema', json_schema: { name: 'cycling_candidates', strict: true, schema: { type: 'object', properties: { candidates: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'object', properties: { title: { type: 'string' }, summary: { type: 'string' }, waypoints: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } }, required: ['lat', 'lng'], additionalProperties: false } } }, required: ['title', 'summary', 'waypoints'], additionalProperties: false } } }, required: ['candidates'], additionalProperties: false } } }, max_tokens: 900 }) })
    if (!aiResponse.ok) throw new Error(`OpenRouter ${aiResponse.status}`); const body = await aiResponse.json() as { choices?: Array<{ message?: { content?: string } }> }; const parsed = JSON.parse(body.choices?.[0]?.message?.content ?? '{}') as { candidates?: AiCandidate[] }; candidates = (parsed.candidates ?? []).filter(candidate => candidate.waypoints?.every(isPoint)).slice(0, 3)
  } catch (error) { console.warn('AI candidate generation fallback', error) }
  if (candidates.length < 3) candidates = fallbackCandidates(start!, distanceKm, tripType!)
  const results = await Promise.allSettled(candidates.map(async (candidate, index) => { const routePoints = [start!, ...candidate.waypoints, ...(tripType === 'round' ? [start!] : [])]; const verified = await callOrs(routePoints); const climbRate = verified.elevationM / Math.max(verified.distanceKm, 1); return { id: `candidate-${index + 1}`, title: candidate.title, summary: candidate.summary, ...verified, climbRate: Math.round(climbRate * 10) / 10, distanceDifferenceKm: Math.round(Math.abs(verified.distanceKm - distanceKm) * 10) / 10, verified: true } }))
  const fulfilled = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
  if (!fulfilled.length) throw new HttpsError('unavailable', '현재 조건으로 검증 가능한 코스를 찾지 못했습니다. 출발지나 거리를 바꿔 다시 시도해 주세요.')
  return { candidates: fulfilled.sort((a, b) => Number(a.distanceDifferenceKm) - Number(b.distanceDifferenceKm)).slice(0, 3) }
})

export const recommendRoute = onCall({ region, secrets: [openRouteServiceKey] }, async request => {
  requireAuth(request.auth?.uid)
  const { start, end } = request.data as { start?: Point; end?: Point }
  if (!start || !end || !Number.isFinite(start.lat) || !Number.isFinite(start.lng) || !Number.isFinite(end.lat) || !Number.isFinite(end.lng)) throw new HttpsError('invalid-argument', '출발지와 도착지 좌표가 필요합니다.')
  try { return await callOrs([start, end]) } catch { throw new HttpsError('unavailable', '경로 서비스를 일시적으로 사용할 수 없습니다.') }
})

export const joinRide = onCall({ region }, async request => {
  requireAuth(request.auth?.uid); const { rideId } = request.data as { rideId: string }; if (!rideId) throw new HttpsError('invalid-argument', 'rideId가 필요합니다.')
  const rideRef = db.collection('rides').doc(rideId); const memberRef = db.collection('rideMembers').doc(`${rideId}_${request.auth!.uid}`)
  await db.runTransaction(async tx => { const [ride, member] = await Promise.all([tx.get(rideRef), tx.get(memberRef)]); if (!ride.exists) throw new HttpsError('not-found', '라이딩을 찾을 수 없습니다.'); if (member.exists) throw new HttpsError('already-exists', '이미 참여했습니다.'); const data = ride.data()!; if (data.status !== '모집중' || data.memberCount >= data.capacity) throw new HttpsError('failed-precondition', '모집이 마감되었습니다.'); tx.set(memberRef, { rideId, userId: request.auth!.uid, rideAt: data.startsAt, joinedAt: FieldValue.serverTimestamp() }); tx.update(rideRef, { memberCount: FieldValue.increment(1) }) })
  return { ok: true }
})

export const castNoShowVote = onCall({ region }, async request => {
  requireAuth(request.auth?.uid); const { rideId, targetUserId, noShow } = request.data as { rideId: string; targetUserId: string; noShow: boolean }; if (!rideId || !targetUserId || targetUserId === request.auth!.uid) throw new HttpsError('invalid-argument', '유효하지 않은 투표입니다.')
  const ride = await db.collection('rides').doc(rideId).get(); if (!ride.exists || ride.data()!.status !== '완료') throw new HttpsError('failed-precondition', '종료된 라이딩에서만 투표할 수 있습니다.'); const endsAt = ride.data()!.endsAt?.toDate?.() as Date | undefined; if (!endsAt || Date.now() > endsAt.getTime() + 86400000) throw new HttpsError('deadline-exceeded', '투표 기간이 지났습니다.')
  const [voter, target] = await Promise.all([db.collection('rideMembers').doc(`${rideId}_${request.auth!.uid}`).get(), db.collection('rideMembers').doc(`${rideId}_${targetUserId}`).get()]); if (!voter.exists || !target.exists) throw new HttpsError('permission-denied', '해당 라이딩 참여자만 투표할 수 있습니다.')
  const voteRef = db.collection('votes').doc(`${rideId}_${targetUserId}_${request.auth!.uid}`)
  await db.runTransaction(async tx => { if ((await tx.get(voteRef)).exists) throw new HttpsError('already-exists', '이미 투표했습니다.'); tx.set(voteRef, { rideId, targetUserId, voterId: request.auth!.uid, noShow, createdAt: FieldValue.serverTimestamp() }) }); return { ok: true }
})

export const resolveNoShowVote = onDocumentCreated({ region, document: 'votes/{voteId}' }, async event => {
  const vote = event.data!.data(); const voteRows = await db.collection('votes').where('rideId', '==', vote.rideId).where('targetUserId', '==', vote.targetUserId).get()
  const affirmative = voteRows.docs.filter(d => d.data().noShow === true).length
  if (voteRows.size < 3 || affirmative * 2 <= voteRows.size) return
  const recordRef = db.collection('noShowRecords').doc(`${vote.rideId}_${vote.targetUserId}`)
  await db.runTransaction(async tx => { const record = await tx.get(recordRef); if (record.exists) return; tx.set(recordRef, { rideId: vote.rideId, riderId: vote.targetUserId, voteCount: voteRows.size, confirmedAt: FieldValue.serverTimestamp() }); tx.update(db.collection('users').doc(vote.targetUserId), { noShowCount: FieldValue.increment(1) }) })
})

export const notifyVoteOpened = onDocumentCreated({ region, document: 'rides/{rideId}/voteEvents/{eventId}' }, async event => {
  const rideId = event.params.rideId; const members = await db.collection('rideMembers').where('rideId', '==', rideId).get(); const ids = members.docs.map(d => d.data().userId); const tokens = await db.collection('deviceTokens').where('userId', 'in', ids.slice(0, 10)).get(); const values = tokens.docs.map(d => d.data().token).filter(Boolean); if (values.length) await getMessaging().sendEachForMulticast({ tokens: values, notification: { title: '노쇼 확인 투표', body: '라이딩 참여 여부를 확인해 주세요.' }, data: { rideId } });
})
