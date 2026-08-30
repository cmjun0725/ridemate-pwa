import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronRight, CircleUserRound, Clock3, MapPin, Mountain, Plus, Route, Search, Users, Wrench, X } from 'lucide-react'
import { demoRides } from './data'
import type { Ride } from './types'

type Tab = 'home' | 'search' | 'create' | 'my' | 'profile'
const fmt = (value: string) => new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))

function MapPreview({ ride }: { ride: Ride }) {
  const container = useRef<HTMLDivElement>(null)
  const key = import.meta.env.VITE_KAKAO_MAP_KEY
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (!key || !container.current) return
    const draw = () => {
      const kakao = window.kakao
      if (!kakao || !container.current) return
      kakao.maps.load(() => {
        const points = ride.course.coordinates.map(point => new kakao.maps.LatLng(point.lat, point.lng))
        const map = new kakao.maps.Map(container.current!, { center: points[0], level: 7 })
        new kakao.maps.Polyline({ path: points, strokeWeight: 5, strokeColor: '#087458', strokeOpacity: 0.85, strokeStyle: 'solid' }).setMap(map)
        new kakao.maps.Marker({ position: points[0], map, title: `출발 · ${ride.course.startName}` })
        new kakao.maps.Marker({ position: points[points.length - 1], map, title: `도착 · ${ride.course.endName}` })
        ride.course.stops.forEach(stop => new kakao.maps.Marker({ position: new kakao.maps.LatLng(stop.coordinate.lat, stop.coordinate.lng), map, title: `${stop.kind} · ${stop.name}` }))
        setLoaded(true)
      })
    }
    const existing = document.querySelector<HTMLScriptElement>('script[data-kakao-map]')
    if (existing) { if (window.kakao) draw(); else existing.addEventListener('load', draw, { once: true }); return }
    const script = document.createElement('script'); script.dataset.kakaoMap = 'true'; script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false`; script.async = true; script.addEventListener('load', draw, { once: true }); document.head.appendChild(script)
  }, [key, ride])
  if (key) return <div className="map live-map" ref={container} aria-label={`${ride.course.title} 실제 카카오 지도`}><span className="map-label">{loaded ? '카카오맵 · 코스 및 주변 시설' : '카카오맵 불러오는 중…'}</span></div>
  return <div className="map" aria-label={`${ride.course.title} 코스 지도 미리보기`}>
    <div className="grid" /><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M7 52 C 18 16, 34 81, 48 43 S 73 12, 91 55 S 75 88, 55 72" /></svg>
    <span className="pin start"><MapPin size={18} /></span><span className="pin poi"><Wrench size={15} /></span><span className="pin finish"><MapPin size={18} /></span>
    <span className="map-label">코스 및 주변 시설</span>
  </div>
}

function RideCard({ ride, onOpen }: { ride: Ride; onOpen: () => void }) {
  return <button className="ride-card" onClick={onOpen}><div className="ride-date"><CalendarDays size={16} /> {fmt(ride.startsAt)}</div><h3>{ride.title}</h3><p>{ride.course.startName} · {ride.course.distanceKm}km · 상승 {ride.course.elevationM}m</p><div className="ride-meta"><span><Users size={16} /> {ride.members.length}/{ride.capacity}</span><span>{ride.paceKmh}km/h</span><span className="open">{ride.status}</span><ChevronRight size={18} /></div></button>
}

function RideDetail({ ride, onBack }: { ride: Ride; onBack: () => void }) {
  const [joined, setJoined] = useState(false)
  return <section className="page detail"><button className="back" onClick={onBack}>← 목록으로</button><MapPreview ride={ride} /><div className="detail-head"><div><span className="eyebrow">{ride.status}</span><h1>{ride.title}</h1><p>{fmt(ride.startsAt)}</p></div><button className={joined ? 'secondary' : 'primary'} onClick={() => setJoined(!joined)}>{joined ? '참여 취소' : '라이딩 참여'}</button></div><div className="stat-grid"><span><Route />{ride.course.distanceKm} km<small>거리</small></span><span><Mountain />{ride.course.elevationM} m<small>누적 상승</small></span><span><Clock3 />{ride.paceKmh} km/h<small>목표 평속</small></span></div><article className="info"><h2>집합 장소</h2><p><MapPin size={17}/>{ride.meetingNote}</p></article><article className="info"><h2>코스 정차 지점</h2>{ride.course.stops.map(stop => <p key={stop.id}><span className="dot" />{stop.name}<em>{stop.kind}{stop.selected ? ' · 확정' : ''}</em></p>)}</article><article className="info"><h2>참여 라이더 {ride.members.length}명</h2><div className="avatars">{ride.members.map(member => <span key={member.id} title={member.name}>{member.name.slice(0, 1)}</span>)}</div></article></section>
}

function CreateRide({ onCreated }: { onCreated: () => void }) {
  const [mode, setMode] = useState<'destination' | 'preference'>('destination')
  const [submitted, setSubmitted] = useState(false)
  if (submitted) return <section className="page result"><div className="success">✓</div><h1>코스 후보를 만들었어요</h1><p>거리와 고도 조건을 확인한 3개 후보를 준비했습니다.</p><button className="primary wide" onClick={onCreated}>후보 코스 보기</button></section>
  return <section className="page"><h1>라이딩 만들기</h1><p className="sub">조건에 맞는 안전한 라이딩 코스를 찾아드려요.</p><div className="segmented"><button className={mode === 'destination' ? 'active' : ''} onClick={() => setMode('destination')}>출발·도착지</button><button className={mode === 'preference' ? 'active' : ''} onClick={() => setMode('preference')}>거리·업힐</button></div><form onSubmit={e => { e.preventDefault(); setSubmitted(true) }}><label>출발 장소<input required placeholder="예: 여의도 한강공원" /></label>{mode === 'destination' ? <label>도착 장소<input required placeholder="예: 반포 한강공원" /></label> : <div className="two"><label>희망 거리<input required type="number" min="5" placeholder="40" /><small>km</small></label><label>원하는 업힐<select defaultValue="보통"><option>평지 위주</option><option>보통</option><option>도전적</option></select></label></div>}<div className="two"><label>출발 일시<input required type="datetime-local" /></label><label>목표 평속<select defaultValue="25"><option value="20">20 km/h</option><option value="25">25 km/h</option><option value="30">30 km/h</option></select></label></div><label>모집 인원<input required type="number" min="2" max="20" defaultValue="6" /></label><button className="primary wide" type="submit"><Route size={18}/> 코스 후보 찾기</button></form></section>
}

export default function App() {
  const [tab, setTab] = useState<Tab>('home'); const [selected, setSelected] = useState<Ride | null>(null); const [query, setQuery] = useState('')
  const rides = useMemo(() => demoRides.filter(r => r.title.includes(query) || r.course.startName.includes(query)), [query])
  const content = selected ? <RideDetail ride={selected} onBack={() => setSelected(null)} /> : tab === 'create' ? <CreateRide onCreated={() => { setTab('home'); setSelected(demoRides[0]) }} /> : tab === 'profile' ? <section className="page profile"><CircleUserRound size={66}/><h1>라이더 프로필</h1><p className="sub">로그인하면 내가 만든 코스와 라이딩 이력을 관리할 수 있어요.</p><button className="primary wide">카카오로 시작하기</button><button className="secondary wide">이메일로 로그인</button><article className="notice"><b>노쇼 정책</b><p>라이딩 종료 후 참여자 투표에서 최소 3표·과반으로 확정된 경우에만 노쇼 이력이 기록됩니다.</p></article></section> : <section className="page"><div className="hero"><span>함께 달리는 더 안전한 라이딩</span><h1>오늘, 누구와<br/>어디로 달릴까요?</h1><button className="hero-action" onClick={() => setTab('create')}><Plus size={18}/> 라이딩 만들기</button></div><div className="search"><Search size={18}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="지역 또는 코스 검색" /><button aria-label="검색어 지우기" onClick={() => setQuery('')}><X size={16}/></button></div><div className="section-title"><h2>{tab === 'search' ? '검색 결과' : '지금 모집 중인 라이딩'}</h2><button onClick={() => setTab('search')}>전체 보기</button></div><div className="list">{rides.map(ride => <RideCard key={ride.id} ride={ride} onOpen={() => setSelected(ride)} />)}{rides.length === 0 && <p className="empty">조건에 맞는 라이딩이 없습니다.</p>}</div></section>
  return <main className="app-shell"><header><button onClick={() => {setTab('home');setSelected(null)}} className="logo">RIDEMATE<span>라이딩 메이트</span></button><button className="bell" aria-label="알림">●</button></header>{content}{!selected && <nav>{([['home','홈'],['search','탐색'],['create','만들기'],['my','내 라이딩'],['profile','프로필']] as [Tab,string][]).map(([id,label]) => <button key={id} onClick={() => setTab(id)} className={tab === id ? 'current' : ''}>{id === 'create' ? <Plus size={22}/> : id === 'search' ? <Search size={21}/> : id === 'profile' ? <CircleUserRound size={21}/> : id === 'my' ? <CalendarDays size={21}/> : <Route size={21}/>}<span>{label}</span></button>)}</nav>}</main>
}
