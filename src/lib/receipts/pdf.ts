import 'server-only';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { code128 } from '@/lib/code128';
import { money, pct } from '@/lib/format';
import type { Receipt, Report } from './data';

// PDF receipts (80 mm point-of-sale roll) and daily reports (landscape letter).
// WOFF fonts (not WOFF2): pdfkit's font subsetter can fail on WOFF2 input.
const FONT_DIR = path.join(process.cwd(), 'assets', 'pdf-fonts');
const FONTS = {
  regular: 'inter-latin-400-normal.woff',
  medium: 'inter-latin-600-normal.woff',
  bold: 'inter-latin-700-normal.woff',
  head: 'plus-jakarta-sans-latin-800-normal.woff',
  mono: 'IBMPlexMono-Regular.woff',
  monoMedium: 'IBMPlexMono-SemiBold.woff',
  monoBold: 'IBMPlexMono-Bold.woff',
};
const LOGO = path.join(process.cwd(), 'public', 'assets', 'logo.png');
const LOGO_RATIO = 400 / 1706;
const GREEN = '#C2410C'; // brand accent on paper
const INK = '#0b1b14';
const MUTED = '#6b7b73';
const LINE = '#dfe7e2';
const ROLL_WIDTH = 226.77; // 80 mm receipt roll
const ROLL_MARGIN = 14;

type Doc = PDFKit.PDFDocument;

function fonts(doc: Doc) {
  for (const [name, file] of Object.entries(FONTS)) doc.registerFont(name, path.join(FONT_DIR, file));
}

