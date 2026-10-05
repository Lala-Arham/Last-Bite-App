import { NextResponse, type NextRequest } from 'next/server';
import { kioskRestaurant } from '@/lib/kiosk';

// Web app manifest for one restaurant's kiosk, so Android (Chrome) can install it on the home screen
// as its own app that opens straight into this restaurant's kiosk.
export async function GET(_req: NextRequest, ctx: RouteContext<'/kiosk/[token]/manifest.webmanifest'>) {
  const { token } = await ctx.params;
  const r = await kioskRestaurant(token);
  if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const start = `/kiosk/${token}`;
  return NextResponse.json(
    {
      id: start,
      name: `${r.name} · Last Bite Kiosk`,
      short_name: r.name.length > 12 ? 'LB Kiosk' : r.name,
      description: `Last Bite counter kiosk for ${r.name}: verify pickup PINs and hear new orders.`,
      start_url: start,
      scope: `${start}`,
      display: 'fullscreen',
      display_override: ['fullscreen', 'standalone'],
      orientation: 'any',
      background_color: '#121316',
      theme_color: '#121316',
      icons: [
        { src: '/assets/kiosk-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/assets/kiosk-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/assets/kiosk-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-store' } },
  );
}
