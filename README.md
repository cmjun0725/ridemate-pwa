# 라이드메이트

대한민국 자전거 라이더를 위한 모바일 우선 라이딩 매칭 PWA입니다. 코스와 거리·누적 상승고도를 확인하고, 편의점·화장실·정비소 정차 지점을 정해 함께 달릴 수 있습니다.

## 로컬 실행

```bash
npm install
copy .env.example .env.local
npm run dev
```

Firebase 설정 전에도 데모 라이딩 화면은 확인할 수 있습니다. 실제 로그인·참여·투표 기능은 Firebase 설정 후 동작합니다.

## 필수 외부 설정

1. Firebase 프로젝트에서 Authentication(이메일), Firestore, Cloud Functions, Cloud Messaging을 활성화합니다.
2. 카카오 개발자 앱을 만들고 GitHub Pages 주소를 플랫폼 도메인으로 등록합니다. JavaScript 키는 `VITE_KAKAO_MAP_KEY`에, REST 키는 서버 비밀 환경 변수에 저장합니다.
3. OpenRouteService 계정을 만들고 자전거 프로필용 API 키를 Cloud Functions 비밀 환경 변수에 저장합니다. 브라우저에 키를 노출하지 않습니다.
4. 카카오 OAuth는 서버가 카카오 토큰을 검증한 뒤 Firebase Custom Token을 발급하도록 설정합니다.
5. `firebase use <project-id>` 후 `firebase deploy --only firestore,functions`로 규칙과 함수를 배포합니다.

## GitHub Pages

1. 이 폴더를 새 공개 GitHub 저장소 `ridemate-pwa`로 push합니다.
2. 저장소 Settings → Pages에서 **GitHub Actions**를 배포 소스로 선택합니다.
3. 기본 브랜치 `main`에 push하면 `.github/workflows/deploy-pages.yml`이 PWA를 배포합니다.

Firebase 함수 배포에는 Firebase CLI 로그인 및 프로젝트 권한이 필요합니다. API 키·서비스 계정·VAPID 키는 Git에 커밋하지 마세요.

## 정책

노쇼 투표는 라이딩 종료 후 24시간 동안 해당 라이딩 참여자만 할 수 있고, 자기 자신에게 투표할 수 없습니다. 최소 3표와 유효표 과반이 충족될 때에만 서버가 노쇼 1회를 기록합니다.
