import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { type NextRequest } from 'next/server';
import { kioskRestaurant, kioskUrl } from '@/lib/kiosk';

const xml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] as string);

// Stable UUIDs, so downloading the profile again replaces the icon instead of adding a second one.
function uuid(seed: string) {
  const h = createHash('sha1').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`.toUpperCase();
}

// iPad (and iPhone) configuration profile with a Web Clip: installing it puts this restaurant's kiosk
// on the home screen as a full-screen app. Safari downloads it; the owner installs it in Settings.
export async function GET(_req: NextRequest, ctx: RouteContext<'/kiosk/[token]/ipad.mobileconfig'>) {
  const { token } = await ctx.params;
  const r = await kioskRestaurant(token);
  if (!r) return new Response('This kiosk link is no longer valid.', { status: 404 });
  const icon = (await readFile(path.join(process.cwd(), 'public', 'assets', 'kiosk-apple-icon.png'))).toString('base64');
  const id = `ca.lastbite.kiosk.r${r.id}`;
  const label = r.name.length > 20 ? 'Last Bite Kiosk' : r.name;
  const profile = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>FullScreen</key><true/>
      <key>Icon</key><data>${icon}</data>
      <key>IsRemovable</key><true/>
      <key>Label</key><string>${xml(label)}</string>
      <key>PayloadDescription</key><string>Adds the ${xml(r.name)} Last Bite kiosk to the home screen.</string>
      <key>PayloadDisplayName</key><string>${xml(r.name)} kiosk</string>
      <key>PayloadIdentifier</key><string>${id}.webclip</string>
      <key>PayloadType</key><string>com.apple.webClip.managed</string>
      <key>PayloadUUID</key><string>${uuid(`${token}:webclip`)}</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>Precomposed</key><true/>
      <key>URL</key><string>${xml(kioskUrl(token))}</string>
    </dict>
  </array>
  <key>PayloadDescription</key><string>Puts the Last Bite counter kiosk for ${xml(r.name)} on this device's home screen. It adds one icon and nothing else; delete the icon or this profile to remove it.</string>
  <key>PayloadDisplayName</key><string>Last Bite Kiosk: ${xml(r.name)}</string>
  <key>PayloadIdentifier</key><string>${id}</string>
  <key>PayloadOrganization</key><string>Last Bite</string>
  <key>PayloadRemovalDisallowed</key><false/>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>${uuid(`${token}:profile`)}</string>
  <key>PayloadVersion</key><integer>1</integer>
</dict>
</plist>
`;
  return new Response(profile, {
    headers: {
      'Content-Type': 'application/x-apple-aspen-config',
      'Content-Disposition': `attachment; filename="LastBite-Kiosk.mobileconfig"`,
      'Cache-Control': 'no-store',
    },
  });
}
