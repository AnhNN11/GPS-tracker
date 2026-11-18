// No GPS polling or private-data caching in the service worker.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title || "Campus Guard", {
      body: data.body || "Có cảnh báo cần kiểm tra.",
      tag: data.tag || "campus-guard",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: "/" },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const tab of tabs) {
        if (new URL(tab.url).origin === self.location.origin) {
          await tab.focus();
          return;
        }
      }
      await self.clients.openWindow("/");
    })(),
  );
});
