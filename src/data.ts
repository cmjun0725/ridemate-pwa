import type { Ride } from './types'

const seoulLoop = [
  { lat: 37.5665, lng: 126.978 }, { lat: 37.557, lng: 126.989 }, { lat: 37.548, lng: 127.012 }, { lat: 37.536, lng: 127.058 }, { lat: 37.54, lng: 127.085 }, { lat: 37.562, lng: 127.088 }, { lat: 37.576, lng: 127.06 }, { lat: 37.5665, lng: 126.978 },
]
export const demoRides: Ride[] = [
  { id: 'han-river-sunset', title: '한강 노을 라이딩', startsAt: '2026-09-03T18:30:00+09:00', paceKmh: 25, capacity: 8, status: '모집중', meetingNote: '여의나루역 2번 출구 앞', host: { id: 'min', name: '민준', noShowCount: 0 }, members: [{ id: 'min', name: '민준', noShowCount: 0 }, { id: 'yeji', name: '예지', noShowCount: 0 }, { id: 'woo', name: '우진', noShowCount: 1 }], course: { id: 'han-river', title: '한강 남단 순환', startName: '여의도 한강공원', endName: '여의도 한강공원', distanceKm: 42, elevationM: 185, coordinates: seoulLoop, createdAt: '2026-08-28', stops: [{ id: 's1', name: '반포 편의점', kind: '편의점', coordinate: seoulLoop[2], selected: true }, { id: 's2', name: '뚝섬 화장실', kind: '화장실', coordinate: seoulLoop[4] }, { id: 's3', name: '잠실 자전거 정비소', kind: '정비소', coordinate: seoulLoop[5] }] } },
  { id: 'bukhan-climb', title: '북한산 업힐 연습', startsAt: '2026-09-05T07:00:00+09:00', paceKmh: 20, capacity: 6, status: '모집중', meetingNote: '불광역 4번 출구', host: { id: 'jisu', name: '지수', noShowCount: 0 }, members: [{ id: 'jisu', name: '지수', noShowCount: 0 }, { id: 'hyun', name: '현우', noShowCount: 0 }], course: { id: 'bukhan', title: '북한산 순환 업힐', startName: '불광역', endName: '불광역', distanceKm: 58, elevationM: 920, coordinates: seoulLoop, createdAt: '2026-08-29', stops: [{ id: 's4', name: '구기동 편의점', kind: '편의점', coordinate: seoulLoop[1] }, { id: 's5', name: '북한산 화장실', kind: '화장실', coordinate: seoulLoop[3], selected: true }] } },
]
