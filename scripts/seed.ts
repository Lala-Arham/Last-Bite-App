// Populates Supabase with demo accounts, menus, live offers and two weeks of order history around
// St. John's, Newfoundland and Labrador. Usage: npm run seed   (run `npm run db:reset` first for a clean database).
// Existing demo accounts are reused; each run posts a fresh set of live offers.
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/database.types';
import { DOCUMENTS, REQUIRED } from '../src/lib/legal/documents';
import { quote } from '../src/lib/pricing';

config({ path: '.env.local' });
config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (see .env.example).');
const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const DEMO_PASSWORD = 'LastBite123';
type Reason = Database['public']['Enums']['offer_reason'];

// Downtown St. John's demo restaurants. Logins are <user>@lastbite.test (never real inboxes); phone numbers
// and addresses are the restaurants' public listings. Postal codes use the right area (A1C etc.) with a
// placeholder ending: replace them with each restaurant's real code before going live.
const RESTAURANTS = [
  { user: 'no4', name: 'No. 4 Restaurant & Bar', cuisine: 'American', address: '4 Cathedral St', city: "St. John's", zip: 'A1C 3N2', phone: '(709) 753-6600', lat: 47.5641, lng: -52.7071, tax: 1500 },
  { user: 'merchanttavern', name: 'The Merchant Tavern', cuisine: 'Pub', address: '291 Water St', city: "St. John's", zip: 'A1C 1B9', phone: '(709) 722-5050', lat: 47.5623, lng: -52.7094, tax: 1500 },
  { user: 'blueonwater', name: 'Blue on Water', cuisine: 'American', address: '319 Water St', city: "St. John's", zip: 'A1C 1B9', phone: '(709) 754-2583', lat: 47.5628, lng: -52.7087, tax: 1500 },
  { user: 'yellowbelly', name: 'YellowBelly Brewery', cuisine: 'Pub', address: '288 Water St', city: "St. John's", zip: 'A1C 1B7', phone: '(709) 757-3784', lat: 47.5620, lng: -52.7100, tax: 1500 },
  { user: 'olivers', name: "Oliver's Restaurant", cuisine: 'Italian', address: '160 Water St', city: "St. John's", zip: 'A1C 1A9', phone: '(709) 754-6444', lat: 47.5607, lng: -52.7125, tax: 1500 },
  { user: 'blackcat', name: 'Black Cat Pizzeria', cuisine: 'Pizza', address: '13 LeMarchant Rd', city: "St. John's", zip: 'A1C 2G3', phone: '(709) 687-0709', lat: 47.5584, lng: -52.7168, tax: 1500 },
  { user: 'rocket', name: 'Rocket Bakery & Fresh Food', cuisine: 'Bakery', address: '294 Water St', city: "St. John's", zip: 'A1C 1B7', phone: '(709) 700-1336', lat: 47.5622, lng: -52.7097, tax: 1500 },
  { user: 'chinched', name: 'Chinched Restaurant', cuisine: 'Charcuterie', address: '5 Bates Hill', city: "St. John's", zip: 'A1C 4B2', phone: '(709) 722-3100', lat: 47.5631, lng: -52.7092, tax: 1500 },
  { user: 'adelaide', name: 'The Adelaide Oyster House', cuisine: 'Seafood', address: '334 Water St', city: "St. John's", zip: 'A1C 1C2', phone: '(709) 722-7222', lat: 47.5631, lng: -52.7083, tax: 1500 },
  { user: 'terre', name: 'Terre Restaurant & Cafe', cuisine: 'Cafe', address: '125 Water St', city: "St. John's", zip: 'A1C 1A9', phone: '(709) 383-2136', lat: 47.5601, lng: -52.7136, tax: 1500 },
];

// A fictional restaurant that is still waiting for approval, to show the owner console's approval queue.
const PENDING_USER = 'pearlbakehouse';
const REGIONAL: [string, string, string, string, string, string][] = [
  [PENDING_USER, 'Pearl Town Bakehouse', 'Bakery', '760 Topsail Rd', 'Mount Pearl', 'A1N 3J5'],
];

