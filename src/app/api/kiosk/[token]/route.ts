import { NextResponse, type NextRequest } from 'next/server';
import { kioskRestaurant, kioskState, touchKiosk } from '@/lib/kiosk';

// Live data for the kiosk screen, polled every few seconds. The token in the URL is the only key.
export async function GET(_req: NextRequest, ctx: RouteContext<'/api/kiosk/[token]'>) {
  const { token } = await ctx.params;
  const r = await kioskRestaurant(token);
  if (!r) return NextResponse.json({ error: 'This kiosk link is no longer valid.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const [state] = await Promise.all([kioskState(r.id), touchKiosk(r.id)]);
  return NextResponse.json({ restaurant: { name: r.name, status: r.status }, ...state }, { headers: { 'Cache-Control': 'no-store' } });
}
