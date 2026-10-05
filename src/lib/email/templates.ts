import { publicEnv } from '@/lib/env';

// Restaurant onboarding emails. Email apps ignore most CSS, so these are tables with inline styles,
// matching supabase/templates/confirmation.html (the sign-up email).

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);

const FONT = 'Arial,Helvetica,sans-serif';

function button(href: string, label: string, color = '#E65F00') {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px auto;"><tr>
<td align="center" bgcolor="${color}" style="border-radius:999px;background:${color};">
<a href="${esc(href)}" style="display:inline-block;padding:15px 30px;font:800 16px ${FONT};color:#FFFFFF;text-decoration:none;border-radius:999px;">${label}</a>
</td></tr></table>`;
}

function layout({ preheader, emoji, title, subtitle, body, email }: { preheader: string; emoji: string; title: string; subtitle: string; body: string; email: string }) {
  const site = publicEnv.siteUrl;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#FFF7ED;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#FFF7ED;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFF7ED;"><tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;">
<tr><td align="center" style="padding:0 0 22px;"><a href="${site}" style="text-decoration:none;">
<img src="${site}/assets/email-logo.png" width="280" height="58" alt="Last Bite" style="display:block;width:280px;height:auto;border:0;font:800 26px ${FONT};color:#E65F00;"></a></td></tr>
<tr><td style="background:#FFFFFF;border-radius:24px;overflow:hidden;box-shadow:0 8px 30px rgba(194,65,12,0.10);">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td bgcolor="#FF6B00" style="background:#FF6B00;background-image:linear-gradient(135deg,#FDBA74 0%,#FF6B00 50%,#C2410C 100%);border-radius:24px 24px 0 0;padding:34px 32px 30px;text-align:center;">
<div style="font-size:46px;line-height:1;">${emoji}</div>
<h1 style="margin:14px 0 0;font:800 27px/1.2 ${FONT};color:#FFFFFF;">${title}</h1>
<p style="margin:10px 0 0;font:600 16px/1.5 ${FONT};color:#FFF7ED;">${subtitle}</p></td></tr>
<tr><td style="padding:30px 34px 28px;font:16px/1.6 ${FONT};color:#1C1917;">${body}</td></tr>
</table></td></tr>
<tr><td align="center" style="padding:22px 20px 0;font:12px/1.6 ${FONT};color:#A8A29E;">
You're getting this email because ${esc(email)} registered a restaurant on Last Bite.<br>
<b style="color:#78716C;">Last Bite</b> · Good food, saved · St. John's, NL · <a href="mailto:support@lastbite.ca" style="color:#A8A29E;">support@lastbite.ca</a>
</td></tr></table></td></tr></table></body></html>`;
}

const p = (html: string) => `<p style="margin:0 0 14px;">${html}</p>`;
const h2 = (text: string) => `<h2 style="margin:22px 0 8px;font:800 18px/1.3 ${FONT};color:#1C1917;">${text}</h2>`;
const list = (items: string[]) =>
  `<ul style="margin:0 0 14px;padding-left:20px;">${items.map((i) => `<li style="margin:0 0 6px;">${i}</li>`).join('')}</ul>`;

export type OnboardingInfo = { username: string; email: string; restaurant: string };

// Sent once the owner has verified their email address, while the restaurant waits for approval.
export function pendingEmail(i: OnboardingInfo) {
  const portal = `${publicEnv.siteUrl}/restaurant`;
  const html = layout({
    email: i.email,
    preheader: `${i.restaurant} is now waiting for approval.`,
    emoji: '⏳',
    title: 'Your application is in review',
    subtitle: `Thanks for verifying your email, ${esc(i.username)}.`,
    body:
      p(`We've received the application for <b>${esc(i.restaurant)}</b>. The Last Bite team reviews every restaurant before its offers go live, usually within one business day.`)
      + p(`As soon as you're approved we'll email you a welcome pack with your <b>signed Restaurant Partner Agreement</b> and your restaurant's own <b>kiosk link</b> for your counter tablet.`)
      + h2('While you wait, you can')
      + list([
        '<b>Add your menu</b> with photos, so posting surplus food takes seconds.',
        '<b>Set up payouts</b> with Stripe (Payouts tab), so your sales reach your bank.',
        '<b>Activate your subscription</b> ($100 a year plus HST, Subscription tab). If we can\'t approve your restaurant, we refund it in full.',
      ])
      + button(portal, 'Open my Partner Portal'),
  });
  const text = `Your application is in review

Thanks for verifying your email, ${i.username}. We've received the application for ${i.restaurant}. The Last Bite team reviews every restaurant before its offers go live, usually within one business day.

As soon as you're approved we'll email you your signed Restaurant Partner Agreement and your restaurant's kiosk link.

While you wait: add your menu, set up payouts with Stripe, and activate your subscription ($100 a year plus HST; refunded in full if we can't approve your restaurant).

Partner Portal: ${portal}

Last Bite · St. John's, NL · support@lastbite.ca`;
  return { subject: `We've received your Last Bite application for ${i.restaurant}`, html, text };
}

