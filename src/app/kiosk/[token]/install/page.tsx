import type { Metadata } from 'next';
import { InstallGuide } from '@/components/kiosk/install-guide';
import { kioskInstallUrl, kioskRestaurant, kioskUrl } from '@/lib/kiosk';

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ device?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const r = await kioskRestaurant(token);
  return {
    title: r ? `Install the ${r.name} kiosk` : 'Kiosk',
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
    manifest: r ? `/kiosk/${token}/manifest.webmanifest` : undefined,
    appleWebApp: { capable: true, title: r?.name ?? 'Last Bite Kiosk', statusBarStyle: 'black-translucent' },
    icons: { apple: '/assets/kiosk-apple-icon.png' },
  };
}

// Puts the restaurant's kiosk on a tablet's home screen (linked from the welcome email and the
// Partner Portal). ?device=android|ipad picks the instructions; otherwise the device is detected.
export default async function KioskInstallPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { device } = await searchParams;
  const r = await kioskRestaurant(token);
  if (!r) {
    return (
      <main className="grid min-h-dvh place-items-center p-8 text-center">
        <div>
          <div className="text-5xl">🔒</div>
          <h1 className="mt-3 text-2xl font-extrabold">This kiosk link is no longer valid</h1>
          <p className="text-muted">The restaurant owner may have reset it. Use the new link from the Partner Portal (Kiosk tab).</p>
        </div>
      </main>
    );
  }
  return (
    <InstallGuide
      restaurantName={r.name}
      kioskUrl={kioskUrl(token)}
      installUrl={kioskInstallUrl(token)}
      profileUrl={`/kiosk/${token}/ipad.mobileconfig`}
      requested={device === 'android' || device === 'ipad' ? device : null}
    />
  );
}
