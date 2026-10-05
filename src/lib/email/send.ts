import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';
import { serverEnv } from '@/lib/env';

// Emails sent by the app itself (restaurant onboarding). Sign-up confirmation and password reset
// emails come from Supabase Auth instead. Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and
// EMAIL_FROM; in development without them, mail goes to the local Supabase inbox (Mailpit,
// http://127.0.0.1:54324). In production without SMTP, nothing is sent and a warning is logged.

let transport: Transporter | null | undefined;

function transporter(): Transporter | null {
  if (transport !== undefined) return transport;
  const { host, port, user, pass } = serverEnv.smtp;
  if (host) {
    transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: user ? { user, pass } : undefined });
  } else if (process.env.NODE_ENV !== 'production') {
    transport = nodemailer.createTransport({ host: '127.0.0.1', port: 54325, secure: false });
  } else {
    transport = null;
  }
  return transport;
}

export type Attachment = { filename: string; content: Buffer; contentType: string };

// Returns false when email isn't configured or sending failed (the error is logged, never thrown):
// a missing email must not undo an approval or a sign-up.
export async function sendEmail(msg: { to: string; subject: string; html: string; text: string; attachments?: Attachment[] }) {
  const t = transporter();
  if (!t) {
    console.warn(`Email not sent (SMTP_HOST is not set): "${msg.subject}" to ${msg.to}`);
    return false;
  }
  try {
    await t.sendMail({ from: serverEnv.smtp.from, ...msg });
    return true;
  } catch (err) {
    console.error(`Email "${msg.subject}" to ${msg.to} failed:`, err);
    return false;
  }
}
