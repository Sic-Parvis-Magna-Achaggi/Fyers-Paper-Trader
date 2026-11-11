/* Notifications for alerts (v0.38.0): the browser's push service wakes this service worker with an encrypted message from
   the server (helper/webpush.py), even with every page of the app closed and the phone locked; it shows the
   notification. A tap opens (or focuses) the app on the Alerts page. Served at /sw.js so it covers the whole site.
   It caches nothing: the app always loads fresh from the server. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'Alert', body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) c.postMessage({ push: d });          // (open pages: the test kit reads this)
    await self.registration.showNotification(d.title || '🔔 Alert', {
      body: d.body || '',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      icon: '/static/icons/icon-192.png',
      badge: '/static/icons/badge-72.png',
      timestamp: d.t ? Math.round(d.t * 1000) : Date.now(),
      data: { url: d.url || '/#alerts' },
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/#alerts';
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (new URL(c.url).origin !== self.location.origin) continue;
      try { await c.navigate(url); } catch (_) {}
      return c.focus();
    }
    return self.clients.openWindow(url);
  })());
});

/* the push service renewed this browser's subscription: tell the server the new one */
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    const old = e.oldSubscription && e.oldSubscription.options;
    const sub = e.newSubscription || (old ? await self.registration.pushManager.subscribe(old) : null);
    if (!sub) return;
    await fetch('/api/push/subscribe', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub: sub.toJSON(), name: 'renewed' }) });
  })());
});
