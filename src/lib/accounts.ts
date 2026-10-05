import 'server-only';
import { AppError, check, must } from '@/lib/errors';
import * as orders from '@/lib/orders';
import { supabaseAdmin } from '@/lib/supabase/admin';

const db = () => supabaseAdmin();

// Deletes an account. One with no orders, payments or credit is removed completely. One with history
// can't be removed without losing sales and tax records, so it is closed for good instead: login is
// blocked, and the name, email and saved cards are erased (past orders say "Deleted user").
// Deleting a restaurant owner also takes the restaurant down: orders waiting for pickup are cancelled
// (card holds released), its kiosk link stops working, and a restaurant that paid for a subscription
// is closed rather than removed, so its invoices are kept.
export async function deleteAccount(userId: string): Promise<{ username: string; role: string; anonymized: boolean }> {
  const u = must(await db().from('profiles').select('username, role').eq('id', userId).neq('status', 'deleted').maybeSingle());
  if (!u) throw new AppError(404, 'Account not found.');

  let keepRecords = false;
  if (u.role === 'restaurant') {
    const shops = must(await db().from('restaurants').select('id').eq('owner_id', userId));
    for (const { id } of shops) {
      const open = must(await db().from('orders').select('id, status').eq('restaurant_id', id).in('status', ['pending_payment', 'reserved']));
      for (const o of open) await orders.release(o.id, o.status, 'cancelled', true);
      const paid = must(await db().from('subscription_payments').select('id').eq('restaurant_id', id).eq('status', 'paid').limit(1));
      if (paid.length) keepRecords = true;
    }
  }

  const removed = keepRecords ? { error: true } : await db().auth.admin.deleteUser(userId);
  if (!removed.error) return { ...u, anonymized: false };

  // Kept for its records: anonymize.
  const tag = `deleted_${userId.slice(0, 8)}`;
  const closed = await db().auth.admin.updateUserById(userId, {
    email: `${tag}@deleted.invalid`, email_confirm: true, password: crypto.randomUUID() + crypto.randomUUID(),
    user_metadata: {}, ban_duration: '876000h',
  });
  if (closed.error) throw new AppError(500, closed.error.message);
  must(await db().from('profiles').update({ username: tag, email: `${tag}@deleted.invalid`, status: 'deleted', suspended_until: null, stripe_customer_id: null }).eq('id', userId).select('id'));
  must(await db().from('payment_methods').delete().eq('user_id', userId).select('id'));
  must(await db().from('orders').update({ customer_username: 'Deleted user' }).eq('user_id', userId).select('id'));
  if (u.role === 'restaurant') {
    const r = must(await db().from('restaurants').update({ status: 'suspended', admin_note: 'Owner account deleted' }).eq('owner_id', userId).select('id'));
    for (const { id } of r) {
      must(await db().from('offers').update({ status: 'ended' }).eq('restaurant_id', id).neq('status', 'ended').select('id'));
      check(await db().from('restaurant_kiosks').delete().eq('restaurant_id', id));
    }
  }
  return { ...u, anonymized: true };
}
