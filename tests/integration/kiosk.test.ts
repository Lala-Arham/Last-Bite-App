// Restaurant kiosk links, kiosk actions and onboarding emails, against the local database.
// Emails go to the local Supabase inbox (Mailpit), which the tests read.
import { describe, expect, it } from 'vitest';
import { kioskConfirmPickup, kioskLookupPickup, kioskMenu, kioskPostOffer } from '@/app/actions/kiosk';
import { kioskRestaurant, kioskToken, resetKioskToken } from '@/lib/kiosk';
import { onApproved, onEmailVerified, signedAgreement } from '@/lib/onboarding';
import * as orders from '@/lib/orders';
import { admin, anon, restaurantWithOffer, signUp, supabaseAvailable, visa } from '../support/db';

const available = await supabaseAvailable();
const db = () => admin();
const MAILPIT = 'http://127.0.0.1:54324/api/v1';

async function inbox(to: string) {
  const res = await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:${to}`)}`).catch(() => null);
  if (!res?.ok) return null;
  return ((await res.json()) as { messages: { ID: string; Subject: string; Attachments: number }[] }).messages;
}
const mailpit = available && (await inbox('nobody@example.com')) !== null;

async function waitForMail(to: string, count: number) {
  for (let i = 0; i < 20; i++) {
    const m = (await inbox(to)) ?? [];
    if (m.length >= count) return m;
    await new Promise((r) => setTimeout(r, 250));
  }
  return (await inbox(to)) ?? [];
}

describe.skipIf(!available)('kiosk', () => {
  it('gives each restaurant one secret link that the owner can reset', async () => {
    const shop = await restaurantWithOffer();
    const token = await kioskToken(shop.restaurant.id);
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await kioskToken(shop.restaurant.id)).toBe(token);
    expect((await kioskRestaurant(token))?.id).toBe(shop.restaurant.id);
    const fresh = await resetKioskToken(shop.restaurant.id);
    expect(fresh).not.toBe(token);
    expect(await kioskRestaurant(token)).toBeNull();
    expect(await kioskRestaurant('not-a-token')).toBeNull();
  });

  it('hands over orders with the PIN, like the Partner Portal', async () => {
    const shop = await restaurantWithOffer();
    const token = await kioskToken(shop.restaurant.id);
    const c = await signUp('customer');
    const placed = await orders.checkout(c.id, { offerId: shop.offer.id, quantity: 1, creditCents: 0, newCard: visa });
    const pin = (await db().from('order_pins').select('pin').eq('order_id', placed.orderId).single()).data!.pin;

    const wrong = await kioskLookupPickup(token, pin === '0000' ? '1111' : '0000');
    expect(wrong.ok).toBe(false);
    const found = await kioskLookupPickup(token, pin);
    expect(found.ok && found.data.id).toBe(placed.orderId);
    // Another restaurant's kiosk can't see it.
    const other = await kioskToken((await restaurantWithOffer()).restaurant.id);
    expect((await kioskLookupPickup(other, pin)).ok).toBe(false);

    const done = await kioskConfirmPickup(token, pin, placed.orderId);
    expect(done.ok).toBe(true);
    expect((await orders.getOrder(placed.orderId)).status).toBe('picked_up');
    expect((await kioskLookupPickup('x'.repeat(32), pin)).ok).toBe(false);
  });

  it('posts surplus food only with an active subscription', async () => {
    const shop = await restaurantWithOffer();
    const token = await kioskToken(shop.restaurant.id);
    const menu = await kioskMenu(token);
    expect(menu.ok && menu.data.map((m) => m.name)).toEqual(['Test Bowl']);
    const input = { menuItemId: shop.item.id, reason: 'end_of_day', discountPct: 40, quantity: 3, minutes: 120 };
    const posted = await kioskPostOffer(token, input);
    expect(posted.ok && posted.data).toMatchObject({ title: 'Test Bowl', priceCents: 600, quantity: 3 });

    await db().from('subscription_payments').update({ period_start: '2020-01-01T00:00:00Z', period_end: '2021-01-01T00:00:00Z' }).eq('restaurant_id', shop.restaurant.id);
    const refused = await kioskPostOffer(token, input);
    expect(!refused.ok && refused.error).toContain('subscription is not active');
  });

  it('keeps kiosk links private and kiosk functions server-only', async () => {
    const shop = await restaurantWithOffer();
    const other = await restaurantWithOffer();
    const mine = await kioskToken(shop.restaurant.id);
    await kioskToken(other.restaurant.id);
    expect((await shop.owner.client.from('restaurant_kiosks').select('token')).data).toEqual([{ token: mine }]);
    expect((await anon().from('restaurant_kiosks').select('token')).data).toEqual([]);
    expect((await shop.owner.client.from('restaurant_kiosks').update({ token: 'x'.repeat(40) }).eq('restaurant_id', shop.restaurant.id).select()).data ?? []).toHaveLength(0);
    expect((await shop.owner.client.rpc('_find_pickup', { p_restaurant_id: other.restaurant.id, p_pin: '1234' })).error).toBeTruthy();
    expect((await anon().from('restaurant_emails').select('*')).data ?? []).toEqual([]);
  });
});

describe.skipIf(!available)('restaurant onboarding', () => {
  it('builds the signed Partner Agreement', async () => {
    const shop = await restaurantWithOffer();
    const { pdf, filename } = await signedAgreement(shop.restaurant.id);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(20_000);
    expect(filename).toMatch(/^LastBite-Partner-Agreement-Test-Kitchen-.+-signed\.pdf$/);
  });

  it.skipIf(!mailpit)('emails "application pending" after verification, and the welcome pack once on approval', async () => {
    const owner = await signUp('restaurant');
    const r = (await db().from('restaurants').select('id, status').eq('owner_id', owner.id).single()).data!;
    expect(r.status).toBe('pending');
    await onEmailVerified(owner.id);
    await onEmailVerified(owner.id); // only once
    const pending = await waitForMail(owner.email, 1);
    expect(pending.map((m) => m.Subject)).toEqual([expect.stringContaining("We've received your Last Bite application")]);

    await db().from('restaurants').update({ status: 'approved' }).eq('id', r.id);
    expect(await onApproved(r.id)).toBe(true);
    expect(await onApproved(r.id)).toBe(false); // already welcomed
    const all = await waitForMail(owner.email, 2);
    const welcome = all.find((m) => m.Subject.startsWith('Welcome to Last Bite'))!;
    expect(welcome.Attachments).toBe(1);
    const body = await (await fetch(`${MAILPIT}/message/${welcome.ID}`)).json() as { HTML: string; Attachments: { FileName: string }[] };
    const token = (await db().from('restaurant_kiosks').select('token').eq('restaurant_id', r.id).single()).data!.token;
    expect(body.HTML).toContain(`/kiosk/${token}/install?device=android`);
    expect(body.HTML).toContain(`/kiosk/${token}/install?device=ipad`);
    expect(body.Attachments[0].FileName).toMatch(/-signed\.pdf$/);
    expect((await db().from('restaurants').select('approved_at').eq('id', r.id).single()).data!.approved_at).toBeTruthy();
  });
});
