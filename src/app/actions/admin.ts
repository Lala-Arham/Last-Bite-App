'use server';

import { z } from 'zod';
import { deleteAccount } from '@/lib/accounts';
import { log } from '@/lib/admin';
import { requireActor } from '@/lib/auth';
import { action, AppError, check, must } from '@/lib/errors';
import { money } from '@/lib/format';
import * as orders from '@/lib/orders';
import { onApproved } from '@/lib/onboarding';
import * as subscriptions from '@/lib/subscriptions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { SUSPENSION_DAYS } from '@/lib/constants';
import { dollars, int, parse } from '@/lib/validate';

// Owner console actions. Every action checks for an admin session and is written to the audit log.
const db = () => supabaseAdmin();
const note = (field: string, min = 0) => z.string().trim().min(min, `${field} must be at least ${min} characters.`).max(300, `${field} must be at most 300 characters.`);

export async function setRestaurantStatus(input: unknown) {
  return action(async () => {
    const me = await requireActor('admin');
    const d = parse(z.object({ id: z.number().int(), status: z.enum(['approved', 'suspended', 'pending']), note: note('Note').default('') }), input);
    const r = must(await db().from('restaurants').update({ status: d.status, admin_note: d.note }).eq('id', d.id).select('id, name').maybeSingle());
    await log(me.id, `restaurant.${d.status}`, 'restaurant', r.id, `${r.name}${d.note ? `: ${d.note}` : ''}`);
    // First approval: Last Bite countersigns the Partner Agreement and the welcome email goes out (once).
    const welcomed = d.status === 'approved' ? await onApproved(r.id) : false;
    return { welcomed };
  });
}

// Suspending signs the user out everywhere and blocks login (a Supabase Auth ban) for a set number of days.
// The account reactivates by itself when the time is up (the sweep job), or when an admin reactivates it.
export async function setUserStatus(input: unknown) {
  return action(async () => {
    const me = await requireActor('admin');
    const d = parse(
      z.object({ id: z.string().uuid(), status: z.enum(['active', 'suspended']), days: z.number().int().refine((n) => (SUSPENSION_DAYS as readonly number[]).includes(n), 'Choose a suspension length.').optional() }),
      input,
    );
    if (d.id === me.id) throw new AppError(400, 'You cannot suspend your own account.');
    if (d.status === 'suspended' && !d.days) throw new AppError(400, 'Choose how many days to suspend the account for.');
    const until = d.status === 'suspended' ? new Date(Date.now() + d.days! * 86_400_000).toISOString() : null;
    const u = must(await db().from('profiles').update({ status: d.status, suspended_until: until }).eq('id', d.id).neq('status', 'deleted').select('username, role').maybeSingle());
    const { error } = await db().auth.admin.updateUserById(d.id, { ban_duration: d.status === 'suspended' ? `${d.days! * 24}h` : 'none' });
    if (error) throw new AppError(500, error.message);
    await log(me.id, `user.${d.status}`, 'user', d.id, `${u.username} (${u.role})${d.days ? ` for ${d.days} days` : ''}`);
    return null;
  });
}

// Deletes an account (see deleteAccount in src/lib/accounts.ts).
export async function deleteUser(input: unknown) {
  return action(async () => {
    const me = await requireActor('admin');
    const d = parse(z.object({ id: z.string().uuid() }), input);
    if (d.id === me.id) throw new AppError(400, 'You cannot delete your own account.');
    const res = await deleteAccount(d.id);
    await log(me.id, 'user.delete', 'user', d.id, `${res.username} (${res.role}): ${res.anonymized ? 'personal details erased, order history kept' : 'removed completely'}`);
    return { anonymized: res.anonymized };
  });
}

// Goodwill platform credit, funded by Last Bite.
export async function issueCredit(input: unknown) {
  return action(async () => {
    const me = await requireActor('admin');
    const d = parse(z.object({ userId: z.string().uuid(), amount: dollars('Credit amount', 0.01, 1000), reason: note('Reason', 3) }), input);
    const balance = must(await db().rpc('issue_credit', { p_user: d.userId, p_amount_cents: d.amount, p_note: d.reason, p_by: me.id }));
    const u = must(await db().from('profiles').select('username').eq('id', d.userId).single());
    await log(me.id, 'credit.issue', 'user', d.userId, `${u.username}: ${money(d.amount)} - ${d.reason}`);
    return { balanceCents: balance };
  });
}

export async function adminCancelOrder(input: unknown) {
  return action(async () => {
    const me = await requireActor('admin');
    const d = parse(z.object({ id: int('Order', 1, Number.MAX_SAFE_INTEGER), reason: note('Reason').default('') }), input);
    const o = await orders.getOrder(d.id);
    if (o.status !== 'reserved' && o.status !== 'pending_payment') throw new AppError(409, 'Only orders awaiting pickup can be cancelled.');
    await orders.release(o.id, o.status, 'cancelled', true);
    await log(me.id, 'order.cancel', 'order', o.id, d.reason);
    return null;
  });
}

