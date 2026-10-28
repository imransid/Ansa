// The "context" passed to encryptText / decryptText for each kind of stored
// secret. It ties each ciphertext to its company and record (see
// lib/encryption.ts). Changing one of these makes existing rows unreadable.

export function callTranscriptContext(companyId: string, vapiCallId: string): string {
  return `call-transcript:${companyId}:${vapiCallId}`;
}

export function callIssueContext(companyId: string, callId: string): string {
  return `call-ai-issue:${companyId}:${callId}`;
}

export function callExplanationContext(companyId: string, callId: string): string {
  return `call-ai-explanation:${companyId}:${callId}`;
}

// The customer's sentence that backed a "solved" (step 31).
export function callEvidenceContext(companyId: string, callId: string): string {
  return `call-ai-evidence:${companyId}:${callId}`;
}

export function inboundEmailSubjectContext(companyId: string, inboundEmailId: string): string {
  return `inbound-email-subject:${companyId}:${inboundEmailId}`;
}

export function inboundEmailBodyContext(companyId: string, inboundEmailId: string): string {
  return `inbound-email-body:${companyId}:${inboundEmailId}`;
}

export function inboundEmailAttachmentsContext(companyId: string, inboundEmailId: string): string {
  return `inbound-email-attachments:${companyId}:${inboundEmailId}`;
}

// Names the note's company, ticket and own id: a note copied onto another
// ticket, or into another company, can't be decrypted there.
export function ticketNoteContext(companyId: string, ticketId: string, noteId: string): string {
  return `ticket-note:${companyId}:${ticketId}:${noteId}`;
}

// One message of the Co-Founder's interview (step 36): an owner's answer
// (which can hold anything they typed) or the Co-Founder's question. Names
// the company and the message, so a message copied into another company,
// or onto another message's row, can't be decrypted there.
export function onboardingMessageContext(companyId: string, messageId: string): string {
  return `onboarding-message:${companyId}:${messageId}`;
}

// A social account's access or refresh token (step 40). Names the token's
// kind, the company and the connection: a token copied into another
// company, onto another connection, or into the other token's column can't
// be decrypted there.
export function socialTokenContext(companyId: string, connectionId: string, kind: "access" | "refresh"): string {
  return `social-${kind}-token:${companyId}:${connectionId}`;
}

// The PKCE verifier of one connection attempt (step 40), tied to its
// company and its oauth_states row.
export function oauthPkceVerifierContext(companyId: string, oauthStateId: string): string {
  return `oauth-pkce-verifier:${companyId}:${oauthStateId}`;
}
