import "server-only";

// Reads a request body as raw bytes, but gives up as soon as it grows past
// maxBytes, so a huge upload can't fill memory. Returns "too-large" then.
// The bytes are not decoded or parsed here: webhooks must check the signature
// over these exact bytes before anything looks at the content.
export async function readRawBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<Buffer | "too-large"> {
  return readStreamWithLimit(request.body, request.headers.get("content-length"), maxBytes);
}

// Same, for any body stream (also used for downloads). declaredLength is the
// Content-Length header, if any.
export async function readStreamWithLimit(
  body: ReadableStream<Uint8Array> | null,
  declaredLength: string | null,
  maxBytes: number,
): Promise<Buffer | "too-large"> {
  if (Number(declaredLength ?? "0") > maxBytes) {
    return "too-large";
  }
  if (!body) {
    return Buffer.alloc(0);
  }

  // Content-Length can be missing or wrong, so count while reading too.
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      return "too-large";
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
