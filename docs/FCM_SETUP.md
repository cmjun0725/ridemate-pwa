# RideMate FCM 웹 푸시·VAPID 설정

## 1. Firebase에서 웹 푸시 인증서 생성

1. [Firebase Console](https://console.firebase.google.com/)에서 `clycling-community` 프로젝트를 엽니다.
2. 왼쪽 위 톱니바퀴 → **프로젝트 설정** → **클라우드 메시징**으로 이동합니다.
3. **웹 구성** 또는 **웹 푸시 인증서** 영역에서 **키 쌍 생성**을 누릅니다.
4. 생성된 키 쌍의 긴 **공개 키**를 복사합니다. 이 값이 `VITE_FIREBASE_VAPID_KEY`입니다.

공개 VAPID 키는 브라우저 번들에 포함되는 공개 식별값입니다. Firebase 서비스 계정 비공개 키나 서버 키를 넣으면 안 됩니다.

## 2. Firebase Hosting 빌드에 공개 키 연결

로컬 배포용 `.env.local`에 다음 값을 추가합니다.

```dotenv
VITE_FIREBASE_VAPID_KEY=Firebase에서_복사한_공개키
```

`.env.local`은 Git에 커밋하지 않습니다. 이후 `npm run build`와 `firebase deploy --only hosting --project clycling-community`를 실행합니다.

GitHub의 자동 검사에도 같은 키를 연결하려면:

1. GitHub 저장소 `cmjun0725/ridemate-pwa` → **Settings** → **Secrets and variables** → **Actions**로 이동합니다.
2. **New repository secret**을 누릅니다.
3. Name에 정확히 `VITE_FIREBASE_VAPID_KEY`, Secret에 Firebase에서 복사한 공개 키를 붙여 넣고 저장합니다.
4. 저장소 **Actions** → `Verify web app` → **Run workflow**를 실행하거나 새 커밋을 push합니다.
5. verify 작업이 초록색인지 확인합니다. 이 작업은 배포가 아니라 프로덕션 빌드 검증입니다.

워크플로는 이미 다음 환경 변수 연결을 포함합니다.

```yaml
VITE_FIREBASE_VAPID_KEY: "${{ secrets.VITE_FIREBASE_VAPID_KEY }}"
```

## 3. Firebase와 브라우저 조건 확인

- Firebase Authentication에 로그인한 사용자만 RideMate 서버에 기기 토큰을 저장할 수 있습니다.
- 웹 푸시는 HTTPS에서만 동작합니다. Firebase Hosting 주소는 HTTPS이므로 조건을 만족합니다.
- Firebase Console의 프로젝트 설정 → 일반 → 웹 앱에 등록된 `messagingSenderId`가 `580065543389`인지 확인합니다.
- Google Cloud Console에서 **Firebase Cloud Messaging API**가 활성화되어 있어야 합니다.
- iPhone/iPad 웹 푸시는 지원되는 iOS에서 사이트를 홈 화면에 설치한 뒤 허용해야 합니다. 일반 Safari 탭만으로는 환경에 따라 알림 설정이 제한됩니다.

## 4. 사용자 기기에서 알림 켜기

1. 배포된 [RideMate](https://clycling-community.web.app/)에 로그인합니다.
2. **프로필** → **이 기기 푸시 알림 켜기**를 누릅니다.
3. 브라우저 권한 창에서 **허용**을 선택합니다.
4. `이 기기에서 푸시 알림을 받습니다.`가 표시되면 FCM 토큰이 서버의 `deviceTokens` 컬렉션에 저장된 상태입니다.

권한을 거부했다면 브라우저 주소창의 사이트 설정에서 알림을 다시 허용한 뒤 버튼을 누릅니다. 시크릿 모드, 학교·회사 관리 브라우저, OS 알림 차단 상태에서는 실패할 수 있습니다.

## 5. 테스트 메시지 보내기

1. Firebase Console → **Messaging**에서 첫 캠페인 또는 테스트 메시지를 만듭니다.
2. 테스트 기기의 등록 토큰이 필요하면 Firestore의 `deviceTokens` 문서에서 본인 계정 토큰을 확인합니다. 토큰을 외부에 공개하지 않습니다.
3. 알림 제목과 본문을 입력하고 **테스트 메시지 전송**에서 토큰을 지정합니다.
4. 앱이 열려 있을 때와 닫혀 있을 때 각각 확인합니다.

RideMate 서비스 워커는 백그라운드 `push` 이벤트를 직접 처리하고, 알림을 누르면 `내 라이딩` 화면으로 이동합니다. 앱이 열려 있을 때는 Firebase `onMessage`를 받아 동일한 시스템 알림을 표시합니다.

## 6. 문제 해결

- `Firebase 웹 푸시 인증키(VAPID) 설정이 아직 필요합니다.`: `.env.local` 값과 Firebase Hosting 재빌드·재배포 여부를 확인합니다.
- `알림 권한이 허용되지 않았습니다.`: 브라우저와 OS 알림 권한을 모두 확인합니다.
- 토큰은 저장됐지만 알림이 오지 않음: FCM API 활성화, 서비스 워커 등록, OS 집중 모드, Firebase 발송 결과를 확인합니다.
- 배포 직후 이전 서비스 워커가 남음: 페이지를 새로고침하고 잠시 기다리거나 브라우저 사이트 데이터에서 기존 서비스 워커를 갱신합니다.
- 기기를 바꾸거나 브라우저 프로필을 바꾸면 토큰도 달라지므로 각 기기에서 한 번씩 알림을 켭니다.
