import "server-only";
import type { HttpsResponse, SafeFetchResult } from "./safe-fetch";

// Reading the answer of lib/safe-fetch.ts's last request: what it accepts,
// and at most how much of it.

// The text of a final (not redirecting) answer, or why it isn't taken: not
// 2xx, not text/html or text/plain, compressed, or over maxBytes (stops reading
// there).
export async function readTextAnswer(response: HttpsResponse, status: number, maxBytes: number): Promise<SafeFetchResult> {
  if (status < 200 || status > 299) {
    return { ok: false, code: "http_status" };
  }
  const [mediaType, ...parameters] = (response.headers["content-type"] ?? "").split(";");
  const contentType = mediaType.trim().toLowerCase();
  if (contentType !== "text/html" && contentType !== "text/plain") {
    return { ok: false, code: "wrong_type" };
  }
  const encoding = (response.headers["content-encoding"] ?? "identity").trim().toLowerCase();
  if (encoding !== "identity") {
    return { ok: false, code: "unsupported_encoding" };
  }
  if (Number(response.headers["content-length"] ?? 0) > maxBytes) {
    return { ok: false, code: "too_large" };
  }
  const bytes = await readAtMost(response, maxBytes);
  if (typeof bytes === "string") {
    return { ok: false, code: bytes };
  }
  return { ok: true, contentType, text: decode(bytes, parameters) };
}

async function readAtMost(response: HttpsResponse, maxBytes: number): Promise<Buffer | "too_large" | "network_error"> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of response) {
      const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += piece.length;
      if (size > maxBytes) {
        return "too_large";
      }
      chunks.push(piece);
    }
  } catch {
    return "network_error";
  }
  return Buffer.concat(chunks);
}

// The charset the server named ("text/html; charset=windows-1252"), else UTF-8.
function decode(bytes: Buffer, contentTypeParameters: string[]): string {
  const charset = contentTypeParameters.map((parameter) => /^\s*charset\s*=\s*"?([\w.:-]+)"?\s*$/i.exec(parameter)?.[1]).find(Boolean);
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}
