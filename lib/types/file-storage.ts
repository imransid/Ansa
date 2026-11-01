// How a stored file can be reached: a short-lived signed R2 link, or (in dev)
// the bytes themselves, served by our own route after its login check.
// Here, apart from lib/file-storage.ts, so the pages' types never load the
// storage code that talks to R2.
export type PrivateFileAccess =
  | { kind: "signed-url"; url: string }
  | { kind: "bytes"; bytes: Buffer; contentType: string };
