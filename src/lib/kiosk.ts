import 'server-only';
import { randomBytes } from 'node:crypto';
import { publicEnv, serverEnv } from '@/lib/env';
import { AppError, check, maybe, must } from '@/lib/errors';
import { dayRange, todayIn } from '@/lib/receipts/time';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Restaurant kiosk: a counter tablet that opens /kiosk/<token> without signing in. The token is a
// secret like a password (192 random bits); anyone with the link can verify pickups and post surplus
// food for that restaurant, but can't see payouts, settings or customer details beyond the order.
// Owners reset the link from the Partner Portal, which logs out every tablet using the old one.

const db = () => supabaseAdmin();
const newToken = () => randomBytes(24).toString('base64url');

export const kioskUrl = (token: string) => `${publicEnv.siteUrl}/kiosk/${token}`;
export const kioskInstallUrl = (token: string, device?: 'android' | 'ipad') =>
  `${kioskUrl(token)}/install${device ? `?device=${device}` : ''}`;

// The restaurant's kiosk token, created the first time it's needed.
export async function kioskToken(restaurantId: number): Promise<string> {
  const row = maybe(await db().from('restaurant_kiosks').select('token').eq('restaurant_id', restaurantId).maybeSingle());
  if (row) return row.token;
  const { data, error } = await db().from('restaurant_kiosks').insert({ restaurant_id: restaurantId, token: newToken() }).select('token').single();
  if (data) return data.token;
  // Created at the same moment by another request.
  if (error?.code === '23505') return must(await db().from('restaurant_kiosks').select('token').eq('restaurant_id', restaurantId).single()).token;
  throw new AppError(500, error?.message ?? 'Could not create the kiosk link.');
}

export async function resetKioskToken(restaurantId: number): Promise<string> {
  const token = newToken();
  check(await db().from('restaurant_kiosks').upsert({ restaurant_id: restaurantId, token, created_at: new Date().toISOString(), last_seen_at: null }));
  return token;
}

export type KioskRestaurant = { id: number; name: string; status: 'pending' | 'approved' | 'suspended'; address: string; city: string };

// The restaurant a kiosk token belongs to, or null.
export async function kioskRestaurant(token: string): Promise<KioskRestaurant | null> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,64}$/.test(token)) return null;
  const row = maybe(
    await db().from('restaurant_kiosks').select('restaurant_id, restaurants(id, name, status, address, city)').eq('token', token).maybeSingle(),
  );
  return row?.restaurants ?? null;
}

// Like kioskRestaurant, but for actions: throws when the link is wrong or the restaurant can't use it.
export async function requireKiosk(token: string, { forPosting = false } = {}): Promise<KioskRestaurant> {
  const r = await kioskRestaurant(token);
  if (!r) throw new AppError(404, 'This kiosk link is no longer valid. Ask the restaurant owner for the new link.');
  if (forPosting && r.status === 'suspended') throw new AppError(403, 'Your restaurant is suspended. Please contact Last Bite support.');
  return r;
}

export async function touchKiosk(restaurantId: number) {
  await db().from('restaurant_kiosks').update({ last_seen_at: new Date().toISOString() }).eq('restaurant_id', restaurantId);
}

export type KioskOrder = {
  id: number; itemTitle: string; imageUrl: string | null; quantity: number; customerUsername: string;
  totalCents: number; createdAt: string; pickupEnd: string;
};

// What the kiosk screen shows: orders waiting for pickup and today's numbers (Newfoundland Time).
export async function kioskState(restaurantId: number) {
  const today = dayRange(todayIn(serverEnv.timeZone), serverEnv.timeZone);
  const [orders, stats, sub] = await Promise.all([
    db().from('orders').select('id, item_title, image_url, quantity, customer_username, total_cents, created_at, pickup_end')
      .eq('restaurant_id', restaurantId).eq('status', 'reserved').order('pickup_end').limit(100),
    db().from('orders').select('quantity, subtotal_cents').eq('restaurant_id', restaurantId).eq('status', 'picked_up')
      .gte('picked_up_at', today.start).lt('picked_up_at', today.end),
    db().rpc('subscription_active', { p_restaurant_id: restaurantId }),
  ]);
  return {
    orders: must(orders).map((o): KioskOrder => ({
      id: o.id, itemTitle: o.item_title, imageUrl: o.image_url, quantity: o.quantity, customerUsername: o.customer_username,
      totalCents: o.total_cents, createdAt: o.created_at, pickupEnd: o.pickup_end,
    })),
    today: must(stats).reduce((n, o) => ({ meals: n.meals + o.quantity, salesCents: n.salesCents + o.subtotal_cents }), { meals: 0, salesCents: 0 }),
    canPost: !!sub.data,
  };
}