function finish(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

// ---------------------------------------------------------------- POS receipt

// Draws the thermal-style receipt in black ink and returns the y position where it ends.
function drawPosReceipt(doc: Doc, rc: Receipt) {
  const L = ROLL_MARGIN;
  const R = ROLL_WIDTH - ROLL_MARGIN;
  const W = R - L;
  const it = rc.item;
  let y = ROLL_MARGIN + 4;

  const center = (text: string, font: string, size: number, opts: { spacing?: number; after?: number } = {}) => {
    doc.font(font).fontSize(size).fillColor('#000');
    doc.text(text, L, y, { width: W, align: 'center', lineGap: 1, characterSpacing: opts.spacing ?? 0 });
    y = doc.y + (opts.after ?? 2);
  };
  const dashes = (gap = 7) => {
    y += gap - 4;
    doc.moveTo(L, y).lineTo(R, y).lineWidth(0.7).dash(2.2, { space: 1.8 }).strokeColor('#000').stroke().undash();
    y += gap;
  };
  const double = () => {
    y += 3;
    doc.moveTo(L, y).lineTo(R, y).moveTo(L, y + 2).lineTo(R, y + 2).lineWidth(0.6).strokeColor('#000').stroke();
    y += 8;
  };
  // Label on the left (wraps), amount on the right.
  const row = (left: string, right: string, opts: { size?: number; bold?: boolean; indent?: number; strikeRight?: boolean; after?: number } = {}) => {
    const size = opts.size ?? 8;
    const indent = opts.indent ?? 0;
    doc.font(opts.bold ? 'monoBold' : 'mono').fontSize(size).fillColor('#000');
    const rw = right ? doc.widthOfString(right) : 0;
    doc.text(left, L + indent, y, { width: W - rw - 8 - indent, lineGap: 0.5 });
    const endY = doc.y;
    if (right) {
      doc.text(right, R - rw, y, { width: rw + 1, lineBreak: false });
      if (opts.strikeRight) doc.moveTo(R - rw, y + size * 0.62).lineTo(R, y + size * 0.62).lineWidth(0.7).strokeColor('#000').stroke();
    }
    y = Math.max(endY, y + size * 1.3) + (opts.after ?? 1.5);
  };
  const small = (text: string, opts: { size?: number; indent?: number; align?: 'left' | 'center'; after?: number } = {}) => {
    doc.font('mono').fontSize(opts.size ?? 6.8).fillColor('#000');
    doc.text(text, L + (opts.indent ?? 0), y, { width: W - (opts.indent ?? 0), align: opts.align ?? 'left', lineGap: 0.5 });
    y = doc.y + (opts.after ?? 1.5);
  };

  // Header: logo, restaurant, address.
  const logoW = 140;
  doc.image(LOGO, L + (W - logoW) / 2, y, { width: logoW });
  y += logoW * LOGO_RATIO + 4;
  center("RESCUED FOOD · ST. JOHN'S, NL", 'mono', 6.2, { spacing: 0.4, after: 7 });
  center(rc.restaurant.name.toUpperCase(), 'monoBold', 9.5, { after: 1 });
  center(`${rc.restaurant.address}\n${rc.restaurant.city}, NL ${rc.restaurant.zip}${rc.restaurant.phone ? `\nTel ${rc.restaurant.phone}` : ''}`, 'mono', 7.2, { after: 2 });
  dashes();

  // Order facts.
  row('RECEIPT', rc.receiptNumber);
  row('ORDER #', String(rc.orderId));
  row('ORDERED', rc.orderedAtText);
  if (rc.status === 'picked_up') row('PICKED UP', rc.pickedUpAtText);
  else row('PICK UP BY', rc.pickupByText);
  row('CUSTOMER', rc.customer.username);
  row('STATUS', rc.statusLabel.toUpperCase(), { bold: true });
  dashes();

  // Item line.
  row(`${it.quantity} x ${it.title}`, money(it.lineTotalCents), { bold: true, size: 8.4, after: 1 });
  row(`@ ${money(it.unitPriceCents)} ea  (-${it.discountPct}%)`, money(it.lineOriginalCents), { indent: 12, size: 7.2, strikeRight: true, after: 0 });
  small(`Reg. ${money(it.originalUnitCents)} ea, you save ${money(it.savingsCents)}`, { indent: 12, size: 6.6 });
  dashes();

  // Totals.
  row('MENU VALUE', money(it.lineOriginalCents));
  row(`DISCOUNT ${it.discountPct}%`, money(-it.savingsCents));
  row('SUBTOTAL', money(rc.subtotalCents));
  row(`SERVICE FEE ${rc.serviceFeePct}%`, money(rc.serviceFeeCents));
  row(`HST ${pct(rc.taxRateBps)}`, money(rc.taxCents));
  double();
  row('TOTAL', money(rc.totalCents), { bold: true, size: 11.5, after: 3 });
  if (rc.creditAppliedCents) {
    row('PLATFORM CREDIT', money(-rc.creditAppliedCents));
    row('BALANCE TO CARD', money(rc.totalCents - rc.creditAppliedCents), { bold: true });
  }
  dashes();

  // Payment.
  const paidWith = rc.creditAppliedCents
    ? rc.creditAppliedCents >= rc.totalCents ? 'Platform credit' : `${rc.card} + credit`
    : rc.card || 'n/a';
  row('PAID WITH', paidWith);
  row('CHARGED', money(rc.amountChargedCents), { bold: true });
  small(`PAYMENT: ${rc.paymentStatus}`);
  small(`TXN ID: ${rc.paymentRef || 'n/a'}`);

  if (rc.refunds.length) {
    dashes();
    center('*** REFUNDS ***', 'monoBold', 8, { after: 3 });
    for (const f of rc.refunds) {
      row('REFUND', money(-f.amountCents), { bold: true, after: 0.5 });
      small(`To ${f.to}`, { indent: 8 });
      small(`${f.atText} · ${f.reason}`, { indent: 8, after: 3 });
    }
  }
  dashes();

  // Savings banner, printed white on black like a thermal "reverse" line.
  doc.rect(L, y, W, 17).fill('#000');
  doc.font('monoBold').fontSize(8).fillColor('#fff').text(`YOU SAVED ${money(it.savingsCents)} TODAY!`, L, y + 4.5, { width: W, align: 'center', lineBreak: false });
  y += 23;
  center(`${it.quantity === 1 ? '1 meal' : `${it.quantity} meals`} rescued from going to waste`, 'mono', 6.8, { after: 4 });

  if (rc.pin) {
    dashes();
    center('PICKUP PIN', 'monoBold', 7.5, { spacing: 1, after: 3 });
    doc.rect(L + W / 2 - 58, y, 116, 30).lineWidth(1.2).strokeColor('#000').stroke();
    doc.font('monoBold').fontSize(19).fillColor('#000').text(rc.pin.split('').join(' '), L, y + 6, { width: W, align: 'center', lineBreak: false });
    y += 36;
    center('Show this PIN at the counter', 'mono', 6.8, { after: 2 });
  }
  dashes();

  // Barcode of the receipt number.
  const bars = rc.barcode ?? code128(rc.receiptNumber);
  const modules = bars.reduce((a, b) => a + b, 0);
  const mw = Math.min(1.1, (W - 16) / modules);
  let bx = L + (W - modules * mw) / 2;
  bars.forEach((w, i) => {
    if (i % 2 === 0) doc.rect(bx, y, w * mw, 30).fill('#000');
    bx += w * mw;
  });
  y += 33;
  center(rc.receiptNumber, 'mono', 7, { spacing: 1.2, after: 8 });

  center('THANK YOU FOR RESCUING FOOD!', 'monoBold', 8, { after: 4 });
  small('Your card is authorized when you order and charged only when the restaurant confirms pickup with your PIN. '
    + 'Orders not picked up are released without charge. Times in Newfoundland Time.', { align: 'center', size: 6.2, after: 3 });
  center('support@lastbite.ca', 'mono', 6.6, { after: 0 });
  return y;
}

// Point-of-sale style receipt: an 80 mm thermal roll, as tall as the content needs.
export function receiptPdf(rc: Receipt) {
  // First pass measures the height, second pass draws on a page cut to fit.
  const probe = new PDFDocument({ size: [ROLL_WIDTH, 5000], margin: 0 });
  fonts(probe);
  const height = Math.ceil(drawPosReceipt(probe, rc) + ROLL_MARGIN);
  const doc = new PDFDocument({ size: [ROLL_WIDTH, height], margin: 0, info: { Title: `Last Bite receipt ${rc.receiptNumber}`, Author: 'Last Bite' } });
  fonts(doc);
  drawPosReceipt(doc, rc);
  return finish(doc);
}

// ---------------------------------------------------------------- daily report

function label(doc: Doc, text: string, x: number, y: number, opts: PDFKit.Mixins.TextOptions = {}) {
  doc.font('bold').fontSize(7.5).fillColor(MUTED).text(text, x, y, { characterSpacing: 0.8, ...opts });
}

function rule(doc: Doc, x1: number, x2: number, y: number) {
  doc.moveTo(x1, y).lineTo(x2, y).lineWidth(1).strokeColor(LINE).stroke();
}

export function reportPdf(rep: Report) {
  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 40, info: { Title: `Last Bite daily report ${rep.date}`, Author: 'Last Bite' } });
  fonts(doc);
  const L = 40;
  const R = doc.page.width - 40;
  const W = R - L;
  doc.image(LOGO, L, 34, { height: 38 });
  doc.font('head').fontSize(18).fillColor(INK).text('Daily sales report', L, 36, { width: W, align: 'right' });
  doc.font('regular').fontSize(9.5).fillColor(MUTED).text(`${rep.restaurant.name} · ${rep.dateText}`, L, 60, { width: W, align: 'right' });
  doc.text(`${rep.restaurant.address}, ${rep.restaurant.city}, NL ${rep.restaurant.zip}${rep.restaurant.phone ? ` · ${rep.restaurant.phone}` : ''}`, L, 74, { width: W, align: 'right' });
  rule(doc, L, R, 96);

  const s = rep.summary;
  const cards: [string, string][] = [
    ['Food sales', money(s.foodSalesCents)], ['Orders picked up', String(s.ordersPickedUp)], ['Meals rescued', String(s.mealsRescued)],
    ['Discounts given', money(s.discountsCents)], ['HST', money(s.salesTaxCents)], ['Total charged', money(s.totalChargedCents)],
  ];
  const cw = (W - 5 * 8) / 6;
  cards.forEach(([k, v], i) => {
    const x = L + i * (cw + 8);
    doc.roundedRect(x, 108, cw, 50, 8).fill('#f2f7f4');
    label(doc, k.toUpperCase(), x + 10, 116, { width: cw - 16 });
    doc.font('head').fontSize(15).fillColor(i === 0 ? GREEN : INK).text(v, x + 10, 131, { width: cw - 16 });
  });
  doc.font('regular').fontSize(9).fillColor(MUTED).text(
    `Menu value ${money(s.menuValueCents)} · Last Bite service fees paid by customers ${money(s.serviceFeesCents)} · `
      + `Awaiting pickup ${s.awaitingPickup} · Cancelled ${s.cancelled} · Not picked up ${s.notPickedUp}`,
    L, 168, { width: W },
  );

  const cols: [string, number, 'left' | 'right'][] = [
    ['#', 30, 'left'], ['Ordered', 52, 'left'], ['Picked up', 56, 'left'], ['Customer', 64, 'left'], ['Item', 128, 'left'], ['Qty', 28, 'right'],
    ['Original', 52, 'right'], ['Disc.', 36, 'right'], ['Price', 50, 'right'], ['Food', 54, 'right'], ['Tax', 46, 'right'], ['Total', 54, 'right'],
  ];
  cols.push(['Status', W - cols.reduce((n, c) => n + c[1], 0), 'left']);
  let y = 192;
  const header = () => {
    let x = L;
    doc.rect(L, y - 6, W, 20).fill('#0b1b14');
    for (const [h, w, a] of cols) {
      doc.font('bold').fontSize(8).fillColor('#ffffff').text(h.toUpperCase(), x + 3, y, { width: w - 6, align: a });
      x += w;
    }
    y += 20;
  };
  header();
  if (!rep.orders.length) doc.font('regular').fontSize(10).fillColor(MUTED).text('No orders on this day.', L, y + 6);
  rep.orders.forEach((o, i) => {
    if (y > doc.page.height - 60) {
      doc.addPage();
      y = 40;
      header();
    }
    if (i % 2) doc.rect(L, y - 4, W, 18).fill('#f6f9f7');
    const vals = [String(o.id), o.orderedTime, o.pickedUpTime || '-', o.customer, o.item, String(o.quantity), money(o.originalUnitCents),
      `${o.discountPct}%`, money(o.unitPriceCents), money(o.subtotalCents), money(o.taxCents), money(o.totalCents), o.statusLabel];
    let x = L;
    cols.forEach(([, w, a], j) => {
      doc.font(j === 4 ? 'medium' : 'regular').fontSize(8.5).fillColor(o.status === 'picked_up' || j !== 12 ? INK : MUTED)
        .text(vals[j], x + 3, y, { width: w - 6, align: a, lineBreak: false, ellipsis: true });
      x += w;
    });
    y += 18;
  });
  doc.font('regular').fontSize(8).fillColor(MUTED).text(
    `Sales totals include orders picked up (and charged) on this day. Times in Newfoundland Time. Generated ${rep.generatedAtText}.`,
    L, doc.page.height - 50, { width: W, lineBreak: false },
  );
  return finish(doc);
}

