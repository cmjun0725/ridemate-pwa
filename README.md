# 라이드메이트

대한민국 자전거 라이더를 위한 모바일 우선 라이딩 매칭 PWA입니다. 코스와 거리·누적 상승고도를 확인하고, 편의점·화장실·정비소 정차 지점을 정해 함께 달릴 수 있습니다.

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
- AI 3개 코스 추천, 수변 자전거길 우선 추천, ORS 자전거 경로·거리·누적 상승고도 검증
- GPX 또는 출발·도착 직접 입력, 고도 그래프, 코스 주변 편의점·화장실·자전거 정비소
- 실제 참여·취소, 참여자 채팅, 즐겨찾기, 후기, 신고·차단, 노쇼 투표
- 비상 연락처, 15분 단위 선택적 위치 공유, 알림 설정, FCM 기기 토큰 등록
- 관리자 회원/라이딩/신고/감사 로그, GA4, 온보딩, 설치 배너, 오프라인 폴백
- PWA 192/512/maskable 아이콘, iOS 메타, OG/Twitter/Kakao 공유 이미지, robots/sitemap/404 처리

## 필수 외부 설정

1. Firebase 프로젝트에서 Authentication(이메일/비밀번호, Google), Firestore, Cloud Functions, Cloud Messaging을 활성화합니다.
2. 카카오 개발자 앱을 만들고 GitHub Pages 주소를 플랫폼 도메인으로 등록합니다. JavaScript 키는 `VITE_KAKAO_MAP_KEY`에, REST 키는 서버 비밀 환경 변수에 저장합니다.
3. OpenRouteService 계정을 만들고 자전거 프로필용 API 키를 Cloud Functions 비밀 환경 변수에 저장합니다. 브라우저에 키를 노출하지 않습니다.
4. Cloud Messaging의 웹 푸시 인증서 공개 키를 GitHub Actions secret `VITE_FIREBASE_VAPID_KEY`로 등록합니다.
5. 카카오 OAuth는 카카오 REST 키를 Secret Manager에 추가하고 서버가 카카오 토큰을 검증한 뒤 Firebase Custom Token을 발급하도록 설정합니다. 현재 배포는 이메일·Google 로그인까지 제공합니다.
6. 휴대폰·본인인증은 PASS/KCB 같은 국내 본인확인기관 계약 후 `identityStatus` 갱신 웹훅을 연결해야 합니다. 현재 UI는 미인증 상태를 명확히 표시합니다.
7. 이용약관·개인정보·위치서비스 안내의 사업자 정보와 위치정보관리책임자를 정식 출시 전에 법률 검토 후 확정합니다.
8. `firebase use <project-id>` 후 `firebase deploy --only firestore,functions`로 규칙과 함수를 배포합니다.

## GitHub Pages

1. 이 폴더를 새 공개 GitHub 저장소 `ridemate-pwa`로 push합니다.
2. 저장소 Settings → Pages에서 **GitHub Actions**를 배포 소스로 선택합니다.
3. 기본 브랜치 `main`에 push하면 `.github/workflows/deploy-pages.yml`이 PWA를 배포합니다.

Firebase 함수 배포에는 Firebase CLI 로그인 및 프로젝트 권한이 필요합니다. API 키·서비스 계정·VAPID 키는 Git에 커밋하지 마세요.

## 정책

노쇼 투표는 라이딩 종료 후 24시간 동안 해당 라이딩 참여자만 할 수 있고, 자기 자신에게 투표할 수 없습니다. 최소 3표와 유효표 과반이 충족될 때에만 서버가 노쇼 1회를 기록합니다.
