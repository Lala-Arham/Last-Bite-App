'use client';

import { useEffect, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { kioskMenu, kioskPostOffer, type KioskMenuItem } from '@/app/actions/kiosk';
import { OFFER_REASONS, type OfferReason } from '@/lib/constants';
import { money } from '@/lib/format';

const DISCOUNTS = [30, 40, 50, 60, 70];
const TIMERS: [number, string][] = [[60, '1 hour'], [120, '2 hours'], [180, '3 hours'], [240, '4 hours'], [360, '6 hours']];

// Touch-friendly "post surplus food" for the kiosk: pick a menu item, discount, quantity and timer.
// Menu items are managed in the Partner Portal.
export function PostSurplusDialog({ token, canPost, onClose }: { token: string; canPost: boolean; onClose: () => void }) {
  const [menu, setMenu] = useState<KioskMenuItem[] | null>(null);
  const [item, setItem] = useState<KioskMenuItem | null>(null);
  const [reason, setReason] = useState<OfferReason>('overproduction');
  const [discount, setDiscount] = useState(50);
  const [qty, setQty] = useState(2);
  const [minutes, setMinutes] = useState(120);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState<string | null>(null);

  useEffect(() => {
    kioskMenu(token).then((res) => (res.ok ? setMenu(res.data) : setError(res.error)));
  }, [token]);

  const post = async () => {
    if (!item) return setError('Choose a menu item.');
    setBusy(true);
    const res = await kioskPostOffer(token, { menuItemId: item.id, reason, discountPct: discount, quantity: qty, minutes });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setPosted(`${res.data.quantity} × ${res.data.title} posted at ${money(res.data.priceCents)} each. Customers nearby can see it now.`);
  };

  const chip = (on: boolean) =>
    `h-12 rounded-xl border px-4 text-base font-bold ${on ? 'border-primary bg-primary-soft text-primary-ink' : 'border-line bg-bg-2'}`;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Post surplus food">
      <div className="max-h-[94dvh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-line bg-surface p-6">
        <div className="mb-4 flex items-center">
          <h2 className="flex-1 text-2xl font-extrabold">Post surplus food</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-12 place-items-center rounded-xl border border-line"><X /></button>
        </div>

        {!canPost ? (
          <p className="rounded-2xl bg-accent-soft p-4 text-lg text-accent-ink">
            ⭐ The Last Bite subscription for this restaurant isn&apos;t active, so new offers can&apos;t be posted. The owner can renew it in the
            Partner Portal (Subscription tab). Orders already placed can still be handed over.
          </p>
        ) : posted ? (
          <div className="text-center">
            <div className="text-5xl">✅</div>
            <p className="mt-3 text-xl font-bold">{posted}</p>
            <button type="button" onClick={onClose} className="mt-5 h-14 rounded-2xl bg-grad px-10 text-lg font-extrabold text-[#121316]">Done</button>
          </div>
        ) : (
          <>
            <h3 className="mb-2 font-bold">1. What is it?</h3>
            {!menu ? <p className="text-muted">Loading the menu…</p> : menu.length === 0 ? (
              <p className="text-muted">No menu items yet. Add them in the Partner Portal (Menu tab) first.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {menu.map((m) => (
                  <button key={m.id} type="button" onClick={() => setItem(m)}
                    className={`flex items-center gap-2 rounded-2xl border p-2 text-left ${item?.id === m.id ? 'border-primary bg-primary-soft' : 'border-line bg-bg-2'}`}>
                    {m.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.imageUrl} alt="" className="size-12 rounded-lg object-cover" />
                    ) : <span className="grid size-12 place-items-center rounded-lg bg-surface-2 text-xl">🍽️</span>}
                    <span className="min-w-0"><span className="line-clamp-2 font-semibold">{m.name}</span><span className="text-sm text-muted">{money(m.priceCents)}</span></span>
                  </button>
                ))}
              </div>
            )}

            <h3 className="mt-5 mb-2 font-bold">2. Why is it available?</h3>
            <div className="flex flex-wrap gap-2">
              {(Object.entries(OFFER_REASONS) as [OfferReason, string][]).map(([k, label]) => (
                <button key={k} type="button" className={chip(reason === k)} onClick={() => setReason(k)}>{label}</button>
              ))}
            </div>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div>
                <h3 className="mb-2 font-bold">3. Discount</h3>
                <div className="flex flex-wrap gap-2">
                  {DISCOUNTS.map((d) => <button key={d} type="button" className={chip(discount === d)} onClick={() => setDiscount(d)}>{d}% off</button>)}
                </div>
              </div>
              <div>
                <h3 className="mb-2 font-bold">4. How many?</h3>
                <div className="flex items-center gap-3">
                  <button type="button" aria-label="Fewer" className="grid size-14 place-items-center rounded-xl border border-line bg-bg-2" onClick={() => setQty((q) => Math.max(1, q - 1))}><Minus /></button>
                  <span className="w-12 text-center text-3xl font-extrabold">{qty}</span>
                  <button type="button" aria-label="More" className="grid size-14 place-items-center rounded-xl border border-line bg-bg-2" onClick={() => setQty((q) => Math.min(500, q + 1))}><Plus /></button>
                </div>
              </div>
            </div>

            <h3 className="mt-5 mb-2 font-bold">5. Discard timer (customers must pick up before it ends)</h3>
            <div className="flex flex-wrap gap-2">
              {TIMERS.map(([m, label]) => <button key={m} type="button" className={chip(minutes === m)} onClick={() => setMinutes(m)}>{label}</button>)}
            </div>

            {item && (
              <p className="mt-5 rounded-2xl bg-bg-2 p-4 text-lg">
                Customers pay <b>{money(Math.round(item.priceCents * (100 - discount) / 100))}</b> <s className="text-muted">{money(item.priceCents)}</s> each, plus the Last Bite fee and HST.
              </p>
            )}
            {error && <div role="alert" className="mt-4 rounded-2xl bg-danger-soft px-4 py-3 font-semibold text-[#fecaca]">{error}</div>}
            <button type="button" disabled={busy || !item} onClick={post} className="mt-5 h-16 w-full rounded-2xl bg-grad text-xl font-extrabold text-[#121316] disabled:opacity-50">
              {busy ? 'Posting…' : 'Post it now'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
