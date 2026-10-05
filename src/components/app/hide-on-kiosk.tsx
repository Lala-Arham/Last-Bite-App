'use client';

import { usePathname } from 'next/navigation';

// The restaurant kiosk (/kiosk/...) is a full-screen tablet app: no site header or footer.
export function HideOnKiosk({ children }: { children: React.ReactNode }) {
  return usePathname().startsWith('/kiosk/') ? null : children;
}
