// How a stored file can be reached: a short-lived signed R2 link, or (in dev)
// the bytes themselves, served by our own route after its login check.
// Core makes the link or reads the bytes (core/internal/files): the screens
// never talk to R2.
export type PrivateFileAccess =
  | { kind: "signed-url"; url: string }
  | { kind: "bytes"; bytes: Buffer; contentType: string };