// Menus (illustrative, not the restaurants' official menus): [restaurant user, item name, description, dietary, price]
const MENU: [string, string, string, string, number][] = [
  ['no4', 'Crispy Cod Tacos', 'Beer-battered Atlantic cod, lime crema, pickled red onion and slaw on corn tortillas.', '', 19],
  ['no4', 'No. 4 Smash Burger', 'Double smashed beef patty, aged cheddar, house pickles and fries.', '', 22],
  ['merchanttavern', 'Pan-Seared Atlantic Cod', 'Local cod loin, brown butter, crushed new potatoes, capers and greens.', 'gluten-free', 32],
  ['merchanttavern', 'Tavern Rigatoni', 'Slow-cooked pork ragù, San Marzano tomato, parmesan and basil.', '', 26],
  ['blueonwater', 'Truffle Fries', 'Hand-cut fries, white truffle oil, Parmigiano Reggiano and rosemary aioli.', 'vegetarian', 16],
  ['blueonwater', 'Duck BLT', 'Smoked duck breast, double-smoked bacon, tomato and garlic aioli on brioche.', '', 26],
  ['yellowbelly', "St. John's Stout Braised Short Rib", 'Braised in house stout with Yukon gold purée, glazed carrots and pan jus.', 'gluten-free', 36],
  ['yellowbelly', 'Fish & Chips (1 pc)', 'Ale-battered Atlantic cod, hand-cut fries, tartar sauce and lemon.', '', 17],
  ['olivers', 'Chicken Parmesan Sandwich', 'Breaded chicken cutlet, marinara and fior di latte on toasted ciabatta.', '', 22],
  ['olivers', 'Chickpea & Walnut Pâté', 'Herb chickpea spread with olives, pickled shallots and crostini.', 'vegan,dairy-free', 18],
  ['blackcat', 'Chicken Bacon Ranch Pizza', 'Sourdough crust, roasted garlic chicken, crispy bacon and buttermilk ranch.', '', 23],
  ['blackcat', 'Hot Honey Pepperoni Pizza', 'Cup & char pepperoni, whipped ricotta, chili oil and hot honey.', 'spicy', 22],
  ['rocket', 'Best Kind Breakfast Sandwich', 'Egg, country ham and aged cheddar on a fresh cheddar biscuit.', '', 12],
  ['rocket', 'Day-End Pastry Box (4)', "Assorted croissants, scones and sweet buns from today's bake.", 'vegetarian', 16],
  ['chinched', 'House Charcuterie Board', 'Chef-cured meats, house pickles, grainy mustard and grilled sourdough.', '', 28],
  ['chinched', 'Crispy Pork Belly', 'Twice-cooked pork belly, apple purée, charred greens and cider jus.', 'gluten-free,dairy-free', 26],
  ['adelaide', 'Fresh Oysters (Half Dozen)', 'East Coast oysters with mignonette, horseradish and lemon.', 'gluten-free,dairy-free', 21],
  ['adelaide', 'Fish Tacos (3)', 'Crispy fried fish, chipotle mayo, pickled jalapeño and slaw.', 'spicy', 18],
  ['terre', 'Seasonal Grain Bowl', 'Roasted root vegetables, farro, local greens, pickled beets and herb vinaigrette.', 'vegan,dairy-free', 18],
  ['terre', 'Newfoundland Cod Cakes', 'Salt cod and potato cakes with tartar sauce, mustard pickles and greens.', '', 16],
];

// Offers: [restaurant user, menu item, reason, note, discount %, qty, discard timer (hours)]
const OFFERS: [string, string, Reason, string, number, number, number][] = [
  ['no4', 'Crispy Cod Tacos', 'unclaimed_order', 'Pickup order never collected.', 50, 1, 2],
  ['merchanttavern', 'Pan-Seared Atlantic Cod', 'wrong_order', 'Guest asked for no capers. Cooked minutes ago.', 50, 1, 2],
  ['blueonwater', 'Truffle Fries', 'wrong_order', 'Accidental duplicate side order.', 50, 2, 2],
  ['yellowbelly', "St. John's Stout Braised Short Rib", 'delayed_order', 'Delivery driver never arrived.', 50, 1, 3],
  ['yellowbelly', 'Fish & Chips (1 pc)', 'wrong_order', 'Wrong side (fries instead of salad).', 45, 1, 2],
  ['olivers', 'Chicken Parmesan Sandwich', 'wrong_order', 'Duplicate ticket.', 50, 1, 2],
  ['blackcat', 'Hot Honey Pepperoni Pizza', 'end_of_day', 'Extra bake at end of shift.', 55, 2, 3],
  ['rocket', 'Day-End Pastry Box (4)', 'end_of_day', '', 60, 4, 4],
  ['chinched', 'House Charcuterie Board', 'overproduction', 'Prepared for a private event overage.', 50, 2, 3],
  ['adelaide', 'Fresh Oysters (Half Dozen)', 'unclaimed_order', 'Reservation did not show.', 45, 1, 2],
  ['terre', 'Seasonal Grain Bowl', 'overproduction', 'Lunch prep overage.', 50, 3, 4],
];

