import 'server-only';
import { serverEnv } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { renderDocument, type Company } from './documents';

// Company details and live settings (service fee, subscription price) used in the legal documents.
export async function company(): Promise<Company> {
  const { data } = await supabaseAdmin().from('settings').select('key, value').in('key', ['service_fee_bps', 'subscription_fee_cents', 'default_tax_rate_bps']);
  const get = (k: string, d: number) => Number(data?.find((r) => r.key === k)?.value ?? d);
  return {
    ...serverEnv.legal,
    serviceFeePct: get('service_fee_bps', 500) / 100,
    graceMinutes: serverEnv.pickupGraceMinutes,
    subscriptionFeeCents: get('subscription_fee_cents', 10000),
    subscriptionTaxPct: get('default_tax_rate_bps', 1500) / 100,
  };
}

export async function legalDocument(id: string) {
  return renderDocument(id, await company());
}
