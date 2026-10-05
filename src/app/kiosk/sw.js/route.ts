// Service worker for installed kiosks (scope /kiosk/). Pages and data always come from the network
// (orders must be live); when the tablet is offline it shows a short "reconnecting" page instead of
// the browser's error screen.
const SW = `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(() => new Response(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="10">'
      + '<body style="margin:0;display:grid;place-items:center;height:100vh;background:#121316;color:#f4f4f5;font:600 22px system-ui;text-align:center">'
      + '<div>📡<br>No internet connection.<br><span style="color:#8b8d98;font-size:16px">The kiosk reconnects automatically.</span></div>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )),
  );
});
`;

export function GET() {
  return new Response(SW, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' } });
}
