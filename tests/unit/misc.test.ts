import { describe, expect, it } from 'vitest';
import { code128, PATTERNS } from '@/lib/code128';
import { distanceKm } from '@/lib/geo';
import { money, pct, timeLeft } from '@/lib/format';
import { DOCUMENTS, renderDocument, requiredDocuments } from '@/lib/legal/documents';
import { dayRange, todayIn } from '@/lib/receipts/time';

describe('geo', () => {
  it('computes haversine distances in kilometres', () => {
    // Downtown St. John's to Mount Pearl City Hall: about 8.5 km.
    expect(distanceKm(47.5615, -52.7126, 47.5189, -52.8058)).toBeCloseTo(8.45, 1);
    expect(distanceKm(47.56, -52.71, 47.56, -52.71)).toBe(0);
  });
});

describe('code128', () => {
  it('encodes with start, checksum and stop symbols', () => {
    const bars = code128('LB-20260929-000064');
    // 18 characters + start + checksum + stop; each symbol is 11 modules, the stop is 13.
    expect(bars.reduce((a, b) => a + b, 0)).toBe(20 * 11 + 13);
    expect(PATTERNS).toHaveLength(107);
    expect(() => code128('é')).toThrow();
  });
});

describe('format', () => {
  it('formats money, rates and timers', () => {
    expect(money(1957)).toBe('$19.57');
    expect(pct(1035)).toBe('10.35%');
    expect(pct(500)).toBe('5%');
    const now = Date.parse('2026-09-29T12:00:00Z');
    expect(timeLeft('2026-09-29T14:05:00Z', now)).toBe('2h 05m');
    expect(timeLeft('2026-09-29T12:04:09Z', now)).toBe('4:09');
    expect(timeLeft('2026-09-29T11:00:00Z', now)).toBe('Expired');
  });
});

describe('Pacific time days', () => {
  it('handles daylight saving time', () => {
    expect(dayRange('2026-07-01', 'America/Los_Angeles')).toEqual({ start: '2026-07-01T07:00:00.000Z', end: '2026-07-02T07:00:00.000Z' });
    expect(dayRange('2026-12-01', 'America/Los_Angeles')).toEqual({ start: '2026-12-01T08:00:00.000Z', end: '2026-12-02T08:00:00.000Z' });
    expect(todayIn('America/Los_Angeles', new Date('2026-09-30T05:00:00Z'))).toBe('2026-09-29');
  });
});

describe('legal documents', () => {
  const company = { entity: 'Last Bite <LLC>', email: 'help@example.com', address: "St. John's", serviceFeePct: 5, graceMinutes: 10, subscriptionFeeCents: 10000, subscriptionTaxPct: 15 };
  it('lists what each role must accept', () => {
    expect(requiredDocuments('customer').map((d) => d.id)).toEqual(['customer-terms', 'privacy']);
    expect(requiredDocuments('restaurant').map((d) => d.id)).toEqual(['restaurant-agreement', 'privacy']);
  });
  it('renders with escaped company details and the live service fee', () => {
    const doc = renderDocument('customer-terms', company)!;
    expect(doc.version).toBe(DOCUMENTS['customer-terms'].version);
    expect(doc.html).toContain('Last Bite &lt;LLC&gt;');
    expect(doc.html).toContain('currently 5% of the food subtotal');
    const agreement = renderDocument('restaurant-agreement', company)!;
    expect(agreement.html).toContain('Stripe Connect');
    expect(agreement.html).toContain('<b>$100 per year</b> plus HST (currently 15%)');
    expect(agreement.version).toBe(DOCUMENTS['restaurant-agreement'].version);
    expect(renderDocument('nope', company)).toBeNull();
  });
});
