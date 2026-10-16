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
