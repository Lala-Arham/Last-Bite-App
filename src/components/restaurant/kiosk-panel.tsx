'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Copy, Download, ExternalLink, Mail, RotateCcw, Tablet } from 'lucide-react';
import { toast } from 'sonner';
import { emailKioskLink, getKioskLink, resetKioskLink } from '@/app/actions/restaurant';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import type { Ctx } from './types';

// The restaurant's counter kiosk: its secret link, set-up for Android tablets and iPads, and the
// signed Partner Agreement.
export function KioskPanel({ ctx }: { ctx: Ctx }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState('');
  const link = useQuery({
    queryKey: ['kiosk-link'],
    queryFn: async () => {
      const res = await getKioskLink();
      if (!res.ok) throw new Error(res.error);
      return `${window.location.origin}/kiosk/${res.data.token}`;
    },
  });
  const url = link.data;

  useEffect(() => {
    if (url) QRCode.toDataURL(`${url}/install`, { width: 240, margin: 1 }).then(setQr).catch(() => {});
  }, [url]);

  const copy = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url).then(() => toast.success('Kiosk link copied'), () => toast.error('Could not copy. Select the link and copy it.'));
  };
  const reset = async () => {
    if (!confirm('Reset the kiosk link? Tablets using the current link stop working until you open the new link on them.')) return;
    setBusy(true);
    const res = await resetKioskLink();
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success('New kiosk link created. Set up your tablets again with it.');
    queryClient.invalidateQueries({ queryKey: ['kiosk-link'] });
  };
  const email = async () => {
    setBusy(true);
    const res = await emailKioskLink();
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success('Sent! Open the email on your tablet and tap its Download button.');
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
      <Card>
        <CardTitle>📟 Your counter kiosk</CardTitle>
        <p className="text-sm text-ink-2">
          A full-screen app for the tablet at your counter: staff type the customer&apos;s pickup PIN, hear a bell for every new order and post
          surplus food in a few taps. It doesn&apos;t need your password, and it can&apos;t see your payouts or settings.
        </p>
        {url ? (
          <>
            <div className="my-3 flex items-center gap-2 rounded-field border border-line bg-bg-2 px-3 py-2">
              <code className="flex-1 truncate text-xs">{url}</code>
              <Button size="sm" variant="ghost" onClick={copy}><Copy /> Copy</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <a className={buttonVariants({ size: 'sm' })} href={`${url}/install`} target="_blank" rel="noreferrer"><Tablet /> Set up a tablet</a>
              <a className={buttonVariants({ size: 'sm', variant: 'ghost' })} href={url} target="_blank" rel="noreferrer"><ExternalLink /> Open the kiosk</a>
              <Button size="sm" variant="ghost" disabled={busy || ctx.restaurant.status !== 'approved'} onClick={email}><Mail /> Email me the kiosk link</Button>
              <Button size="sm" variant="danger" disabled={busy} onClick={reset}><RotateCcw /> Reset link</Button>
            </div>
            <p className="mt-4 text-xs text-muted">
              🔒 The link works like a key: anyone who has it can hand over orders and post surplus food for {ctx.restaurant.name}. Keep it on
              your own tablets. If it gets out, reset it.
            </p>
          </>
        ) : <p className="text-muted">{link.isError ? 'Could not load your kiosk link.' : 'Loading…'}</p>}
      </Card>
      <div className="grid content-start gap-5">
        <Card>
          <CardTitle>Put it on your tablet</CardTitle>
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {qr && <img src={qr} alt="QR code to set up the kiosk on a tablet" className="size-36 rounded-xl bg-white p-1.5" />}
            <p className="text-sm text-ink-2">
              Scan with the tablet&apos;s camera. <b>Android:</b> tap Install. <b>iPad:</b> tap Download, then install it in Settings. The kiosk
              icon appears on the home screen.
            </p>
          </div>
        </Card>
        <Card>
          <CardTitle>📝 Signed Partner Agreement</CardTitle>
          <p className="text-sm text-ink-2">Your Restaurant Partner Agreement with the record of your electronic signature{ctx.restaurant.status === 'approved' ? ' and Last Bite\'s countersignature' : ''}.</p>
          <a className={buttonVariants({ size: 'sm', variant: 'ghost' })} href="/api/restaurant/agreement"><Download /> Download PDF</a>
        </Card>
      </div>
    </div>
  );
}