// [restaurant user, dish, description, dietary, price, reason, discount %, qty]
const REGIONAL_MENU: [string, string, string, string, number, Reason, number, number][] = [
  [PENDING_USER, 'Toutons & Molasses (4)', 'Fried bread dough with molasses, made fresh this morning.', 'vegetarian', 12, 'end_of_day', 50, 3],
];

function must<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as NonNullable<T>;
}

const tags = (s: string) => (s ? s.split(',') : []);

async function deleteLogin(email: string) {
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`list users: ${error.message}`);
    const found = data.users.find((u) => u.email === email);
    if (found) {
      const del = await db.auth.admin.deleteUser(found.id);
      if (del.error) throw new Error(`delete ${email}: ${del.error.message}`);
      return;
    }
    if (data.users.length < 1000) return;
  }
}

// Creates a user through Supabase Auth (the sign-up trigger creates the profile, restaurant and
// terms-acceptance records), or returns the existing one.
async function user(username: string, role: 'customer' | 'restaurant' | 'admin', restaurant?: Record<string, unknown>) {
  const existing = await db.from('profiles').select('id').eq('username', username).maybeSingle();
  if (existing.data) {
    // Demo accounts seeded before the rename to Last Bite move to the new email and password.
    const { data } = await db.auth.admin.getUserById(existing.data.id);
    if (data.user?.email?.endsWith('@biteback.test')) {
      const res = await db.auth.admin.updateUserById(existing.data.id, { email: `${username}@lastbite.test`, password: DEMO_PASSWORD, email_confirm: true });
      if (res.error) throw new Error(`update ${username}: ${res.error.message}`);
    }
    return existing.data.id;
  }
  // Admins are created as customers and then promoted (like scripts/create-admin.ts does).
  const signupRole = role === 'admin' ? 'customer' : role;
  const accepted = Object.fromEntries(REQUIRED[signupRole].map((d) => [d, DOCUMENTS[d].version]));
  const email = `${username}@lastbite.test`;
  const create = () => db.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { username, role: signupRole, accepted_terms: accepted, restaurant, ip: 'seed', user_agent: 'npm run seed' },
  });
  let res = await create();
  if (res.error?.code === 'email_exists') {
    // A login without a profile, left by a seed run before the database tables existed: replace it.
    await deleteLogin(email);
    res = await create();
  }
  if (res.error || !res.data.user) throw new Error(`create ${username}: ${res.error?.message}`);
  const id = res.data.user.id;
  if (role === 'admin') must(await db.from('profiles').update({ role: 'admin' }).eq('id', id).select('id'), 'promote admin');
  return id;
}

async function restaurantId(ownerId: string) {
  return must(await db.from('restaurants').select('id').eq('owner_id', ownerId).single(), 'restaurant').id;
}

