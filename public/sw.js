// Service worker for browser push (see lib/push.ts). Shows the reminder and
// opens/focuses the app at its link when clicked.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "Clandar", body: event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Clandar", {
      body: data.body || "",
      data: { link: data.link || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.link || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.startsWith(self.location.origin));
      if (open) {
        open.focus();
        return open.navigate(url);
      }
      return self.clients.openWindow(url);
    }),
  );
});
