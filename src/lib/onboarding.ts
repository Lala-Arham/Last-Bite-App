import 'server-only';
import { createHash } from 'node:crypto';
import { serverEnv } from '@/lib/env';
import { maybe, must } from '@/lib/errors';
import { sendEmail } from '@/lib/email/send';
import { pendingEmail, welcomeEmail } from '@/lib/email/templates';
import { kioskInstallUrl, kioskToken, kioskUrl } from '@/lib/kiosk';
import { legalDocument } from '@/lib/legal/company';
import { signedAgreementPdf } from '@/lib/receipts/pdf';
import { formatDateTime } from '@/lib/receipts/time';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Restaurant onboarding emails:
//   1. "Confirm your email": sent by Supabase Auth at sign-up (supabase/templates/confirmation.html).
//   2. "Application pending": once the owner has verified their email, while the restaurant waits for approval.
//   3. "Welcome": when Last Bite approves the restaurant, with the signed Partner Agreement (PDF),
//      the kiosk link and buttons to put the kiosk on an Android tablet or iPad.
// Each automatic email goes out once (restaurant_emails).

const db = () => supabaseAdmin();
const tz = () => serverEnv.timeZone;

async function restaurantInfo(restaurantId: number) {
  const r = must(await db().from('restaurants').select('*').eq('id', restaurantId).single());
  const owner = must(await db().from('profiles').select('id, username, email').eq('id', r.owner_id).single());
  return { r, owner };
}

// The Partner Agreement with the owner's acceptance record and Last Bite's countersignature.
export async function signedAgreement(restaurantId: number) {
  const { r, owner } = await restaurantInfo(restaurantId);
  const doc = (await legalDocument('restaurant-agreement'))!;
  const accepted = maybe(
    await db().from('terms_acceptances').select('version, accepted_at, ip, user_agent').eq('user_id', owner.id).eq('document', 'restaurant-agreement')
      .order('accepted_at', { ascending: false }).limit(1).maybeSingle(),
  );
  const pdf = await signedAgreementPdf({
    title: doc.title,
    version: doc.version,
    effective: doc.effective,
    html: doc.html,
    fingerprint: createHash('sha256').update(doc.html).digest('hex'),
    restaurant: { name: r.name, address: r.address, city: r.city, zip: r.zip },
    signer: { username: owner.username, email: owner.email },
    acceptance: accepted && {
      atText: formatDateTime(accepted.accepted_at, tz()), version: accepted.version, ip: accepted.ip || 'not recorded', userAgent: accepted.user_agent || 'not recorded',
    },
    countersign: { entity: serverEnv.legal.entity, atText: r.approved_at ? formatDateTime(r.approved_at, tz()) : null },
    generatedText: formatDateTime(new Date().toISOString(), tz()),
  });
  return { pdf, filename: `LastBite-Partner-Agreement-${r.name.replace(/[^A-Za-z0-9]+/g, '-')}-signed.pdf` };
}

// Claims the email so it's only sent once; gives the claim back if sending fails, so it can be retried.
async function once(restaurantId: number, kind: 'pending' | 'welcome', send: () => Promise<boolean>) {
  const { data } = await db().from('restaurant_emails').upsert({ restaurant_id: restaurantId, kind }, { onConflict: 'restaurant_id,kind', ignoreDuplicates: true }).select('kind');
  if (!data?.length) return false; // already sent
  const sent = await send();
  if (!sent) await db().from('restaurant_emails').delete().eq('restaurant_id', restaurantId).eq('kind', kind);
  return sent;
}

export async function sendPendingEmail(restaurantId: number) {
  return once(restaurantId, 'pending', async () => {
    const { r, owner } = await restaurantInfo(restaurantId);
    return sendEmail({ to: owner.email, ...pendingEmail({ username: owner.username, email: owner.email, restaurant: r.name }) });
  });
}

async function deliverWelcome(restaurantId: number) {
  const { r, owner } = await restaurantInfo(restaurantId);
  const token = await kioskToken(restaurantId);
  const [agreement, sub, acct] = await Promise.all([
    signedAgreement(restaurantId),
    db().rpc('subscription_paid_through', { p_restaurant_id: restaurantId }),
    db().from('restaurant_payment_accounts').select('charges_enabled').eq('restaurant_id', restaurantId).maybeSingle(),
  ]);
  const email = welcomeEmail({
    username: owner.username, email: owner.email, restaurant: r.name,
    kioskUrl: kioskUrl(token), androidUrl: kioskInstallUrl(token, 'android'), ipadUrl: kioskInstallUrl(token, 'ipad'),
    subscriptionActive: !!sub.data && Date.parse(sub.data) > Date.now(),
    payoutsReady: !!acct.data?.charges_enabled,
  });
  return sendEmail({ to: owner.email, ...email, attachments: [{ filename: agreement.filename, content: agreement.pdf, contentType: 'application/pdf' }] });
}

// First approval sends the welcome email once; `again` re-sends it (owner's request from the portal).
export async function sendWelcomeEmail(restaurantId: number, { again = false } = {}) {
  return again ? deliverWelcome(restaurantId) : once(restaurantId, 'welcome', () => deliverWelcome(restaurantId));
}

// After the owner verifies their email address (or at sign-up, when email confirmation is off).
export async function onEmailVerified(userId: string) {
  try {
    const r = maybe(await db().from('restaurants').select('id, status').eq('owner_id', userId).maybeSingle());
    if (!r) return;
    if (r.status === 'pending') await sendPendingEmail(r.id);
    else if (r.status === 'approved') await onApproved(r.id); // approval not required: approved at sign-up
  } catch (err) {
    console.error('onboarding email:', err);
  }
}

// When an admin approves a restaurant: records the first approval (Last Bite's countersignature)
// and sends the welcome email the first time.
export async function onApproved(restaurantId: number) {
  await db().from('restaurants').update({ approved_at: new Date().toISOString() }).eq('id', restaurantId).is('approved_at', null);
  try {
    return await sendWelcomeEmail(restaurantId);
  } catch (err) {
    console.error('welcome email:', err);
    return false;
  }
}
