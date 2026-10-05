'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download } from 'lucide-react';
import { toast } from 'sonner';
import { confirmSubscriptionPayment, paySubscription } from '@/app/actions/restaurant';
import { CardEntry, type CardEntryHandle } from '@/components/payments/card-entry';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Table } from '@/components/ui/misc';
import { fmtDate, money, pct } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { Ctx } from './types';

export type SubscriptionStatus = {
  paidThrough: string | null;
  active: boolean;
  endsSoon: boolean;
  required: boolean;
  canRenew: boolean;
  feeCents: number;
  taxRateBps: number;
  taxCents: number;
  totalCents: number;
};

// Shared with the dashboard banner.
export function useSubscription() {
  const supabase = supabaseBrowser();
  return useQuery({
    queryKey: ['subscription'],
    queryFn: async () => (await supabase.rpc('my_subscription')).data as SubscriptionStatus | null,
  });
}

const RENEW_WINDOW_DAYS = 60;

// The annual partner subscription: status, paying by card, and invoices.
export function SubscriptionPanel({ ctx }: { ctx: Ctx }) {
  const supabase = supabaseBrowser();
  const queryClient = useQueryClient();
  const cardRef = useRef<CardEntryHandle>(null);
  const [busy, setBusy] = useState(false);
  const rid = ctx.restaurant.id;
  const status = useSubscription();
  const history = useQuery({
    queryKey: ['subscription-payments', rid],
    queryFn: async () =>
      (await supabase.from('subscription_payments').select('*').eq('restaurant_id', rid).eq('status', 'paid').order('paid_at', { ascending: false })).data ?? [],
  });

  const s = status.data;
  const pay = async () => {
    if (!cardRef.current) return;
    setBusy(true);
    try {
      const token = await cardRef.current.getToken();
      const res = await paySubscription(token);
      if (!res.ok) return void toast.error(res.error);
      if (res.data.requiresAction) {
        await cardRef.current.handleAction(res.data.clientSecret);
        const done = await confirmSubscriptionPayment(res.data.paymentId);
        if (!done.ok) return void toast.error(done.error);
      }
      toast.success('Thank you! Your Last Bite subscription is paid.');
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      queryClient.invalidateQueries({ queryKey: ['subscription-payments', rid] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Payment failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!s) return null;
  const renewFrom = s.paidThrough ? new Date(Date.parse(s.paidThrough) - RENEW_WINDOW_DAYS * 86_400_000).toISOString() : null;
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
      <Card>
        <CardTitle>⭐ Partner subscription</CardTitle>
        {s.active ? (
          <p className="flex items-center gap-2 font-semibold text-primary-ink"><CheckCircle2 className="size-5" /> Active until {fmtDate(s.paidThrough)}</p>
        ) : (
          <Alert tone="warn" className="mb-3">
            {s.paidThrough ? <>Your subscription ended on <b>{fmtDate(s.paidThrough)}</b>.</> : <>You don&apos;t have a subscription yet.</>}{' '}
            {s.required ? 'Pay for a year to post surplus food. You can still verify pickups for existing orders.' : 'Subscriptions are not required right now.'}
          </Alert>
        )}
        <p className="text-sm text-ink-2">
          One flat yearly fee for everything in the Partner Portal. Last Bite takes <b>no commission</b> on your food sales.
        </p>
        <Table className="mb-4">
          <tbody>
            <tr><td>Annual subscription</td><td className="text-right">{money(s.feeCents)}</td></tr>
            <tr><td>HST ({pct(s.taxRateBps)})</td><td className="text-right">{money(s.taxCents)}</td></tr>
            <tr><td><b>Total per year</b></td><td className="text-right font-bold">{money(s.totalCents)}</td></tr>
          </tbody>
        </Table>
        {s.canRenew ? (
          <>
            {s.active && <p className="text-sm text-muted">Renewing now adds a year after {fmtDate(s.paidThrough)}, so you don&apos;t lose any time.</p>}
            <CardEntry config={{ mode: ctx.paymentMode, publishableKey: ctx.stripePublishableKey }} ref={cardRef} />
            <Button className="mt-4 w-full" disabled={busy} onClick={pay}>
              {busy ? 'Processing…' : `${s.active || s.paidThrough ? 'Renew' : 'Pay'} ${money(s.totalCents)} for 1 year`}
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted">You can renew from {fmtDate(renewFrom)} ({RENEW_WINDOW_DAYS} days before your subscription ends).</p>
        )}
        <p className="mt-4 text-xs text-muted">
          See section 5.3 of the <a href="/legal/restaurant-agreement" target="_blank">Partner Agreement</a>. Your card is charged once per year you pay
          for; nothing renews automatically.
        </p>
      </Card>
      <Card>
        <CardTitle>Invoices</CardTitle>
        {history.data?.length ? (
          <Table>
            <thead><tr><th>Paid</th><th>Invoice</th><th className="text-right">Amount</th><th /></tr></thead>
            <tbody>
              {history.data.map((p) => (
                <tr key={p.id}>
                  <td className="text-xs whitespace-nowrap">{fmtDate(p.paid_at)}</td>
                  <td>
                    <code className="text-xs">{p.invoice_number}</code>
                    <div className="text-xs text-muted">{fmtDate(p.period_start)} to {fmtDate(p.period_end)}</div>
                    <div className="text-xs text-muted">{p.kind === 'complimentary' ? <Badge tone="green">Complimentary</Badge> : p.card_label}</div>
                  </td>
                  <td className="text-right font-bold">{money(p.total_cents)}</td>
                  <td className="text-right">
                    <a className="inline-flex items-center gap-1 text-sm" href={`/api/restaurant/subscription/${p.id}/invoice`}><Download className="size-4" /> PDF</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="text-sm text-muted">No invoices yet. Each year you pay for gets an invoice showing the HST.</p>
        )}
      </Card>
    </div>
  );
}