// ---------------------------------------------------------------- subscription invoice

export type SubscriptionInvoice = {
  invoiceNumber: string;
  paidText: string;
  periodText: string;
  complimentary: boolean;
  cardLabel: string;
  feeCents: number;
  taxRateBps: number;
  taxCents: number;
  totalCents: number;
  note: string;
  restaurant: { name: string; address: string; city: string; zip: string; phone: string };
  seller: { entity: string; address: string; email: string; hstNumber: string };
};

// Invoice for one year of the partner subscription (portrait letter).
export function subscriptionInvoicePdf(inv: SubscriptionInvoice) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 50, info: { Title: `Last Bite invoice ${inv.invoiceNumber}`, Author: 'Last Bite' } });
  fonts(doc);
  const L = 50;
  const R = doc.page.width - 50;
  const W = R - L;
  doc.image(LOGO, L, 46, { height: 40 });
  doc.font('head').fontSize(22).fillColor(INK).text('Invoice', L, 46, { width: W, align: 'right' });
  doc.font('regular').fontSize(9.5).fillColor(MUTED).text(inv.invoiceNumber, L, 74, { width: W, align: 'right' });
  rule(doc, L, R, 104);

  const half = W / 2 - 10;
  label(doc, 'FROM', L, 120);
  doc.font('bold').fontSize(10.5).fillColor(INK).text(inv.seller.entity, L, 134, { width: half });
  doc.font('regular').fontSize(9.5).fillColor(INK).text([inv.seller.address, inv.seller.email, inv.seller.hstNumber && `HST registration: ${inv.seller.hstNumber}`].filter(Boolean).join('\n'), { width: half, lineGap: 2 });
  label(doc, 'BILL TO', L + half + 20, 120);
  const r = inv.restaurant;
  doc.font('bold').fontSize(10.5).fillColor(INK).text(r.name, L + half + 20, 134, { width: half });
  doc.font('regular').fontSize(9.5).fillColor(INK).text([r.address, `${r.city}, NL ${r.zip}`, r.phone].filter(Boolean).join('\n'), { width: half, lineGap: 2 });

  let y = 220;
  const facts: [string, string][] = [['DATE', inv.paidText], ['SERVICE PERIOD', inv.periodText], ['PAYMENT', inv.complimentary ? 'Complimentary' : inv.cardLabel || 'Card']];
  const fw = (W - 16) / 3;
  facts.forEach(([k, v], i) => {
    const x = L + i * (fw + 8);
    doc.roundedRect(x, y, fw, 46, 8).fill('#fff4ec');
    label(doc, k, x + 10, y + 9, { width: fw - 20 });
    doc.font('medium').fontSize(9.5).fillColor(INK).text(v, x + 10, y + 23, { width: fw - 20 });
  });

  y += 76;
  doc.rect(L, y, W, 22).fill(INK);
  doc.font('bold').fontSize(8.5).fillColor('#ffffff').text('DESCRIPTION', L + 10, y + 7);
  doc.text('AMOUNT', L, y + 7, { width: W - 10, align: 'right' });
  y += 32;
  const line = (text: string, amount: string, opts: { bold?: boolean; size?: number; muted?: boolean } = {}) => {
    doc.font(opts.bold ? 'bold' : 'regular').fontSize(opts.size ?? 10).fillColor(opts.muted ? MUTED : INK);
    doc.text(text, L + 10, y, { width: W - 140 });
    doc.text(amount, L, y, { width: W - 10, align: 'right' });
    y = Math.max(doc.y, y + 14) + 8;
  };
  line('Last Bite partner subscription, 1 year', money(inv.feeCents), { bold: true });
  doc.font('regular').fontSize(8.5).fillColor(MUTED).text(
    'Access to the Last Bite marketplace and Partner Portal: posting surplus food offers, order alerts, PIN-verified pickups, Stripe Connect payouts and daily sales reports. No commission on food sales.',
    L + 10, y - 4, { width: W - 160, lineGap: 1.5 },
  );
  y = doc.y + 12;
  rule(doc, L, R, y);
  y += 12;
  line('Subtotal', money(inv.feeCents));
  line(`HST (${pct(inv.taxRateBps)})`, money(inv.taxCents));
  rule(doc, L + W / 2, R, y - 2);
  y += 6;
  line(inv.complimentary ? 'Total (complimentary)' : 'Total paid (CAD)', money(inv.totalCents), { bold: true, size: 13 });
  if (inv.note) line(`Note: ${inv.note}`, '', { muted: true, size: 9 });

  doc.font('regular').fontSize(8).fillColor(MUTED).text(
    `Thank you for rescuing good food with Last Bite. Questions about this invoice: ${inv.seller.email}. `
      + 'The subscription is governed by section 5.3 of the Restaurant Partner Agreement. Times in Newfoundland Time.',
    L, doc.page.height - 90, { width: W, align: 'center', lineGap: 1.5 },
  );
  return finish(doc);
}

