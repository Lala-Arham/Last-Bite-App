// Runtime configuration. NEXT_PUBLIC_* values are also available in the browser.

const int = (v: string | undefined, d: number) => (v === undefined || v === '' ? d : Number.parseInt(v, 10));

export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  stripePublishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
  map: {
    tileUrl: process.env.NEXT_PUBLIC_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ||
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    darkFilter: process.env.NEXT_PUBLIC_MAP_DARK_FILTER !== 'false',
  },
};

// Server-only settings. Never import this object into client components.
export const serverEnv = {
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY ?? '',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  cronSecret: process.env.CRON_SECRET ?? '',
  timeZone: process.env.TIME_ZONE || 'America/St_Johns',
  legal: {
    entity: process.env.LEGAL_ENTITY_NAME || 'Last Bite',
    email: process.env.SUPPORT_EMAIL || 'support@lastbite.ca',
    address: process.env.LEGAL_ADDRESS || "St. John's, Newfoundland and Labrador",
  },
  // Last Bite's GST/HST registration number, printed on subscription invoices.
  hstNumber: process.env.HST_REGISTRATION_NUMBER ?? '',
  // Outgoing email for restaurant onboarding (see src/lib/email/send.ts).
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: int(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.EMAIL_FROM || 'Last Bite <hello@lastbite.ca>',
  },
  // Orders not picked up are released (never charged) this long after the discard timer ends.
  pickupGraceMinutes: int(process.env.PICKUP_GRACE_MINUTES, 10),
};

// Payments use Stripe when both keys are set, and the built-in mock processor otherwise.
export const paymentMode = (): 'stripe' | 'mock' =>
  serverEnv.stripeSecretKey && publicEnv.stripePublishableKey ? 'stripe' : 'mock';
