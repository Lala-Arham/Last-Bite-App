import { NextResponse, type NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth';
import { serverEnv } from '@/lib/env';
import { subscriptionInvoicePdf } from '@/lib/receipts/pdf';
import { supabaseServer } from '@/lib/supabase/server';

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-CA', { timeZone: serverEnv.timeZone, year: 'numeric', month: 'long', day: 'numeric' });

// Invoice PDF for a paid subscription year, for the restaurant's owner or admins (RLS decides).
export async function GET(req: NextRequest, ctx: RouteContext<'/api/restaurant/subscription/[id]/invoice'>) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
  const supabase = await supabaseServer();
  const { data: p } = await supabase.from('subscription_payments').select('*, restaurants(name, address, city, zip, phone)').eq('id', Number(id)).eq('status', 'paid').maybeSingle();
  if (!p?.restaurants || !p.invoice_number || !p.paid_at || !p.period_start || !p.period_end) {
    return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  }
  const pdf = await subscriptionInvoicePdf({
    invoiceNumber: p.invoice_number,
    paidText: day(p.paid_at),
    periodText: `${day(p.period_start)} to ${day(p.period_end)}`,
    complimentary: p.kind === 'complimentary',
    cardLabel: p.card_label,
    feeCents: p.fee_cents,
    taxRateBps: p.tax_rate_bps,
    taxCents: p.tax_cents,
    totalCents: p.total_cents,
    note: p.note,
    restaurant: p.restaurants,
    seller: { ...serverEnv.legal, hstNumber: serverEnv.hstNumber },
  });
  const disposition = req.nextUrl.searchParams.has('inline') ? 'inline' : 'attachment';
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="LastBite-invoice-${p.invoice_number}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
