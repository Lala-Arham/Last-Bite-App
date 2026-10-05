'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, BellOff, CheckCircle2, Delete, Plus, X } from 'lucide-react';
import { kioskConfirmPickup, kioskLookupPickup } from '@/app/actions/kiosk';
import type { PickupOrder } from '@/app/actions/restaurant';
import { isUnlocked, ringBell, unlockOnInteraction } from '@/components/restaurant/bell';
import type { KioskOrder } from '@/lib/kiosk';
import { fmtTime, money, timeLeft } from '@/lib/format';
import { PostSurplusDialog } from './post-surplus-dialog';

type State = {
  restaurant: { name: string; status: 'pending' | 'approved' | 'suspended' };
  orders: KioskOrder[];
  today: { meals: number; salesCents: number };
  canPost: boolean;
};

const POLL_MS = 5000;

// Full-screen counter kiosk for restaurant staff: PIN pad to hand over orders, a bell for new
// orders, the list of orders waiting for pickup, and quick posting of surplus food. Polls the
// server every few seconds, keeps the screen awake, and works as an installed home-screen app.
export function KioskScreen({ token, restaurantName }: { token: string; restaurantName: string }) {
  const [started, setStarted] = useState(false);
  const [state, setState] = useState<State | null>(null);
  const [offline, setOffline] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [alert, setAlert] = useState<KioskOrder | null>(null);
  const [posting, setPosting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const seen = useRef<Set<number> | null>(null);
  const soundRef = useRef(soundOn);

  useEffect(() => {
    soundRef.current = soundOn;
  }, [soundOn]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/kiosk/${token}`, { cache: 'no-store' });
      if (res.status === 404) return setInvalid(true);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as State;
      setOffline(false);
      setState(data);
      // Ring for orders that weren't there last time (not for the ones already waiting at start-up).
      if (seen.current) {
        const fresh = data.orders.filter((o) => !seen.current!.has(o.id));
        if (fresh.length) {
          if (soundRef.current) ringBell({ volume: 0.6 });
          setAlert(fresh[fresh.length - 1]);
          setTimeout(() => setAlert(null), 15000);
        }
      }
      seen.current = new Set(data.orders.map((o) => o.id));
    } catch {
      setOffline(true);
    }
  }, [token]);

  useEffect(() => {
    // First load, then poll. setState happens after the fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 15000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  // Installed-app support (offline page) and sound/screen settings.
  useEffect(() => {
    navigator.serviceWorker?.register('/kiosk/sw.js', { scope: '/kiosk/' }).catch(() => {});
    try {
      // Browser-only preference, read after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSoundOn(localStorage.getItem('lb-kiosk-sound') !== 'off');
    } catch {
      // storage unavailable
    }
    return unlockOnInteraction();
  }, []);

  // Keep the tablet's screen on while the kiosk is open.
  useEffect(() => {
    if (!started || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = () => navigator.wakeLock.request('screen').then((l) => (lock = l)).catch(() => {});
    acquire();
    const again = () => document.visibilityState === 'visible' && acquire();
    document.addEventListener('visibilitychange', again);
    return () => {
      document.removeEventListener('visibilitychange', again);
      lock?.release().catch(() => {});
    };
  }, [started]);

  const start = () => {
    setStarted(true);
    if (soundOn) setTimeout(() => ringBell({ volume: 0.2 }), 50);
    document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    try {
      localStorage.setItem('lb-kiosk-sound', next ? 'on' : 'off');
    } catch {
      // ignore
    }
    if (next) setTimeout(() => ringBell({ volume: 0.4 }), 50);
  };

  if (invalid) {
    return (
      <main className="grid min-h-dvh place-items-center p-8 text-center">
        <div>
          <div className="text-5xl">🔒</div>
          <h1 className="mt-3 text-2xl font-extrabold">This kiosk link is no longer valid</h1>
          <p className="text-muted">The restaurant owner reset it. Open the new link from the Partner Portal (Kiosk tab).</p>
        </div>
      </main>
    );
  }

  if (!started) {
    return (
      <button type="button" onClick={start} className="grid min-h-dvh w-full cursor-pointer place-items-center bg-bg p-8 text-center">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/kiosk-icon-192.png" alt="" className="mx-auto size-28 rounded-3xl" />
          <h1 className="mt-6 text-4xl font-extrabold">{restaurantName}</h1>
          <p className="mt-1 text-lg text-muted">Last Bite counter kiosk</p>
          <span className="mt-8 inline-flex h-16 items-center rounded-2xl bg-grad px-10 text-2xl font-extrabold text-[#121316]">Tap to start</span>
          <p className="mt-4 text-sm text-muted">Starting turns on the new-order bell and keeps the screen awake.</p>
        </div>
      </button>
    );
  }

  const s = state;
  return (
    <main className="flex min-h-dvh flex-col bg-bg select-none">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/kiosk-icon-192.png" alt="" className="size-11 rounded-xl" />
        <div className="min-w-0">
          <div className="truncate text-xl font-extrabold">{restaurantName}</div>
          <div className="text-xs text-muted">
            Last Bite kiosk · {new Date(now).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            {offline ? <span className="ml-2 text-danger">● Reconnecting…</span> : <span className="ml-2 text-success">● Live</span>}
          </div>
        </div>
        <span className="flex-1" />
        <button type="button" onClick={toggleSound} className="flex h-12 items-center gap-2 rounded-xl border border-line bg-surface px-4 font-semibold">
          {soundOn ? <Bell className="size-5" /> : <BellOff className="size-5" />} {soundOn ? 'Bell on' : 'Bell off'}
        </button>
        <button
          type="button" onClick={() => setPosting(true)}
          className="flex h-12 items-center gap-2 rounded-xl bg-grad px-5 font-extrabold text-[#121316] disabled:opacity-50"
          disabled={!s || s.restaurant.status === 'suspended'}
        >
          <Plus className="size-5" /> Post surplus food
        </button>
      </header>

      {s?.restaurant.status === 'suspended' && (
        <div className="bg-danger-soft px-5 py-3 text-center font-semibold text-[#fecaca]">⛔ This restaurant is suspended. You can still hand over orders already placed.</div>
      )}
      {s?.restaurant.status === 'pending' && (
        <div className="bg-accent-soft px-5 py-3 text-center font-semibold text-accent-ink">⏳ Waiting for Last Bite approval: customers will see your offers once you are approved.</div>
      )}
      {soundOn && !isUnlocked() && (
        <div className="bg-primary-soft px-5 py-2 text-center text-sm text-primary-ink">🔔 Tap the screen once to turn on the bell.</div>
      )}

      <div className="grid flex-1 gap-5 p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <PinPad token={token} onDone={load} />
        <section className="flex min-h-0 flex-col rounded-3xl border border-line bg-surface p-5">
          <div className="mb-3 grid grid-cols-2 gap-3">
            <Stat value={s?.orders.length ?? '–'} label="Waiting for pickup" />
            <Stat value={s ? `${s.today.meals} · ${money(s.today.salesCents)}` : '–'} label="Picked up today" />
          </div>
          <h2 className="mb-2 text-lg font-extrabold">Orders waiting for pickup</h2>
          <div className="-mr-2 flex-1 overflow-y-auto pr-2">
            {!s ? <p className="text-muted">Loading…</p> : s.orders.length === 0 ? (
              <p className="py-10 text-center text-muted">No orders waiting. New orders ring the bell and appear here.</p>
            ) : (
              <ul className="grid gap-2">
                {s.orders.map((o) => (
                  <li key={o.id} className="flex items-center gap-3 rounded-2xl border border-line bg-bg-2 p-3">
                    {o.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={o.imageUrl} alt="" className="size-14 rounded-xl object-cover" />
                    ) : <span className="grid size-14 place-items-center rounded-xl bg-surface-2 text-2xl">🍽️</span>}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-lg font-bold">{o.quantity} × {o.itemTitle}</div>
                      <div className="text-sm text-muted">{o.customerUsername} · ordered {fmtTime(o.createdAt)} · #{o.id}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-accent">⏳ {timeLeft(o.pickupEnd, now)}</div>
                      <div className="text-xs text-muted">by {fmtTime(o.pickupEnd)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {alert && (
        <div role="alert" onClick={() => setAlert(null)} className="fixed inset-x-0 top-4 z-50 mx-auto w-[min(560px,calc(100%-32px))] cursor-pointer rounded-3xl border-2 border-primary bg-surface p-5 shadow-pop">
          <div className="flex items-center gap-4">
            <span aria-hidden className="animate-bounce text-5xl">🔔</span>
            <div className="flex-1">
              <div className="text-2xl font-extrabold">New order!</div>
              <div className="text-lg">{alert.quantity} × {alert.itemTitle}</div>
              <div className="text-sm text-muted">{alert.customerUsername} · {money(alert.totalCents)} · pick up by {fmtTime(alert.pickupEnd)}</div>
            </div>
            <X className="size-6 text-muted" />
          </div>
        </div>
      )}

      {posting && s && <PostSurplusDialog token={token} canPost={s.canPost} onClose={() => setPosting(false)} />}
    </main>
  );
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="rounded-2xl border border-line bg-bg-2 p-3">
      <div className="text-2xl font-extrabold">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

// Big touch PIN pad. Four digits look up the order; staff check it and confirm to hand it over.
function PinPad({ token, onDone }: { token: string; onDone: () => void }) {
  const [pin, setPin] = useState('');
  const [order, setOrder] = useState<PickupOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ quantity: number; itemTitle: string; customerUsername: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const find = async (value: string) => {
    setBusy(true);
    const res = await kioskLookupPickup(token, value);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      setPin('');
      return;
    }
    setError(null);
    setOrder(res.data);
  };

  const press = (k: string) => {
    if (busy || order) return;
    setDone(null);
    setError(null);
    if (k === 'clear') return setPin('');
    if (k === 'back') return setPin((p) => p.slice(0, -1));
    const next = (pin + k).slice(0, 4);
    setPin(next);
    if (next.length === 4) find(next);
  };

  const confirm = async () => {
    if (!order) return;
    setBusy(true);
    const res = await kioskConfirmPickup(token, pin, order.id);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setDone(res.data);
    setOrder(null);
    setPin('');
    onDone();
    setTimeout(() => setDone((d) => (d === res.data ? null : d)), 6000);
  };

  return (
    <section className="flex flex-col items-center rounded-3xl border border-line bg-surface p-5">
      <h2 className="text-2xl font-extrabold">Hand over an order</h2>
      <p className="text-muted">Type the customer&apos;s 4-digit Last Bite PIN.</p>
      <div className="my-5 flex gap-3" aria-label="PIN">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`grid h-20 w-16 place-items-center rounded-2xl border-2 text-4xl font-extrabold ${pin[i] ? 'border-primary' : 'border-line'} bg-bg-2`}>
            {pin[i] ?? ''}
          </div>
        ))}
      </div>

      {order ? (
        <div className="w-full max-w-md rounded-2xl border-2 border-primary bg-bg-2 p-5 text-center">
          <div className="text-sm text-muted">Order #{order.id} · {order.customerUsername}</div>
          <div className="my-1 text-3xl font-extrabold">{order.quantity} × {order.itemTitle}</div>
          <div className="text-muted">Total {money(order.totalCents)}{order.creditAppliedCents > 0 && ` (${money(order.creditAppliedCents)} credit)`}</div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button type="button" disabled={busy} onClick={() => { setOrder(null); setPin(''); }} className="h-16 rounded-2xl border border-line bg-surface text-lg font-bold">Cancel</button>
            <button type="button" disabled={busy} onClick={confirm} className="h-16 rounded-2xl bg-success text-lg font-extrabold text-[#06281c]">{busy ? 'Charging…' : 'Hand over ✓'}</button>
          </div>
          <p className="mt-3 text-xs text-muted">Confirming charges the customer&apos;s card. Only hand over the food once you confirm.</p>
        </div>
      ) : done ? (
        <div className="w-full max-w-md rounded-2xl border-2 border-success bg-success-soft p-5 text-center text-success-ink">
          <CheckCircle2 className="mx-auto size-12" />
          <div className="mt-2 text-2xl font-extrabold">Picked up!</div>
          <div>{done.quantity} × {done.itemTitle} for {done.customerUsername}</div>
        </div>
      ) : (
        <div className="grid w-full max-w-sm grid-cols-3 gap-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'].map((k) => (
            <button
              key={k} type="button" onClick={() => press(k)} disabled={busy}
              className="h-20 rounded-2xl border border-line bg-bg-2 text-3xl font-extrabold active:scale-95 active:bg-surface-2"
              aria-label={k === 'back' ? 'Delete digit' : k === 'clear' ? 'Clear' : k}
            >
              {k === 'back' ? <Delete className="mx-auto size-8" /> : k === 'clear' ? <span className="text-lg">Clear</span> : k}
            </button>
          ))}
        </div>
      )}
      {error && <div role="alert" className="mt-4 w-full max-w-md rounded-2xl bg-danger-soft px-4 py-3 text-center font-semibold text-[#fecaca]">{error}</div>}
    </section>
  );
}
