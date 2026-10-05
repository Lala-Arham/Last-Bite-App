'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { CheckCircle2, Download, Share, Smartphone, Tablet } from 'lucide-react';

type Device = 'android' | 'ipad';
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

function detect(): Device | 'other' {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ipad';
  return 'other';
}

// Steps to put the kiosk on a tablet's home screen. Android (Chrome) installs it as an app with one
// tap; iPad installs a small profile that adds the icon (or uses Safari's "Add to Home Screen").
// Opened on another device (e.g. the owner's computer), it shows a QR code to scan with the tablet.
export function InstallGuide({ restaurantName, kioskUrl, installUrl, profileUrl, requested }: {
  restaurantName: string;
  kioskUrl: string;
  installUrl: string;
  profileUrl: string;
  requested: Device | null;
}) {
  const [here, setHere] = useState<Device | 'other' | null>(null);
  const [tab, setTab] = useState<Device>(requested ?? 'android');
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [qr, setQr] = useState('');

  useEffect(() => {
    const d = detect();
    // Device detection needs the browser, so it runs after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHere(d);
    if (!requested && d !== 'other') setTab(d);
    if (window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches) setInstalled(true);
    navigator.serviceWorker?.register('/kiosk/sw.js', { scope: '/kiosk/' }).catch(() => {});
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [requested]);

  useEffect(() => {
    QRCode.toDataURL(`${installUrl}?device=${tab}`, { width: 260, margin: 1, color: { dark: '#121316', light: '#ffffff' } }).then(setQr).catch(() => {});
  }, [installUrl, tab]);

  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    setPrompt(null);
  };

  const onThisTablet = here === tab;
  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-5 py-8">
      <div className="mb-6 flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/kiosk-icon-192.png" alt="" className="size-16 rounded-2xl" />
        <div>
          <h1 className="m-0 text-2xl font-extrabold sm:text-3xl">{restaurantName} kiosk</h1>
          <p className="m-0 text-muted">Put your Last Bite counter kiosk on your tablet&apos;s home screen.</p>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-2 rounded-2xl border border-line bg-surface p-1.5">
        {(['android', 'ipad'] as const).map((d) => (
          <button key={d} type="button" onClick={() => setTab(d)}
            className={`flex h-12 items-center justify-center gap-2 rounded-xl font-bold ${tab === d ? 'bg-primary-soft text-primary-ink' : 'text-ink-2'}`}>
            {d === 'android' ? <Smartphone className="size-5" /> : <Tablet className="size-5" />} {d === 'android' ? 'Android tablet' : 'iPad'}
          </button>
        ))}
      </div>

      {installed ? (
        <section className="rounded-3xl border border-success/40 bg-success-soft p-6 text-center text-success-ink">
          <CheckCircle2 className="mx-auto size-12" />
          <h2 className="mt-2 text-2xl font-extrabold">The kiosk is on this tablet</h2>
          <p>Look for the <b>{restaurantName}</b> icon on the home screen and tap it to open the kiosk.</p>
          <a href={kioskUrl} className="mt-3 inline-flex h-12 items-center rounded-xl bg-grad px-6 font-extrabold text-[#121316]">Open the kiosk</a>
        </section>
      ) : here !== null && !onThisTablet ? (
        <section className="grid items-center gap-6 rounded-3xl border border-line bg-surface p-6 sm:grid-cols-[auto_1fr]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {qr && <img src={qr} alt="QR code for the kiosk set-up page" className="mx-auto size-56 rounded-2xl bg-white p-2" />}
          <div>
            <h2 className="text-xl font-extrabold">Open this page on the {tab === 'android' ? 'Android tablet' : 'iPad'}</h2>
            <p className="text-ink-2">
              Scan the QR code with the tablet&apos;s camera, or email yourself this page and open it on the tablet
              {tab === 'ipad' ? ' in Safari' : ' in Chrome'}. The install button appears there.
            </p>
            <p className="text-sm break-all text-muted">{installUrl}?device={tab}</p>
          </div>
        </section>
      ) : tab === 'android' ? (
        <section className="rounded-3xl border border-line bg-surface p-6">
          <h2 className="text-xl font-extrabold">Install on this Android tablet</h2>
          {prompt ? (
            <>
              <p className="text-ink-2">Tap the button, then tap <b>Install</b>. The kiosk icon appears on your home screen.</p>
              <button type="button" onClick={install} className="mt-2 flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-grad text-xl font-extrabold text-[#121316]">
                <Download /> Install the kiosk on this tablet
              </button>
            </>
          ) : (
            <ol className="ml-5 list-decimal space-y-2 text-lg">
              <li>Make sure this page is open in <b>Chrome</b>.</li>
              <li>Tap the <b>⋮</b> menu at the top right.</li>
              <li>Tap <b>Install app</b> (or <b>Add to Home screen</b>, then <b>Install</b>).</li>
              <li>The <b>{restaurantName}</b> icon appears on your home screen. Tap it to open the kiosk.</li>
            </ol>
          )}
        </section>
      ) : (
        <section className="rounded-3xl border border-line bg-surface p-6">
          <h2 className="text-xl font-extrabold">Add to this iPad&apos;s home screen</h2>
          <p className="text-ink-2">Open this page in <b>Safari</b>, then:</p>
          <a href={profileUrl} className="my-3 flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-grad text-xl font-extrabold text-[#121316]">
            <Download /> Download the kiosk to this iPad
          </a>
          <ol className="ml-5 list-decimal space-y-2 text-lg">
            <li>Tap <b>Allow</b> when Safari asks to download a configuration profile.</li>
            <li>Open <b>Settings</b> and tap <b>Profile Downloaded</b> near the top (or General › VPN &amp; Device Management).</li>
            <li>Tap <b>Install</b>, enter the iPad passcode, then <b>Install</b> again.</li>
            <li>The <b>{restaurantName}</b> icon is now on the home screen. Tap it to open the kiosk full screen.</li>
          </ol>
          <details className="mt-5 rounded-2xl border border-line bg-bg-2 p-4">
            <summary className="cursor-pointer font-bold">Prefer not to install a profile?</summary>
            <ol className="mt-3 ml-5 list-decimal space-y-2">
              <li>Open the kiosk in Safari: <a href={kioskUrl} className="break-all">{kioskUrl}</a></li>
              <li>Tap the <Share className="inline size-4" /> <b>Share</b> button, then <b>Add to Home Screen</b>, then <b>Add</b>.</li>
            </ol>
          </details>
        </section>
      )}

      <p className="mt-6 text-sm text-muted">
        🔒 This link is the key to your kiosk: anyone with it can hand over orders and post surplus food for {restaurantName}.
        Keep it on your own tablets. If it is shared by mistake, reset it in the Partner Portal (Kiosk tab).
      </p>
    </main>
  );
}
