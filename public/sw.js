const CACHE = "ridemate-shell-v5";
const ASSETS = [
  "./",
  "./offline.html",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
];
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok)
            caches
              .open(CACHE)
              .then((cache) => cache.put("./", response.clone()));
          return response;
        })
        .catch(
          async () =>
            (await caches.match("./")) ||
            (await caches.match("./offline.html")),
        ),
    );
    return;
  }
  if (
    !["script", "style", "image", "font", "manifest"].includes(
      request.destination,
    )
  )
    return;
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok && response.type === "basic")
          caches
            .open(CACHE)
            .then((cache) => cache.put(request, response.clone()));
        return response;
      });
      return cached || network;
    }),
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { notification: { body: event.data.text() } };
  }
  const notification = payload.notification ?? {};
  const data = payload.data ?? {};
  event.waitUntil(
    self.registration.showNotification(
      notification.title ?? "RideMate 알림",
      {
        body: notification.body ?? "라이딩 업데이트를 확인해 주세요.",
        icon: "./icon-192.png",
        badge: "./icon-192.png",
        tag: data.rideId ? `ride-${data.rideId}` : "ridemate-update",
        renotify: Boolean(data.rideId),
        data: {
          url: data.url ?? (data.rideId ? "./?view=my" : "./"),
        },
      },
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url ?? "./", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const sameOrigin = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (sameOrigin) {
        await sameOrigin.navigate(targetUrl);
        return sameOrigin.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