// Sent when Last Bite approves the restaurant (and again when the owner asks for it in the portal).
export function welcomeEmail(i: OnboardingInfo & { kioskUrl: string; androidUrl: string; ipadUrl: string; subscriptionActive: boolean; payoutsReady: boolean }) {
  const portal = `${publicEnv.siteUrl}/restaurant`;
  const next = [
    ...(i.subscriptionActive ? [] : [`<b>Activate your subscription</b> ($100 a year plus HST) in the <a href="${portal}?tab=subscription" style="color:#E65F00;">Subscription tab</a>, so you can post offers.`]),
    ...(i.payoutsReady ? [] : [`<b>Set up payouts</b> with Stripe in the <a href="${portal}?tab=payouts" style="color:#E65F00;">Payouts tab</a>.`]),
    '<b>Post your first surplus food</b> from the kiosk or the Partner Portal. Customers nearby see it right away.',
  ];
  const html = layout({
    email: i.email,
    preheader: `${i.restaurant} is approved. Your kiosk link and signed agreement are inside.`,
    emoji: '🎉',
    title: `Welcome to Last Bite, ${esc(i.restaurant)}!`,
    subtitle: 'You\'re approved. Let\'s rescue some good food.',
    body:
      p(`Hi ${esc(i.username)}, great news: <b>${esc(i.restaurant)}</b> is approved and live on Last Bite.`)
      + p('📎 Your <b>electronically signed Restaurant Partner Agreement</b> is attached as a PDF. Keep it for your records.')
      + h2('Your restaurant kiosk')
      + p('Your counter tablet gets its own kiosk: staff type the customer\'s pickup PIN, hear a bell for every new order, and post surplus food in a few taps. Open this email <b>on the tablet</b> and tap the button for it:')
      + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="center" style="padding:4px;">${button(i.androidUrl, '🤖 Download for Android tablet', '#1C1917')}</td></tr><tr>
<td align="center" style="padding:4px;">${button(i.ipadUrl, '📱 Download for iPad', '#1C1917')}</td></tr></table>`
      + `<p style="margin:10px 0 14px;font-size:13px;color:#57534E;"><b>Android:</b> tap <b>Install</b> and the kiosk icon appears on the home screen.
<b>iPad:</b> tap <b>Download</b>, then in <b>Settings › Profile Downloaded</b> tap <b>Install</b>. Then tap the icon to open your kiosk.</p>`
      + p(`Your kiosk link: <a href="${esc(i.kioskUrl)}" style="color:#E65F00;word-break:break-all;">${esc(i.kioskUrl)}</a>`)
      + `<p style="margin:0 0 14px;font-size:13px;color:#57534E;">🔒 Keep this link private: it's the key to your kiosk. You can reset it any time in the Partner Portal (Kiosk tab).</p>`
      + h2('Next steps')
      + list(next)
      + button(portal, 'Open my Partner Portal'),
  });
  const text = `Welcome to Last Bite, ${i.restaurant}!

Hi ${i.username}, ${i.restaurant} is approved and live on Last Bite. Your electronically signed Restaurant Partner Agreement is attached as a PDF.

YOUR RESTAURANT KIOSK
Open this email on your counter tablet:
- Android tablet: ${i.androidUrl}  (tap Install)
- iPad: ${i.ipadUrl}  (tap Download, then Settings > Profile Downloaded > Install)
Kiosk link: ${i.kioskUrl}
Keep this link private; you can reset it in the Partner Portal (Kiosk tab).

NEXT STEPS
${next.map((n) => `- ${n.replace(/<[^>]+>/g, '')}`).join('\n')}

Partner Portal: ${portal}

Last Bite · St. John's, NL · support@lastbite.ca`;
  return { subject: `Welcome to Last Bite, ${i.restaurant}! Your kiosk is ready`, html, text };
}
