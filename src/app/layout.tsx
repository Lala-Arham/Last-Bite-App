import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { HideOnKiosk } from '@/components/app/hide-on-kiosk';
import { Providers } from '@/components/app/providers';
import { SiteFooter } from '@/components/app/site-footer';
import { SiteHeader } from '@/components/app/site-header';
import { TermsGate } from '@/components/app/terms-gate';
import { getViewer } from '@/lib/auth';
import './globals.css';

const inter = localFont({
  src: [
    { path: '../fonts/inter-latin-400-normal.woff2', weight: '400' },
    { path: '../fonts/inter-latin-500-normal.woff2', weight: '500' },
    { path: '../fonts/inter-latin-600-normal.woff2', weight: '600' },
    { path: '../fonts/inter-latin-700-normal.woff2', weight: '700' },
  ],
  variable: '--font-inter',
  display: 'swap',
});
const jakarta = localFont({
  src: [
    { path: '../fonts/plus-jakarta-sans-latin-600-normal.woff2', weight: '600' },
    { path: '../fonts/plus-jakarta-sans-latin-700-normal.woff2', weight: '700' },
    { path: '../fonts/plus-jakarta-sans-latin-800-normal.woff2', weight: '800' },
  ],
  variable: '--font-jakarta',
  display: 'swap',
});
const plexMono = localFont({
  src: [
    { path: '../fonts/IBMPlexMono-Regular.woff2', weight: '400' },
    { path: '../fonts/IBMPlexMono-SemiBold.woff2', weight: '600' },
    { path: '../fonts/IBMPlexMono-Bold.woff2', weight: '700' },
  ],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Last Bite: Rescue good food, save money', template: '%s · Last Bite' },
  description: "Last Bite: rescue good restaurant food at a discount around St. John's, Newfoundland and Labrador.",
};

export const viewport: Viewport = { themeColor: '#121316' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable} ${plexMono.variable}`}>
      <body className="flex min-h-dvh flex-col font-sans">
        <Providers>
          <HideOnKiosk>
            <SiteHeader viewer={viewer && { username: viewer.username, role: viewer.role, restaurantName: viewer.restaurant?.name ?? null, creditCents: viewer.creditCents }} />
          </HideOnKiosk>
          <div className="flex-1">{children}</div>
          <HideOnKiosk><SiteFooter /></HideOnKiosk>
          {viewer && viewer.role !== 'admin' && viewer.pendingTerms.length > 0 && <TermsGate role={viewer.role} />}
        </Providers>
      </body>
    </html>
  );
}
