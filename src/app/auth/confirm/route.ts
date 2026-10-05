import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { onEmailVerified } from '@/lib/onboarding';
import { supabaseServer } from '@/lib/supabase/server';

// Email confirmation link target (when "Confirm email" is enabled in Supabase Auth).
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  if (tokenHash && type) {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      // Restaurants get the "application pending" email once their address is verified.
      if (data.user && (type === 'email' || type === 'signup')) await onEmailVerified(data.user.id);
      return NextResponse.redirect(new URL('/login?confirmed=1', url));
    }
  }
  return NextResponse.redirect(new URL('/login?error=confirmation', url));
}
