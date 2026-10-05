import 'server-only';
import type { Database } from '@/lib/database.types';
import { AppError, check, maybe, must } from '@/lib/errors';
import { ensureCustomer } from '@/lib/orders';
import { payments, PaymentError } from '@/lib/payments';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Restaurant partner subscription: an annual fee plus HST, paid by card in the Partner Portal.
// Database functions (supabase/migrations/*_restaurant_subscriptions.sql) set the price and the paid
// period; this module charges the card around them. The charge stays on Last Bite's own Stripe account.

export type SubscriptionPayment = Database['public']['Tables']['subscription_payments']['Row'];

const db = () => supabaseAdmin();
const cardLabel = (c: { brand: string; last4: string }) => `${c.brand.toUpperCase()} •••• ${c.last4}`;

export type PayResult =
  | { paymentId: number; requiresAction: false; payment: SubscriptionPayment }
  | { paymentId: number; requiresAction: true; clientSecret: string };

// Charges one year. Returns requiresAction + clientSecret when the card needs 3-D Secure.
export async function paySubscription(restaurant: { id: number; name: string }, ownerId: string, token: unknown): Promise<PayResult> {
  const customerId = await ensureCustomer(ownerId);
  const card = await payments().resolvePaymentMethod({ customerId, token, save: false }); // validates before anything is recorded
  const label = cardLabel(card);
  const p = must(await db().rpc('begin_subscription_payment', { p_restaurant_id: restaurant.id }));

  let result;
  try {
    result = await payments().charge({
      amountCents: p.total_cents,
      customerId: null,
      paymentRef: card.ref,
      description: `Last Bite partner subscription (1 year): ${restaurant.name}`,
      metadata: { subscription_payment_id: String(p.id), restaurant_id: String(restaurant.id) },
      idempotencyKey: `subscription-${p.id}`,
    });
  } catch (err) {
    check(await db().from('subscription_payments').update({ status: 'failed', card_label: label }).eq('id', p.id).eq('status', 'pending'));
    if (err instanceof PaymentError) throw new AppError(402, err.message);
    throw err;
  }

  if (result.status === 'requires_action') {
    check(await db().from('subscription_payments').update({ payment_ref: result.ref, card_label: label }).eq('id', p.id));
    return { paymentId: p.id, requiresAction: true, clientSecret: result.clientSecret ?? '' };
  }
  const paid = must(await db().rpc('finish_subscription_payment', { p_id: p.id, p_payment_ref: result.ref, p_card_label: label }));
  return { paymentId: p.id, requiresAction: false, payment: paid };
}

// Called after the browser completes 3-D Secure, and by the Stripe webhook.
export async function confirmSubscriptionPayment(paymentId: number, restaurantId?: number): Promise<SubscriptionPayment> {
  let q = db().from('subscription_payments').select('*').eq('id', paymentId);
  if (restaurantId !== undefined) q = q.eq('restaurant_id', restaurantId);
  const p = maybe(await q.maybeSingle());
  if (!p) throw new AppError(404, 'Subscription payment not found.');
  if (p.status === 'paid') return p;
  if (!p.payment_ref) throw new AppError(409, 'This payment was not completed. Please try again.');
  const status = await payments().chargeStatus(p.payment_ref);
  if (status === 'succeeded') return must(await db().rpc('finish_subscription_payment', { p_id: p.id, p_payment_ref: p.payment_ref, p_card_label: p.card_label }));
  if (status === 'failed') {
    check(await db().from('subscription_payments').update({ status: 'failed' }).eq('id', p.id).eq('status', 'pending'));
    throw new AppError(402, 'Your card could not be charged.');
  }
  throw new AppError(409, 'Your bank is still confirming this payment. Please try again in a moment.');
}

export async function markSubscriptionPaymentFailed(paymentId: number) {
  check(await db().from('subscription_payments').update({ status: 'failed' }).eq('id', paymentId).eq('status', 'pending'));
}

// A complimentary year from an admin.
export async function grantYear(restaurantId: number, note: string, adminId: string) {
  return must(await db().rpc('grant_subscription_year', { p_restaurant_id: restaurantId, p_note: note, p_by: adminId }));
}
