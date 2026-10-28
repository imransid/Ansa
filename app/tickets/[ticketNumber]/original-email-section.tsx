import { LocalDateTime } from "@/components/local-date-time";
import type { OriginalEmail } from "@/services/inbound-emails";

// The customer's own email, for tickets that came in by email (step 15).
// "Not verified": it didn't pass DKIM or DMARC, so anyone could have written
// that From address (step 25). The body is always shown as text: for an email
// without a plain-text part it is text made from its HTML (step 27). Files
// are never shown, only counted: attachments by name, and images shown inside
// the email (logos, pasted pictures) apart from them.
export function OriginalEmailSection({ email }: { email: OriginalEmail }) {
  return (
    // wrap-anywhere: tracking and unsubscribe links are long unbroken words,
    // and must wrap instead of widening the page.
    <section className="grid min-w-0 gap-2 rounded-lg border p-4 wrap-anywhere">
      <h2 className="text-lg font-semibold">Original email</h2>
      <p className="text-sm text-muted-foreground">
        From {email.fromAddress ?? "unknown sender"}
        {email.fromAddress && !email.senderVerified && " (sender not verified)"},{" "}
        <LocalDateTime iso={email.receivedAt.toISOString()} />
      </p>
      {email.replyToAddress && (
        <p className="text-sm text-muted-foreground">Replies requested to {email.replyToAddress} (Reply-To, not verified)</p>
      )}
      {email.unreadable ? (
        // Never shown as "(no subject)": an expert could close a real email as empty.
        // What went wrong is in the server log (lib/encryption.ts), not here:
        // the team using the page can't fix it.
        <p role="alert" className="text-sm text-destructive">
          This email can&apos;t be shown right now. If this keeps happening, contact ansa support.
        </p>
      ) : (
        <EmailContent email={email} />
      )}
    </section>
  );
}

function EmailContent({ email }: { email: OriginalEmail }) {
  return (
    <>
      <p className="text-sm font-medium">{email.subject || "(no subject)"}</p>
      <EmailBody email={email} />
      {email.attachmentCount > 0 && (
        <p className="text-sm text-muted-foreground">
          {email.attachmentCount === 1 ? "1 attachment" : `${email.attachmentCount} attachments`} not shown
          {email.attachmentNames.length > 0 && `: ${email.attachmentNames.join(", ")}`}. Ask the customer to send them
          again if you need them.
        </p>
      )}
      {email.inlineImageCount > 0 && (
        <p className="text-sm text-muted-foreground">
          {email.inlineImageCount === 1 ? "1 image" : `${email.inlineImageCount} images`} inside the email not shown
          (logos, signatures or pasted pictures).
        </p>
      )}
    </>
  );
}

function EmailBody({ email }: { email: OriginalEmail }) {
  if (email.body) {
    return (
      <>
        {email.bodyFromHtml && (
          <p className="text-xs text-muted-foreground">This email had no plain-text version: shown as text taken from its HTML.</p>
        )}
        <pre className="whitespace-pre-wrap wrap-anywhere font-sans text-sm">{email.body}</pre>
      </>
    );
  }
  if (email.bodyFromHtml) {
    // Never shown as "(no text)": an expert could close a real email as empty.
    return (
      <p className="text-sm text-muted-foreground">
        This email had no plain-text version, and no text could be taken from its HTML version (it may hold only
        images). Ask the customer to write again if you need its content.
      </p>
    );
  }
  return <p className="text-sm text-muted-foreground">(no text)</p>;
}
