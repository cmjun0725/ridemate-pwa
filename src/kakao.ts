import type { Coordinate } from './types'

let kakaoPromise: Promise<any> | undefined

export function loadKakaoMaps() {
  if (kakaoPromise) return kakaoPromise
  kakaoPromise = new Promise((resolve, reject) => {
    const key = import.meta.env.VITE_KAKAO_MAP_KEY
    if (!key) { reject(new Error('카카오 JavaScript 키가 설정되지 않았습니다.')); return }
    const finish = () => {
      if (!window.kakao?.maps) { reject(new Error('카카오맵 SDK 객체를 찾지 못했습니다.')); return }
      window.kakao.maps.load(() => resolve(window.kakao))
    }
    if (window.kakao?.maps) { finish(); return }
    const existing = document.querySelector<HTMLScriptElement>('script[data-kakao-map]')
    if (existing) { existing.addEventListener('load', finish, { once: true }); existing.addEventListener('error', () => reject(new Error('카카오맵 SDK를 불러오지 못했습니다.')), { once: true }); return }
    const script = document.createElement('script'); script.dataset.kakaoMap = 'true'; script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false&libraries=services`; script.async = true; script.onload = finish; script.onerror = () => reject(new Error('카카오맵 SDK 도메인 허용 설정을 확인해 주세요.')); document.head.appendChild(script)
    window.setTimeout(() => reject(new Error('카카오맵 응답 시간이 초과되었습니다. JavaScript SDK 도메인을 확인해 주세요.')), 12000)
  })
  return kakaoPromise
}

export async function geocodePlace(query: string): Promise<Coordinate & { name: string }> {
  const kakao = await loadKakaoMaps()
  return new Promise((resolve, reject) => {
    const places = new kakao.maps.services.Places()
    places.keywordSearch(query, (results: Array<{ y: string; x: string; place_name: string }>, status: string) => {
      if (status !== kakao.maps.services.Status.OK || !results[0]) { reject(new Error('출발지를 찾지 못했습니다. 더 구체적으로 입력해 주세요.')); return }
      resolve({ lat: Number(results[0].y), lng: Number(results[0].x), name: results[0].place_name })
    })
  })
}
