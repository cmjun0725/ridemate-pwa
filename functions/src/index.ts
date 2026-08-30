import { initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getMessaging } from 'firebase-admin/messaging'
import { HttpsError, onCall } from 'firebase-functions/https'
import { onDocumentCreated } from 'firebase-functions/firestore'
import { defineSecret } from 'firebase-functions/params'

initializeApp(); const db = getFirestore(); const region = 'asia-northeast3'
const openRouteServiceKey = defineSecret('OPENROUTESERVICE_API_KEY')
const requireAuth = (uid?: string) => { if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.') }

type Point = { lat: number; lng: number }
export const recommendRoute = onCall({ region, secrets: [openRouteServiceKey] }, async request => {
  requireAuth(request.auth?.uid)
  const { start, end } = request.data as { start?: Point; end?: Point }
  if (!start || !end || !Number.isFinite(start.lat) || !Number.isFinite(start.lng) || !Number.isFinite(end.lat) || !Number.isFinite(end.lng)) throw new HttpsError('invalid-argument', '출발지와 도착지 좌표가 필요합니다.')
  const response = await fetch('https://api.openrouteservice.org/v2/directions/cycling-regular/geojson', { method: 'POST', headers: { Authorization: openRouteServiceKey.value(), 'Content-Type': 'application/json' }, body: JSON.stringify({ coordinates: [[start.lng, start.lat], [end.lng, end.lat]], elevation: true, instructions: false }) })
  if (!response.ok) throw new HttpsError('unavailable', '경로 서비스를 일시적으로 사용할 수 없습니다.')
  const data = await response.json() as { features?: Array<{ geometry?: { coordinates?: number[][] }; properties?: { summary?: { distance?: number; ascent?: number } } }> }
  const route = data.features?.[0]
  if (!route?.geometry?.coordinates || !route.properties?.summary) throw new HttpsError('not-found', '조건에 맞는 자전거 경로를 찾지 못했습니다.')
  return { coordinates: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })), distanceKm: Math.round((route.properties.summary.distance ?? 0) / 100) / 10, elevationM: Math.round(route.properties.summary.ascent ?? 0) }
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