// ---------------------------------------------------------------- signed Partner Agreement

export type SignedAgreement = {
  title: string;
  version: string;
  effective: string;
  html: string;
  fingerprint: string;
  restaurant: { name: string; address: string; city: string; zip: string };
  signer: { username: string; email: string };
  acceptance: { atText: string; version: string; ip: string; userAgent: string } | null;
  countersign: { entity: string; atText: string | null };
  generatedText: string;
};

const decode = (s: string) =>
  s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// The agreement's HTML (headings, paragraphs, lists, bold) as blocks of text runs.
function agreementBlocks(html: string) {
  const blocks: { kind: 'h2' | 'p' | 'li'; runs: { text: string; bold: boolean }[] }[] = [];
  for (const m of html.matchAll(/<(h2|p|li)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const runs: { text: string; bold: boolean }[] = [];
    let bold = false;
    for (const part of m[2].split(/(<\/?b>)/)) {
      if (part === '<b>') bold = true;
      else if (part === '</b>') bold = false;
      else {
        const text = decode(part.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ');
        if (text.trim()) runs.push({ text, bold });
      }
    }
    if (runs.length) {
      runs[0].text = runs[0].text.trimStart();
      blocks.push({ kind: m[1] as 'h2' | 'p' | 'li', runs });
    }
  }
  return blocks;
}

// A copy of the Restaurant Partner Agreement with the record of the owner's electronic acceptance
// and Last Bite's countersignature (on approval). Portrait letter, numbered pages.
export function signedAgreementPdf(a: SignedAgreement) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 54, bufferPages: true, info: { Title: `${a.title} (signed) - ${a.restaurant.name}`, Author: 'Last Bite' } });
  fonts(doc);
  const L = 54;
  const R = doc.page.width - 54;
  const W = R - L;
  const bottom = () => doc.page.height - 70;

  doc.image(LOGO, L, 48, { height: 34 });
  doc.font('head').fontSize(18).fillColor(INK).text(a.title, L, 48, { width: W, align: 'right' });
  doc.font('regular').fontSize(9).fillColor(MUTED).text(`Version ${a.version} · effective ${a.effective} · signed copy`, L, 72, { width: W, align: 'right' });
  rule(doc, L, R, 96);
  doc.font('regular').fontSize(9.5).fillColor(INK).text(
    `Between ${a.countersign.entity} ("Last Bite") and ${a.restaurant.name}, ${a.restaurant.address}, ${a.restaurant.city}, NL ${a.restaurant.zip} (the "Partner"). `
      + 'The electronic signature record is on the last page.',
    L, 108, { width: W },
  );
  doc.moveDown(0.8);

  const ensure = (h: number) => {
    if (doc.y + h > bottom()) {
      doc.addPage();
      doc.y = 60;
    }
  };
  for (const b of agreementBlocks(a.html)) {
    const x = b.kind === 'li' ? L + 14 : L;
    const width = b.kind === 'li' ? W - 14 : W;
    const size = b.kind === 'h2' ? 12 : 9.2;
    ensure(b.kind === 'h2' ? 40 : 24);
    if (b.kind === 'h2') doc.moveDown(0.5);
    if (b.kind === 'li') doc.font('bold').fontSize(size).fillColor(GREEN).text('•', L + 3, doc.y, { lineBreak: false });
    const y = doc.y;
    b.runs.forEach((r, i) => {
      doc.font(b.kind === 'h2' || r.bold ? 'bold' : 'regular').fontSize(size).fillColor(INK);
      const last = i === b.runs.length - 1;
      if (i === 0) doc.text(r.text, x, y, { width, lineGap: 1.6, continued: !last });
      else doc.text(r.text, { width, lineGap: 1.6, continued: !last });
    });
    doc.moveDown(b.kind === 'h2' ? 0.3 : 0.45);
  }

  // Signature record
  doc.addPage();
  doc.font('head').fontSize(16).fillColor(INK).text('Electronic signature record', L, 60);
  doc.font('regular').fontSize(9.5).fillColor(MUTED).text(
    'The Partner accepted this Agreement electronically in the Last Bite sign-up form by scrolling through it and selecting "I agree" '
      + 'before creating the restaurant account. Under Newfoundland and Labrador\'s Electronic Commerce Act, that acceptance has the same effect as a signature.',
    L, 86, { width: W, lineGap: 1.5 },
  );
  let y = doc.y + 16;
  const row = (k: string, v: string) => {
    doc.font('bold').fontSize(8).fillColor(MUTED).text(k.toUpperCase(), L, y, { width: 150, characterSpacing: 0.6 });
    doc.font('regular').fontSize(10).fillColor(INK).text(v || '-', L + 160, y - 1, { width: W - 160, lineGap: 1.5 });
    y = Math.max(doc.y, y + 12) + 10;
  };
  const box = (title: string, rows: [string, string][]) => {
    doc.roundedRect(L, y, W, 26, 6).fill('#fff4ec');
    doc.font('bold').fontSize(10.5).fillColor(INK).text(title, L + 12, y + 8);
    y += 38;
    for (const [k, v] of rows) row(k, v);
    y += 6;
  };
  box('Signed by the Partner', [
    ['Partner', `${a.restaurant.name}, ${a.restaurant.address}, ${a.restaurant.city}, NL ${a.restaurant.zip}`],
    ['Signed by', `${a.signer.username} (${a.signer.email}), owner account`],
    ['Accepted on', a.acceptance ? `${a.acceptance.atText} (Newfoundland Time)` : 'No acceptance on record'],
    ['Version accepted', a.acceptance ? a.acceptance.version + (a.acceptance.version === a.version ? '' : ` (this copy shows version ${a.version})`) : ''],
    ['IP address', a.acceptance?.ip ?? ''],
    ['Device', a.acceptance?.userAgent ?? ''],
  ]);
  box('Countersigned by Last Bite', [
    ['Company', a.countersign.entity],
    ['Approved on', a.countersign.atText ? `${a.countersign.atText} (Newfoundland Time)` : 'Not approved yet'],
  ]);
  box('Document', [
    ['Title', `${a.title}, version ${a.version}, effective ${a.effective}`],
    ['SHA-256 fingerprint', a.fingerprint],
    ['Copy generated', `${a.generatedText} (Newfoundland Time)`],
  ]);
  doc.font('regular').fontSize(8).fillColor(MUTED).text(
    'The fingerprint identifies the exact text of this version: any change to the text gives a different fingerprint. Last Bite keeps the acceptance record '
      + '(time, IP address and device) for as long as the Agreement is in force and as required by law.',
    L, y + 4, { width: W, lineGap: 1.4 },
  );

  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // the footer sits below the text area; don't let it start a new page
    doc.font('regular').fontSize(7.5).fillColor(MUTED).text(
      `${a.title} · ${a.restaurant.name} · signed copy · page ${i + 1} of ${pages.count}`,
      L, doc.page.height - 44, { width: W, align: 'center', lineBreak: false },
    );
  }
  return finish(doc);
}