async function main() {
  const tables = await db.from('profiles').select('id').limit(1);
  if (tables.error?.code === 'PGRST205' || tables.error?.code === '42P01') {
    throw new Error(`The database doesn't have the Last Bite tables yet (${tables.error.message}).
Create them first with: npx supabase db push   (see "Run it locally" in README.md), then run npm run seed again.`);
  }
  if (tables.error) throw new Error(`Can't reach the database at ${url}: ${tables.error.message}`);
  const { data: fee } = await db.from('settings').select('value').eq('key', 'service_fee_bps').single();
  const serviceFeeBps = Number(fee?.value ?? 500);

  const demoId = await user('demo', 'customer');
  await user('admin', 'admin');

  const ids: Record<string, number> = {};
  for (const r of RESTAURANTS) {
    const owner = await user(r.user, 'restaurant', { name: r.name, address: r.address, city: r.city, zip: r.zip, phone: r.phone, cuisine: r.cuisine, lat: r.lat, lng: r.lng });
    ids[r.user] = await restaurantId(owner);
    must(await db.from('restaurants').update({
      status: 'approved', tax_rate_bps: r.tax, description: `${r.cuisine} in downtown ${r.city}.`, phone: r.phone,
    }).eq('id', ids[r.user]).select('id'), 'approve');
    // Downtown demo restaurants have finished Stripe Connect onboarding (mock accounts).
    must(await db.from('restaurant_payment_accounts').update({
      stripe_account_id: `acct_mock_${String(ids[r.user]).padStart(6, '0')}`, charges_enabled: true, payouts_enabled: true,
      details_submitted: true, bank_summary: 'MOCK BANK ••••6789',
    }).eq('restaurant_id', ids[r.user]).select('restaurant_id'), 'connect');
  }

  for (const [i, [u, name, cuisine, address, city, zip]] of REGIONAL.entries()) {
    const z = must(await db.rpc('resolve_area', { p_query: zip }), 'zip')[0];
    // Small, deterministic offset so restaurants in the same postal area don't share one pin.
    const lat = z.lat + (((i * 37) % 11) - 5) * 0.0012;
    const lng = z.lng + (((i * 53) % 11) - 5) * 0.0016;
    const owner = await user(u, 'restaurant', { name, address, city, zip, cuisine, lat, lng });
    ids[u] = await restaurantId(owner);
    must(await db.from('restaurants').update({
      // One restaurant waits for approval, to show the admin approval queue.
      status: u === PENDING_USER ? 'pending' : 'approved',
      description: `${cuisine} in ${city}.`, phone: `(709) 555-${String(1000 + i).slice(-4)}`,
    }).eq('id', ids[u]).select('id'), 'approve');
  }

  // Approved restaurants have paid this year's partner subscription (mock card payments).
  for (const [u, id] of Object.entries(ids)) {
    if (u === PENDING_USER) continue;
    const paid = must(await db.from('subscription_payments').select('id').eq('restaurant_id', id).eq('status', 'paid').limit(1), 'subscription');
    if (paid.length) continue;
    const p = must(await db.rpc('begin_subscription_payment', { p_restaurant_id: id }), 'subscription');
    must(await db.rpc('finish_subscription_payment', { p_id: p.id, p_payment_ref: `pi_mock_seed_${id}`, p_card_label: 'VISA •••• 4242' }), 'subscription');
  }

  // Menus.
  const menuId: Record<string, { id: number; price: number; name: string; description: string; dietary: string[]; restaurant: number }> = {};
  const addItem = async (u: string, name: string, description: string, dietary: string, price: number) => {
    const found = await db.from('menu_items').select('*').eq('restaurant_id', ids[u]).eq('name', name).eq('active', true).maybeSingle();
    const row = found.data ?? must(await db.from('menu_items').insert({
      restaurant_id: ids[u], name, description, dietary: tags(dietary), price_cents: Math.round(price * 100),
    }).select('*').single(), 'menu item');
    menuId[`${u}|${name}`] = { id: row.id, price: row.price_cents, name: row.name, description: row.description, dietary: row.dietary, restaurant: ids[u] };
  };
  for (const [u, name, desc, dietary, price] of MENU) await addItem(u, name, desc, dietary, price);
  for (const [u, name, desc, dietary, price] of REGIONAL_MENU) await addItem(u, name, desc, dietary, price);

  // Live offers with discard timers.
  const now = Date.now();
  const hour = 3600_000;
  const offerRows = [
    ...OFFERS.map(([u, item, reason, note, pct, qty, h]) => ({ key: `${u}|${item}`, reason, note, pct, qty, h })),
    ...REGIONAL_MENU.map(([u, item, , , , reason, pct, qty], i) => ({ key: `${u}|${item}`, reason, note: '', pct, qty, h: 2 + (i % 4) })),
  ].map((o) => {
    const m = menuId[o.key];
    return {
      restaurant_id: m.restaurant, menu_item_id: m.id, title: m.name, description: o.note || m.description, reason: o.reason,
      dietary: m.dietary, original_price_cents: m.price, discount_pct: o.pct, quantity_total: o.qty, quantity_available: o.qty,
      pickup_start: new Date(now - 10 * 60_000).toISOString(), pickup_end: new Date(now + o.h * hour).toISOString(),
    };
  });
  must(await db.from('offers').insert(offerRows).select('id'), 'offers');

  // Two weeks of completed demo orders so the admin dashboard, reports and payouts have data.
  const hasHistory = must(await db.from('orders').select('id').eq('user_id', demoId).eq('status', 'picked_up').limit(1), 'orders');
  if (!hasHistory.length) {
    const approved = new Set(Object.entries(ids).filter(([u]) => u !== PENDING_USER).map(([, id]) => id));
    const offers = must(await db.from('offers').select('id, menu_item_id, restaurant_id'), 'offers');
    const taxes = new Map(must(await db.from('restaurants').select('id, tax_rate_bps'), 'restaurants').map((r) => [r.id, r.tax_rate_bps]));
    const items = Object.values(menuId).filter((m) => approved.has(m.restaurant))
      .map((m) => ({ ...m, offerId: offers.find((o) => o.menu_item_id === m.id)?.id })).filter((m) => m.offerId);
    let seedN = 7;
    const rand = () => {
      seedN = (seedN * 16807) % 2147483647;
      return seedN / 2147483647;
    };
    const rows: Database['public']['Tables']['orders']['Insert'][] = [];
    for (let d = 14; d >= 1; d--) {
      const count = 2 + Math.floor(rand() * 5);
      for (let k = 0; k < count; k++) {
        const m = items[Math.floor(rand() * items.length)];
        const qty = 1 + Math.floor(rand() * 2);
        const pct = [40, 45, 50, 55, 60][Math.floor(rand() * 5)];
        const q = quote({ originalUnitCents: m.price, discountPct: pct, quantity: qty, serviceFeeBps, taxRateBps: taxes.get(m.restaurant) ?? 1500, taxServiceFee: true });
        const created = new Date(now - d * 86400000 - Math.floor(rand() * 8 + 1) * 3600000);
        const picked = new Date(created.getTime() + (15 + Math.floor(rand() * 60)) * 60000);
        rows.push({
          user_id: demoId, offer_id: m.offerId!, restaurant_id: m.restaurant, customer_username: 'demo', item_title: m.name, quantity: qty,
          unit_price_cents: q.unitPriceCents, original_unit_price_cents: q.originalUnitCents, discount_pct: pct, subtotal_cents: q.subtotalCents,
          service_fee_cents: q.serviceFeeCents, service_fee_bps: q.serviceFeeBps, tax_rate_bps: q.taxRateBps, tax_cents: q.taxCents,
          total_cents: q.totalCents, status: 'picked_up', payment_ref: `pi_mock_demo_${d}_${k}`, card_label: 'VISA •••• 4242',
          pickup_end: picked.toISOString(), created_at: created.toISOString(), picked_up_at: picked.toISOString(), closed_at: picked.toISOString(),
        });
      }
    }
    const inserted = must(await db.from('orders').insert(rows).select('id, restaurant_id, subtotal_cents'), 'history');
    // Connected (downtown) restaurants were paid through Stripe Connect at pickup.
    const connected = new Set(RESTAURANTS.map((r) => ids[r.user]));
    for (const o of inserted.filter((x) => connected.has(x.restaurant_id))) {
      must(await db.rpc('record_payout', {
        p_restaurant_id: o.restaurant_id, p_order_id: o.id, p_kind: 'transfer', p_amount_cents: o.subtotal_cents,
        p_transaction_id: `tr_mock_demo_${o.id}`, p_bank_details: `Stripe Connect acct_mock_${String(o.restaurant_id).padStart(6, '0')} · MOCK BANK ••••6789`,
        p_note: `Order #${o.id}`, p_by: null as unknown as string,
      }), 'payout');
    }
    // Some welcome credit for the demo customer.
    must(await db.from('credit_ledger').insert({ user_id: demoId, amount_cents: 1000, kind: 'goodwill', note: 'Welcome credit (demo)' }).select('id'), 'credit');
  }

  console.log('Seeded demo data.');
  console.log(`  Customer login:    demo / ${DEMO_PASSWORD}`);
  console.log(`  Owner/admin login: admin / ${DEMO_PASSWORD}  (demo only: create your real one with npm run create-admin)`);
  console.log(`  Restaurant logins (password ${DEMO_PASSWORD}):`);
  console.log(`    Downtown St. John's (Stripe connected): ${RESTAURANTS.map((r) => r.user).join(', ')}`);
  console.log(`    Approved restaurants have a paid partner subscription; ${PENDING_USER} has none yet.`);
  console.log(`    Awaiting approval: ${REGIONAL.map((r) => `${r[0]} (${r[4]})`).join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
