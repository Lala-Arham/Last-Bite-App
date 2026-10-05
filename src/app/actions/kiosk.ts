'use server';

import { z } from 'zod';
import { OFFER_REASONS, type OfferReason } from '@/lib/constants';
import { action, AppError, must } from '@/lib/errors';
import { requireKiosk } from '@/lib/kiosk';
import * as orders from '@/lib/orders';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { parse } from '@/lib/validate';
import type { PickupOrder } from './restaurant';

// Actions for the restaurant kiosk (/kiosk/<token>). There is no login: every action checks the
// kiosk token and then acts for that restaurant only.

const db = () => supabaseAdmin();
const pinSchema = z.string().trim().regex(/^\d{4}$/, 'Enter the 4-digit PIN.');

export async function kioskLookupPickup(token: string, pin: string) {
  return action(async () => {
    const r = await requireKiosk(token);
    const order = must(await db().rpc('_find_pickup', { p_restaurant_id: r.id, p_pin: parse(pinSchema, pin) }));
    if (!order) throw new AppError(404, 'No order awaiting pickup matches that PIN.');
    return order as unknown as PickupOrder;
  });
}

// Hands over the food: the customer's card is charged now and the restaurant is paid.
export async function kioskConfirmPickup(token: string, pin: string, orderId: number) {
  return action(async () => {
    const r = await requireKiosk(token);
    const claimed = must(await db().rpc('_begin_pickup', { p_restaurant_id: r.id, p_pin: parse(pinSchema, pin), p_order_id: orderId })) as unknown as {
      id: number; paymentRef: string | null; destinationAccount: string | null;
    };
    const done = await orders.completePickup(claimed);
    return { quantity: done.quantity, itemTitle: done.item_title, customerUsername: done.customer_username, totalCents: done.total_cents };
  });
}

export type KioskMenuItem = { id: number; name: string; priceCents: number; imageUrl: string | null };

export async function kioskMenu(token: string) {
  return action(async () => {
    const r = await requireKiosk(token);
    const items = must(await db().from('menu_items').select('id, name, price_cents, image_url').eq('restaurant_id', r.id).eq('active', true).order('name'));
    return items.map((m): KioskMenuItem => ({ id: m.id, name: m.name, priceCents: m.price_cents, imageUrl: m.image_url }));
  });
}

const offerInput = z.object({
  menuItemId: z.number().int().positive(),
  reason: z.enum(Object.keys(OFFER_REASONS) as [OfferReason, ...OfferReason[]], { message: 'Please choose why this food is available.' }),
  discountPct: z.number().int().min(1, 'Discount must be 1% to 90%.').max(90, 'Discount must be 1% to 90%.'),
  quantity: z.number().int().min(1, 'Quantity must be 1 to 500.').max(500, 'Quantity must be 1 to 500.'),
  minutes: z.number().int().min(5).max(4320),
});

// Posts surplus food from a menu item. Needs an active subscription, like the Partner Portal.
export async function kioskPostOffer(token: string, input: unknown) {
  return action(async () => {
    const r = await requireKiosk(token, { forPosting: true });
    const d = parse(offerInput, input);
    const offer = must(
      await db().rpc('_save_offer', {
        p_restaurant_id: r.id, p_offer_id: null as unknown as number, p_menu_item_id: d.menuItemId, p_reason: d.reason,
        p_description: '', p_discount_pct: d.discountPct, p_quantity: d.quantity, p_expires_in_minutes: d.minutes,
      }),
    );
    return { id: offer.id, title: offer.title, priceCents: offer.price_cents ?? 0, quantity: offer.quantity_total };
  });
}
