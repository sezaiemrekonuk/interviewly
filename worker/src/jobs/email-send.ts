import { createTransport, type Transporter } from 'nodemailer';

import { config } from '../lib/env';
import { logger } from '../lib/logger';

/**
 * The `email.send` consumer (K8.6). The API enqueues; this is the only process that opens
 * an SMTP socket, so a mail outage is a retrying job rather than a failed registration.
 *
 * A05 reuses this job for password reset — hence two templates behind one `kind`.
 */

export type EmailKind = 'verify' | 'reset';

export interface EmailJob {
  to: string;
  kind: EmailKind;
  token: string;
  locale: string;
}

let transporter: Transporter | undefined;

/** Built once, on first delivery. Swappable so a test can assert without an SMTP server. */
export function setTransport(replacement: Transporter | undefined): void {
  transporter = replacement;
}

function transport(): Transporter {
  return (transporter ??= createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    // Mailpit and most dev sinks speak plaintext on 1025; STARTTLS is negotiated when the
    // server offers it. `secure: true` here would fail against the sink the whole demo runs on.
    secure: false,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
  }));
}

interface Template {
  subject: string;
  body: (link: string) => string;
}

// English only for now: the locale travels on the job so this table can grow a second
// column without the producer changing. The frontend ledger owns translated mail copy.
const TEMPLATES: Record<EmailKind, Template> = {
  verify: {
    subject: 'Confirm your Interviewly address',
    body: (link) =>
      [
        'Welcome to Interviewly.',
        '',
        'Confirm this address to finish setting up your account:',
        link,
        '',
        'The link works once and expires. If you did not sign up, ignore this mail.',
      ].join('\n'),
  },
  reset: {
    subject: 'Reset your Interviewly password',
    body: (link) =>
      [
        'Someone asked to reset the password for this address.',
        '',
        'Set a new password here:',
        link,
        '',
        'The link works once and expires. If this was not you, ignore this mail —',
        'nothing changes until the link is used.',
      ].join('\n'),
  },
};

function linkFor(job: EmailJob): string {
  const path = job.kind === 'verify' ? 'verify-email' : 'reset-password';
  return `${config.PUBLIC_ORIGIN}/${path}/${encodeURIComponent(job.token)}`;
}

export async function sendEmail(job: EmailJob): Promise<void> {
  const template = TEMPLATES[job.kind];
  if (!template) throw new Error(`unknown email kind: ${String(job.kind)}`);

  await transport().sendMail({
    from: config.MAIL_FROM,
    to: job.to,
    subject: template.subject,
    text: template.body(linkFor(job)),
  });

  // Neither the token nor the recipient reaches the log: the pair is a working credential
  // and an address, and the operational question is only ever "did the kind go out".
  logger.info({ kind: job.kind }, 'EMAIL_SENT');
}
