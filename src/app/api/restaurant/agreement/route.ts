import { NextResponse, type NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth';
import { signedAgreement } from '@/lib/onboarding';

// The signed Restaurant Partner Agreement (PDF) for the signed-in owner, or for admins with ?restaurant=<id>.
export async function GET(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
  const id = viewer.role === 'admin' ? Number(req.nextUrl.searchParams.get('restaurant')) : viewer.restaurant?.id;
  if (!id) return NextResponse.json({ error: 'Restaurant not found.' }, { status: 404 });
  const { pdf, filename } = await signedAgreement(id);
  return new NextResponse(new Uint8Array(pdf), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'private, no-store' },
  });
}
