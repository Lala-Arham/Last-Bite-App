// Restaurant partner subscription (mock payment processor), against the local database.
import { describe, expect, it } from 'vitest';
import * as subscriptions from '@/lib/subscriptions';
import { admin, restaurantWithOffer, signUp, supabaseAvailable, visa } from '../support/db';

const available = await supabaseAvailable();
const db = () => admin();
const DAY = 86_400_000;
const declined = { brand: 'visa', last4: '0002', expMonth: 12, expYear: 2030 };

// An approved restaurant with a menu item and no subscription.
async function newRestaurant() {
  const owner = await signUp('restaurant');
  const r = (await db().from('restaurants').select('*').eq('owner_id', owner.id).single()).data!;
  await db().from('restaurants').update({ status: 'approved' }).eq('id', r.id);
  const item = (await owner.client.from('menu_items').insert({ restaurant_id: r.id, name: 'Test Bowl', price_cents: 1000 }).select('*').single()).data!;
  const post = () =>
    owner.client.rpc('restaurant_save_offer', {
      p_offer_id: null as unknown as number, p_menu_item_id: item.id, p_reason: 'end_of_day', p_description: '',
      p_discount_pct: 50, p_quantity: 2, p_expires_in_minutes: 60,
    });
  return { owner, restaurant: r, post };
}

const paidRows = async (restaurantId: number) =>
  (await db().from('subscription_payments').select('*').eq('restaurant_id', restaurantId).eq('status', 'paid').order('period_end')).data!;

