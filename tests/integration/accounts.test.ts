// Deleting customer and restaurant accounts from the owner console, against the local database.
import { describe, expect, it } from 'vitest';
import { deleteAccount } from '@/lib/accounts';
import { kioskRestaurant, kioskToken } from '@/lib/kiosk';
import * as orders from '@/lib/orders';
import { admin, restaurantWithOffer, signUp, supabaseAvailable, visa } from '../support/db';

const available = await supabaseAvailable();
const db = () => admin();

describe.skipIf(!available)('deleting accounts', () => {
  it('removes a customer with no history completely', async () => {
    const c = await signUp('customer');
    expect(await deleteAccount(c.id)).toMatchObject({ role: 'customer', anonymized: false });
    expect((await db().from('profiles').select('id').eq('id', c.id)).data).toEqual([]);
  });

  it('keeps a customer\'s order history but erases their details', async () => {
    const shop = await restaurantWithOffer();
    const c = await signUp('customer');
    const placed = await orders.checkout(c.id, { offerId: shop.offer.id, quantity: 1, creditCents: 0, newCard: visa });
    expect((await deleteAccount(c.id)).anonymized).toBe(true);
    const p = (await db().from('profiles').select('status, username').eq('id', c.id).single()).data!;
    expect(p.status).toBe('deleted');
    expect(p.username).toMatch(/^deleted_/);
    expect((await orders.getOrder(placed.orderId)).customer_username).toBe('Deleted user');
  });

  it('removes a restaurant with no sales or invoices completely', async () => {
    const owner = await signUp('restaurant');
    const r = (await db().from('restaurants').select('id').eq('owner_id', owner.id).single()).data!;
    await kioskToken(r.id);
    expect(await deleteAccount(owner.id)).toMatchObject({ role: 'restaurant', anonymized: false });
    expect((await db().from('restaurants').select('id').eq('id', r.id)).data).toEqual([]);
    expect((await db().from('restaurant_kiosks').select('token').eq('restaurant_id', r.id)).data).toEqual([]);
  });

  it('takes a restaurant with a subscription and open orders off the site, keeping its records', async () => {
    const shop = await restaurantWithOffer(); // has a (complimentary) paid subscription year
    const token = await kioskToken(shop.restaurant.id);
    const c = await signUp('customer');
    const placed = await orders.checkout(c.id, { offerId: shop.offer.id, quantity: 1, creditCents: 0, newCard: visa });

    expect((await deleteAccount(shop.owner.id)).anonymized).toBe(true);
    expect((await orders.getOrder(placed.orderId)).status).toBe('cancelled'); // card hold released
    const r = (await db().from('restaurants').select('status, admin_note').eq('id', shop.restaurant.id).single()).data!;
    expect(r).toEqual({ status: 'suspended', admin_note: 'Owner account deleted' });
    expect((await db().from('offers').select('status').eq('id', shop.offer.id).single()).data!.status).toBe('ended');
    expect(await kioskRestaurant(token)).toBeNull();
    expect((await db().from('subscription_payments').select('id').eq('restaurant_id', shop.restaurant.id).eq('status', 'paid')).data).toHaveLength(1);
    expect((await db().from('profiles').select('status').eq('id', shop.owner.id).single()).data!.status).toBe('deleted');
  });
});
