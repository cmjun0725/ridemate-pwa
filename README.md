# 라이드메이트

대한민국 자전거 라이더를 위한 모바일 우선 라이딩 매칭 PWA이자 디미고 프로젝트입니다. `코스 선정 → 인원 모집 → 실제 라이딩`을 핵심 흐름으로 삼고, 코스의 거리·업힐과 편의점·화장실·정비소를 한 화면에서 확인합니다.

## 코스 선정 기술

생성형 AI는 사용하지 않습니다. 출발점과 희망 거리로 서로 다른 6개 방향의 왕복·편도 후보를 만들고, OpenStreetMap 기반 ORS `cycling-regular` 도로망에서 실제 주행 가능한 경로를 계산합니다. 반환된 거리·누적 상승고도를 희망 거리와 업힐 강도에 맞춰 점수화해 상위 3개를 제시합니다. 고도 좌표에서 연속 경사 구간을 판별해 지도에서는 빨간 선으로, 상세 화면에서는 시작·끝 거리·획득고도·평균 경사도로 표시합니다.

## 로컬 실행

```bash
npm install
copy .env.example .env.local
npm run dev
```

데모 데이터는 포함하지 않습니다. Firebase 연결에 실패하면 공개 피드의 최근 캐시와 오프라인 앱 셸을 표시합니다.

검증 명령:

```bash
npm run lint
npm test
npm run build
cd functions && npm run build
```

## 구현 기능

- 이메일·Google 로그인 UI, 관리자 커스텀 클레임, 공개 라이딩 피드와 거리·평속·지역 검색
- AI 없는 데이터 기반 3개 코스 설계, ORS 자전거 경로·거리·누적 상승고도 검증, 업힐 구간 분석·빨간 지도 표시
- GPX 또는 출발·도착 직접 입력, 고도 그래프, 코스 주변 편의점·화장실·자전거 정비소
- 실제 참여·취소, 방장 시작·종료, 라이딩 모드, 참여자 채팅, 즐겨찾기, 후기, 신고·차단, 노쇼 투표
- 비상 연락처, 15분 단위 선택적 위치 공유, 알림 설정, FCM 기기 토큰 등록
- 관리자 회원/라이딩/신고/감사 로그, 개인정보 최소화 1차 행동 이벤트, 온보딩, 설치 배너, 오프라인 폴백
- PWA 192/512/maskable 아이콘, iOS 메타, OG/Twitter/Kakao 공유 이미지, robots/sitemap/404 처리

## 필수 외부 설정

1. Firebase 프로젝트에서 Authentication(이메일/비밀번호, Google), Firestore, Cloud Functions, Cloud Messaging을 활성화합니다.
2. 카카오 개발자 앱의 Web 플랫폼 도메인에 `https://clycling-community.web.app`을 등록합니다. JavaScript 키는 `VITE_KAKAO_MAP_KEY`에, REST 키는 서버 비밀 환경 변수에 저장합니다.
3. OpenRouteService 계정을 만들고 자전거 프로필용 API 키를 Cloud Functions 비밀 환경 변수에 저장합니다. 브라우저에 키를 노출하지 않습니다.
4. Cloud Messaging의 웹 푸시 인증서 공개 키를 로컬 `.env.local`과 GitHub Actions secret `VITE_FIREBASE_VAPID_KEY`에 등록합니다. 상세 절차는 [FCM VAPID 설정 가이드](docs/FCM_SETUP.md)를 따릅니다.
5. 카카오 OAuth는 카카오 REST 키를 Secret Manager에 추가하고 서버가 카카오 토큰을 검증한 뒤 Firebase Custom Token을 발급하도록 설정합니다. 현재 배포는 이메일·Google 로그인까지 제공합니다.
6. 휴대폰·본인인증은 PASS/KCB 같은 국내 본인확인기관 계약 후 `identityStatus` 갱신 웹훅을 연결해야 합니다. 현재 UI는 미인증 상태를 명확히 표시합니다.
7. 이용약관·개인정보·위치서비스 안내의 사업자 정보와 위치정보관리책임자를 정식 출시 전에 법률 검토 후 확정합니다.
8. `firebase use clycling-community` 후 `firebase deploy --only hosting,firestore,functions`로 웹 앱·규칙·함수를 배포합니다.

## Firebase Hosting

프로덕션 주소는 [https://clycling-community.web.app](https://clycling-community.web.app)입니다. GitHub Pages 배포는 사용하지 않으며 앱의 base URL은 `/`입니다.

```bash
npm run build
firebase deploy --only hosting --project clycling-community
```

`main` 브랜치에 push하면 `.github/workflows/ci.yml`이 앱과 Cloud Functions를 검사합니다. Hosting 배포는 Firebase CLI 로그인 또는 별도의 Firebase 서비스 계정 설정이 필요하므로 CI 성공과 분리합니다.

Firebase 함수 배포에는 Firebase CLI 로그인 및 프로젝트 권한이 필요합니다. API 키·서비스 계정·VAPID 키는 Git에 커밋하지 마세요.

## 정책

노쇼 투표는 라이딩 종료 후 24시간 동안 해당 라이딩 참여자만 할 수 있고, 자기 자신에게 투표할 수 없습니다. 최소 3표와 유효표 과반이 충족될 때에만 서버가 노쇼 1회를 기록합니다.
