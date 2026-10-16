import "server-only";

// Reads a request body as raw bytes, but gives up as soon as it grows past
// maxBytes, so a huge upload can't fill memory. Returns "too-large" then.
// The bytes are not decoded or parsed here: webhooks must check the signature
// over these exact bytes before anything looks at the content.
export async function readRawBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<Buffer | "too-large"> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > maxBytes) {
    return "too-large";
  }
  if (!request.body) {
    return Buffer.alloc(0);
  }

  // Content-Length can be missing or wrong, so count while reading too.
  const reader = request.body.getReader();
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