describe.skipIf(!available)('partner subscription', () => {
  it('needs an active subscription to post offers', async () => {
    const shop = await newRestaurant();
    const before = await shop.post();
    expect(before.error?.message).toContain('subscription is not active');
    const status = (await shop.owner.client.rpc('my_subscription')).data as Record<string, unknown>;
    expect(status).toMatchObject({ active: false, required: true, canRenew: true, feeCents: 10000, taxRateBps: 1500, taxCents: 1500, totalCents: 11500, paidThrough: null });

    const res = await subscriptions.paySubscription(shop.restaurant, shop.owner.id, visa.token);
    expect(res.requiresAction).toBe(false);
    const [p] = await paidRows(shop.restaurant.id);
    expect(p).toMatchObject({ kind: 'card', fee_cents: 10000, tax_cents: 1500, total_cents: 11500, card_label: 'VISA •••• 4242' });
    expect(p.invoice_number).toMatch(/^SUB-\d{8}-\d{6}$/);
    expect(p.payment_ref).toMatch(/^pi_mock_/);
    const days = (Date.parse(p.period_end!) - Date.parse(p.period_start!)) / DAY;
    expect(days).toBeGreaterThanOrEqual(365);
    expect(days).toBeLessThanOrEqual(366);
    expect((await shop.post()).error).toBeNull();
  });

  it('records declined cards as failed and stays inactive', async () => {
    const shop = await newRestaurant();
    await expect(subscriptions.paySubscription(shop.restaurant, shop.owner.id, declined)).rejects.toThrow('declined');
    const rows = (await db().from('subscription_payments').select('status').eq('restaurant_id', shop.restaurant.id)).data!;
    expect(rows.map((r) => r.status)).toEqual(['failed']);
    expect((await shop.post()).error?.message).toContain('subscription is not active');
  });

  it('only renews within 60 days of the end, and adds the new year after the current one', async () => {
    const shop = await newRestaurant();
    await subscriptions.paySubscription(shop.restaurant, shop.owner.id, visa.token);
    await expect(subscriptions.paySubscription(shop.restaurant, shop.owner.id, visa.token)).rejects.toThrow('You can renew from 60 days before');

    // Move the paid year so it ends in 20 days, then renew early.
    const [first] = await paidRows(shop.restaurant.id);
    const end = new Date(Date.now() + 20 * DAY).toISOString();
    await db().from('subscription_payments').update({ period_start: new Date(Date.now() - 345 * DAY).toISOString(), period_end: end }).eq('id', first.id);
    const status = (await shop.owner.client.rpc('my_subscription')).data as Record<string, unknown>;
    expect(status).toMatchObject({ active: true, endsSoon: true, canRenew: true });
    await subscriptions.paySubscription(shop.restaurant, shop.owner.id, visa.token);
    const [, second] = await paidRows(shop.restaurant.id);
    expect(Date.parse(second.period_start!)).toBe(Date.parse(end));
  });

  it('stops new and resumed offers when the subscription ends, but keeps live ones', async () => {
    const shop = await restaurantWithOffer();
    await shop.owner.client.rpc('restaurant_set_offer_status', { p_offer_id: shop.offer.id, p_status: 'paused' });
    await db().from('subscription_payments').update({ period_start: new Date(Date.now() - 400 * DAY).toISOString(), period_end: new Date(Date.now() - DAY).toISOString() })
      .eq('restaurant_id', shop.restaurant.id);
    const resumed = await shop.owner.client.rpc('restaurant_set_offer_status', { p_offer_id: shop.offer.id, p_status: 'active' });
    expect(resumed.error?.message).toContain('subscription is not active');
    // Editing an existing offer (e.g. extending its timer) is still allowed.
    const live = await restaurantWithOffer();
    await db().from('subscription_payments').update({ period_start: new Date(Date.now() - 400 * DAY).toISOString(), period_end: new Date(Date.now() - DAY).toISOString() })
      .eq('restaurant_id', live.restaurant.id);
    expect((await live.owner.client.rpc('restaurant_extend_offer', { p_offer_id: live.offer.id, p_minutes: 30 })).error).toBeNull();
  });

  it('lets admins grant a complimentary year', async () => {
    const shop = await newRestaurant();
    const p = await subscriptions.grantYear(shop.restaurant.id, 'Launch partner', (await signUp('customer')).id);
    expect(p).toMatchObject({ kind: 'complimentary', status: 'paid', total_cents: 0, note: 'Launch partner' });
    expect((await shop.post()).error).toBeNull();
  });

  it('does not block offers when subscriptions are turned off', async () => {
    const shop = await newRestaurant();
    await db().from('settings').update({ value: false }).eq('key', 'require_subscription');
    try {
      expect((await shop.post()).error).toBeNull();
    } finally {
      await db().from('settings').update({ value: true }).eq('key', 'require_subscription');
    }
  });

  it('keeps subscription payments private and server-written', async () => {
    const shop = await restaurantWithOffer();
    const other = await restaurantWithOffer();
    const mine = await shop.owner.client.from('subscription_payments').select('id, restaurant_id');
    expect(mine.data!.length).toBeGreaterThan(0);
    expect(mine.data!.every((r) => r.restaurant_id === shop.restaurant.id)).toBe(true);
    expect((await shop.owner.client.from('subscription_payments').select('id').eq('restaurant_id', other.restaurant.id)).data).toHaveLength(0);

    const forged = await shop.owner.client.from('subscription_payments').insert({
      restaurant_id: shop.restaurant.id, fee_cents: 0, tax_rate_bps: 0, tax_cents: 0, total_cents: 0,
    });
    expect(forged.error).toBeTruthy();
    const extended = await shop.owner.client.from('subscription_payments').update({ period_end: '2099-01-01T00:00:00Z' }).eq('restaurant_id', shop.restaurant.id).select('id');
    expect(extended.data ?? []).toHaveLength(0);
    for (const fn of ['begin_subscription_payment', 'grant_subscription_year', 'finish_subscription_payment'] as const) {
      const args = fn === 'begin_subscription_payment' ? { p_restaurant_id: shop.restaurant.id }
        : fn === 'grant_subscription_year' ? { p_restaurant_id: shop.restaurant.id, p_note: 'x', p_by: shop.owner.id }
          : { p_id: 1, p_payment_ref: 'x', p_card_label: 'x' };
      expect((await shop.owner.client.rpc(fn, args as never)).error).toBeTruthy();
    }
  });
});
