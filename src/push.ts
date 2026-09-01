import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { app } from "./firebase";
import { registerDeviceToken } from "./services";

let foregroundListenerAttached = false;

export async function listenForForegroundMessages() {
  if (
    foregroundListenerAttached ||
    !app ||
    !(await isSupported()) ||
    Notification.permission !== "granted"
  ) return;
  foregroundListenerAttached = true;
  onMessage(getMessaging(app), async (payload) => {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(
      payload.notification?.title ?? "RideMate 알림",
      {
        body: payload.notification?.body ?? "라이딩 업데이트를 확인해 주세요.",
        icon: `${import.meta.env.BASE_URL}icon-192.png`,
        badge: `${import.meta.env.BASE_URL}icon-192.png`,
        tag: payload.data?.rideId ? `ride-${payload.data.rideId}` : "ridemate-update",
        data: { url: payload.data?.rideId ? `${import.meta.env.BASE_URL}?view=my` : import.meta.env.BASE_URL },
      },
    );
  });
}

export async function enablePushNotifications() {
  if (!app || !(await isSupported()))
    throw new Error("이 브라우저는 웹 푸시를 지원하지 않습니다.");
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  if (!vapidKey)
    throw new Error("Firebase 웹 푸시 인증키(VAPID) 설정이 아직 필요합니다.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error("알림 권한이 허용되지 않았습니다.");
  const registration = await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(app), {
    vapidKey,
    serviceWorkerRegistration: registration,
  });
  if (!token) throw new Error("푸시 토큰을 만들지 못했습니다.");
  await registerDeviceToken(token);
  await listenForForegroundMessages();
  return "이 기기에서 푸시 알림을 받습니다.";
}
