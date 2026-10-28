// Fakes for the safe fetch checks (knowledge-fetch-checks.ts): a resolver and
// an https server that never touch the network.

import { EventEmitter } from "node:events";
import type { RequestOptions } from "node:https";
import { Readable } from "node:stream";
import type { HttpsRequester, HttpsRequestHandle, HttpsResponse, Resolver } from "@/lib/safe-fetch";

export type FakeAnswer = { status: number; headers?: Record<string, string>; chunks?: Buffer[]; neverAnswers?: boolean };

export const PUBLIC_V4 = "93.184.215.14";
export const PUBLIC_V6 = "2606:2800:21f:cb07:6820:80da:af6b:8b2c";

// A resolver that knows only these names. A name listed in slowNames answers
// after that many milliseconds, as a slow DNS server would.
export function fakeResolver(names: Record<string, string[]>, slowNames: Record<string, number> = {}): Resolver {
  return async (hostname) => {
    const addresses = names[hostname];
    if (!addresses) {
      throw new Error("ENOTFOUND");
    }
    if (slowNames[hostname]) {
      await new Promise((resolve) => setTimeout(resolve, slowNames[hostname]));
    }
    return addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
}

// A server answering "<host><path>" with the answers given, recording every
// request it gets and every request the fetch closed (destroyed).
export function fakeServer(answers: Record<string, FakeAnswer>) {
  const requests: RequestOptions[] = [];
  const closed: RequestOptions[] = [];
  const request: HttpsRequester = (options, onResponse) => {
    requests.push(options);
    const handle = new EventEmitter() as EventEmitter & HttpsRequestHandle;
    handle.destroy = () => {
      closed.push(options);
      return handle;
    };
    handle.end = () => {
      const answer = answers[`${options.hostname}${options.path}`];
      if (answer?.neverAnswers) {
        return handle;
      }
      setImmediate(() => {
        if (!answer) {
          handle.emit("error", new Error("No such fake page"));
          return;
        }
        const response: HttpsResponse = Object.assign(Readable.from(answer.chunks ?? []), { statusCode: answer.status, headers: answer.headers ?? {} });
        onResponse(response);
      });
      return handle;
    };
    return handle;
  };
  return { request, requests, closed };
}

export const page = (html: string, contentType = "text/html; charset=utf-8"): FakeAnswer => ({
  status: 200,
  headers: { "content-type": contentType },
  chunks: [Buffer.from(html)],
});
