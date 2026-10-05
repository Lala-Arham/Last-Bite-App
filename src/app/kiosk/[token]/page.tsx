import type { Metadata, Viewport } from 'next';
import { KioskScreen } from '@/components/kiosk/kiosk-screen';
import { kioskRestaurant } from '@/lib/kiosk';

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const r = await kioskRestaurant(token);
  return {
    title: r ? `${r.name} kiosk` : 'Kiosk',
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
    manifest: r ? `/kiosk/${token}/manifest.webmanifest` : undefined,
    appleWebApp: { capable: true, title: r?.name ?? 'Last Bite Kiosk', statusBarStyle: 'black-translucent' },
    icons: { apple: '/assets/kiosk-apple-icon.png' },
  };
}

export const viewport: Viewport = { themeColor: '#121316', width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false };

// A restaurant's counter kiosk. The secret token in the link is the only key; see src/lib/kiosk.ts.
export default async function KioskPage({ params }: Props) {
  const { token } = await params;
  const r = await kioskRestaurant(token);
  if (!r) {
    return (
      <main className="grid min-h-dvh place-items-center p-8 text-center">
        <div>
          <div className="text-5xl">🔒</div>
          <h1 className="mt-3 text-2xl font-extrabold">This kiosk link is no longer valid</h1>
          <p className="text-muted">The restaurant owner may have reset it. Open the new link from the Partner Portal (Kiosk tab).</p>
        </div>
      </main>
    );
  }
  return <KioskScreen token={token} restaurantName={r.name} />;
}