// Refund by percentage of what's left or by amount, to the original payment or as platform credit.
export async function refundOrder(input: unknown) {
  return action(async () => {
    const me = await requireActor('admin');
    const d = parse(
      z.object({
        id: int('Order', 1, Number.MAX_SAFE_INTEGER),
        percent: int('Percentage', 1, 100).optional(),
        amount: z.union([z.string(), z.number()]).optional(),
        method: z.enum(['original', 'credit']),
        reason: note('Reason', 3),
      }),
      input,
    );
    const o = await orders.getOrder(d.id);
    const refundable = o.total_cents - o.refunded_cents - o.credited_cents;
    const amountCents = d.percent !== undefined
      ? Math.max(1, Math.round((refundable * d.percent) / 100))
      : parse(dollars('Refund amount', 0.01, refundable / 100), d.amount ?? '');
    const res = await orders.refundOrder(d.id, { amountCents, method: d.method, reason: d.reason, adminId: me.id });
    await log(
      me.id, d.method === 'credit' ? 'order.refund_credit' : 'order.refund', 'order', d.id,
      `${money(amountCents)} to ${d.method === 'credit' ? 'platform credit' : [res.cardCents && `card ${money(res.cardCents)}`, res.creditCents && `credit ${money(res.creditCents)}`].filter(Boolean).join(' + ')} - ${d.reason}`,
    );
    return { amountCents };
  });
}

export async function endOffer(input: unknown) {
  return action(async () => {
    const me = await requireActor('admin');
    const d = parse(z.object({ id: z.number().int(), reason: note('Reason').default('') }), input);
    const o = must(await db().from('offers').update({ status: 'ended' }).eq('id', d.id).select('id, title, restaurants(name)').maybeSingle());
    await log(me.id, 'offer.remove', 'offer', o.id, `${o.title} (${o.restaurants?.name ?? ''})${d.reason ? `: ${d.reason}` : ''}`);
    return null;
  });
}

// Pays a restaurant its balance through Stripe Connect, or records a payout made outside Stripe.
// Invoice numbers and transaction details are assigned by the system and can't be edited.
export async function payRestaurant(input: unknown) {
  return action(async () => {
    const me = await requireActor('admin');
    const d = parse(z.object({ restaurantId: z.number().int(), amount: dollars('Amount', 0.01, 1_000_000), note: note('Note').default(''), manual: z.boolean() }), input);
    const r = must(await db().from('restaurants').select('name').eq('id', d.restaurantId).maybeSingle());
    const p = await orders.payRestaurant(d.restaurantId, d.amount, me.id, d.note, d.manual);
    await log(me.id, d.manual ? 'payout.record' : 'payout.transfer', 'restaurant', d.restaurantId, `${r.name}: ${money(d.amount)} (${p.invoice_number}, ${p.transaction_id})`);
    return { invoiceNumber: p.invoice_number, transactionId: p.transaction_id, bankDetails: p.bank_details };
  });
}

// A complimentary subscription year (no charge), added after any year already paid.
export async function grantSubscriptionYear(input: unknown) {
  return action(async () => {
    const me = await requireActor('admin');
    const d = parse(z.object({ restaurantId: z.number().int(), note: note('Reason', 3) }), input);
    const p = await subscriptions.grantYear(d.restaurantId, d.note, me.id);
    const r = must(await db().from('restaurants').select('name').eq('id', d.restaurantId).single());
    await log(me.id, 'subscription.grant', 'restaurant', d.restaurantId, `${r.name}: complimentary year to ${p.period_end?.slice(0, 10)} (${p.invoice_number}) - ${d.note}`);
    return { paidThrough: p.period_end };
  });
}

export async function updateSettings(input: unknown) {
  return action(async () => {
    const me = await requireActor('admin');
    const d = parse(
      z.object({
        serviceFeePct: z.coerce.number().min(0, 'Service fee must be 0% to 30%.').max(30, 'Service fee must be 0% to 30%.'),
        defaultTaxRatePct: z.coerce.number().min(0, 'HST must be 0% to 20%.').max(20, 'HST must be 0% to 20%.'),
        requireRestaurantApproval: z.boolean(),
        subscriptionFee: z.coerce.number().min(0, 'Subscription fee must be $0 to $10,000.').max(10_000, 'Subscription fee must be $0 to $10,000.'),
        requireSubscription: z.boolean(),
      }),
      input,
    );
    const values = {
      service_fee_bps: Math.round(d.serviceFeePct * 100),
      default_tax_rate_bps: Math.round(d.defaultTaxRatePct * 100),
      require_restaurant_approval: d.requireRestaurantApproval,
      subscription_fee_cents: Math.round(d.subscriptionFee * 100),
      require_subscription: d.requireSubscription,
    };
    const current = new Map(must(await db().from('settings').select('key, value')).map((r) => [r.key, r.value]));
    const changed = Object.entries(values).filter(([k, v]) => current.get(k) !== v);
    for (const [key, value] of changed) {
      check(await db().from('settings').upsert({ key, value, updated_at: new Date().toISOString() }));
    }
    if (changed.length) await log(me.id, 'settings.update', 'settings', null, changed.map(([k, v]) => `${k}=${v}`).join(', '));
    return { changed: changed.map(([k]) => k) };
  });
}
