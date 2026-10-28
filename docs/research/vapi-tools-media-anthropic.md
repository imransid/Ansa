# Research report: Vapi live tools, image/video APIs, Anthropic embeddings and PDFs (as of 2026-10-26)

## 1. Vapi custom function tools during a live call

### What Vapi sends
- Vapi POSTs `{"message": {...}}` to the tool's server URL, with `message.type = "tool-calls"`. Docs: https://docs.vapi.ai/server-url/events and https://docs.vapi.ai/tools-calling
- Vapi's OpenAPI spec (`ServerMessageToolCalls`, https://api.vapi.ai/api-json) lists these fields:
  - Required: `toolCallList` and `toolWithToolCallList`.
  - Optional: `timestamp`, `call`, `phoneNumber`, `customer`, `assistant`, `artifact`, `chat`, `assistantVersion`.
  - The tool's server field says: "Webhook contains the call, assistant, and phone number objects" (https://docs.vapi.ai/api-reference/tools/create).
- Each `toolCallList[i]` is `{ id: string (required), type: "function", function: { name: string (max 80), arguments } }`.
- `toolWithToolCallList[i]` repeats the tool definition (`type`, `function{name,parameters,description}`, `server`, `messages`, `async`, ...) plus `toolCall`, which is the same ToolCall again.
- **`arguments` is a conflict.** The OpenAPI spec types `ToolCallFunction.arguments` as a **string**. Every docs example shows a JSON **object**, for example `{"location":"San Francisco"}` (https://docs.vapi.ai/tools/custom-tools). Which one production sends is NOT CONFIRMED, so accept both: if it is a string, `JSON.parse` it, then run Zod.

### How to tell which call and number it is
- `message.call.id` is the call id. `message.call.orgId` is the org.
- `message.call.type` is one of `inboundPhoneCall`, `outboundPhoneCall`, `webCall`, `vapi.websocketCall`.
- `message.call.phoneNumberId` is "Only relevant for outboundPhoneCall and inboundPhoneCall type". This is the field to look up in `phone_lines` to find the company.
- `message.phoneNumber` is typed as the `Create*PhoneNumberDTO`, which has **no `id` field** in the spec. The Twilio variant's schema even includes `twilioAuthToken`/`twilioApiSecret`. Whether Vapi redacts those is NOT CONFIRMED, so never use this field for identity and never log it.
- `message.customer.number` is the caller (customer object: `number`, `name`, `email`, ...).
- **`message.artifact` is sensitive.** It is "a live version of the `call.artifact`" and includes `transcript`, `messages`, `recordingUrl` and presigned recording/log URLs. Rule 1 says never log the body.
- Payload size limit: NOT CONFIRMED. None is documented, and the body carries the live transcript plus the full assistant object.

### What our server must return
- Always HTTP 200: "Any other status code is ignored completely" (https://docs.vapi.ai/tools-calling).
- Body: `{ "results": [ { "name": "<fn>", "toolCallId": "<id from request>", "result": "<single-line string>" } ] }`.
  - On failure, send `error` instead of `result`, never both.
  - Return one entry per `toolCallId`, in any order.
- `result` and `error` must be flat single-line strings: "Line breaks cause parsing errors" (https://docs.vapi.ai/tools/custom-tools-troubleshooting).
- The OpenAPI `ToolCallResult` requires `name` and `toolCallId`. The docs examples sometimes leave `name` out, so send both.
- Optional fields: `message` (a `request-complete` or `request-failed` line to speak) and `metadata`.
- With `async: true`, Vapi immediately returns "Success." to the model and ignores what our server answers later.

### Limits
- Timeout is `server.timeoutSeconds`: "Defaults to 20 seconds", minimum 1, maximum 300 (OpenAPI `Server`).
- No retries by default: `backoffPlan` is undefined, so the request is not retried.
- The fixed 7.5 s limit is for `assistant-request` only, not for tools (https://docs.vapi.ai/server-url/events).
- Result size cap: NOT CONFIRMED (none documented). The result goes into the conversation history. The model's `maxTokens` range is 50–10000.
- Which server URL wins, highest first: `tool.server.url` > `assistant.server.url` > `phoneNumber.server.url` > org (https://docs.vapi.ai/server-url/setting-server-urls).

### How Vapi authenticates (https://docs.vapi.ai/server-url/server-authentication plus the OpenAPI `HMACAuthenticationPlan` and `BearerAuthenticationPlan`)
- You create a Custom Credential and reference it with `server.credentialId` on the tool, assistant or phone number. The org-level one is set in the dashboard under Server Configuration.
- **Bearer:** `headerName` defaults to `Authorization` and `bearerPrefixEnabled` defaults to true. The legacy `X-Vapi-Secret` equals a Bearer credential with header name `X-Vapi-Secret` and the prefix off. The inline `secret` and `headers` fields are legacy.
- **OAuth2:** client credentials (token URL, client id, secret, scope). Vapi sends the result as a Bearer token.
- **HMAC fields and defaults:**
  - `algorithm`: sha256, sha512 or sha1 (required); `secretKey` (required).
  - `signatureHeader` defaults to **`x-signature`**; `timestampHeader` defaults to **`x-timestamp`**.
  - `includeTimestamp` defaults to true.
  - `payloadFormat` defaults to `"{timestamp}.{body}"`. Available placeholders: `{body}`, `{timestamp}`, `{method}`, `{url}`, `{svix-id}`.
  - `signatureEncoding` is hex (default) or base64.
  - Also: `signaturePrefix` (for example `sha256=`), `messageIdHeader`, and `secretIsBase64` (default false).
  - Timestamp unit (seconds or milliseconds): NOT CONFIRMED.
- **Repo impact:** our defaults (`x-vapi-signature`, `x-vapi-timestamp`) do not match Vapi's HMAC defaults (`x-signature`, `x-timestamp`). The payload format and hex encoding do match. Either set the header names on the credential or change the env settings.
- **Inline config gets no credential:** "When the server URL comes from the API request itself, Vapi sends the webhook **without** that credential." That covers a transient `assistant` in `POST /call`, `/chat` or `/session`, and `assistantOverrides`. This applies to orgs created on or after 2026-09-23, rolled out in phases for older ones.
- An `Authorization` key in `server.headers` overrides `credentialId`; Vapi calls this an anti-pattern.
- If a tool has no `credentialId`, whether the org credential still covers that tool's own `server.url` is NOT CONFIRMED. The docs say the org credential is attached only to URLs "in your org configuration", so set `server.credentialId` on every tool explicitly.
- `staticIpAddressesEnabled` (default false) makes Vapi send from fixed IPs, which allows IP allowlisting.

### Vapi's own knowledge base, for comparison
- **Built-in** (https://docs.vapi.ai/knowledge-base):
  - Files go up under Dashboard Resources > Files, or through the API.
  - Types: .txt .pdf .docx .doc .csv .md .tsv .yaml .json .xml .log.
  - "Keep individual files smaller than 300KB".
  - Retrieval: "supports Google as a provider with Gemini models" (OpenAPI `KnowledgeBase.provider` enum is `["google"]`).
- **Query tool** (https://docs.vapi.ai/knowledge-base/using-query-tool):
  - Shape: `{ type: "query", function: { name }, knowledgeBases: [{ provider: "google", name, description, fileIds: [...] }] }`.
  - Selecting files on an assistant creates one automatically.
  - "The knowledge base description alone is not sufficient": the system prompt must name the tool and say when to use it.
  - Our documents would sit with Vapi and Google, inside ansa's one Vapi account.
- **Custom KB** (https://docs.vapi.ai/knowledge-base/custom-knowledge-base plus OpenAPI):
  - Set `provider: "custom-knowledge-base"` and a `server`.
  - Vapi sends `knowledge-base-request` with `messages` and `messagesOpenAIFormatted` plus the call metadata.
  - Answer either `{ documents: [{ content, similarity, uuid? }] }` or `{ message: { role: "assistant", content } }` to speak a fixed reply.
  - It is attached with `model.knowledgeBaseId`, API only. A PATCH replaces the whole `model` object.

## 2. Image and video generation APIs (Node server)

| Provider / models | Sync or async | Output | List price | Provenance |
|---|---|---|---|---|
| **OpenAI** gpt-image-2.5-sunburst / -flare, gpt-image-2, 1.5, 1-mini | Sync (Image API and Responses API). Streaming `partial_images` 0–3. Batch at about half price | PNG (default), JPEG, WebP. Standard sizes 1024², 1536×1024, 1024×1536; custom sizes in multiples of 16 up to a 3840 edge; above 2560×1440 is experimental | Billed by tokens: $8/M image input, $30/M image output (2.5 and 2). Per-image price for 2.5 not published. GPT Image 2 at 1024² was about $0.006 / $0.053 / $0.211 (low/med/high) | C2PA and SynthID ("Images generated with ChatGPT, Codex, and the OpenAI API include both"). From a help-center search snippet; the page itself returned 403 |
| **OpenAI video** (Sora 2 / Videos API) | **Shut down 2026-09-24**, "no one-to-one replacement" | – | – | – |
| **Google Gemini API images**: gemini-nano-banana-2.1, gemini-3.1-flash-image, -flash-lite-image, gemini-3-pro-image | Sync (`interactions.create` returns the image). Batch at about half price | PNG or JPEG as base64; 0.5K, 1K, 2K, 4K | nano-banana-2.1 $0.0336 / $0.0504 / $0.113 (1K/2K/4K); 3.1-flash-image $0.067 / $0.101 / $0.151; 3-pro-image $0.134 / $0.134 / $0.24. No free tier | "All generated images include a SynthID watermark." C2PA not mentioned |
| **Google video**: Gemini Omni Flash `gemini-omni-1.1-flash` (Veo 3.1 preview shut down 2026-10-22; Imagen shut down) | Interactions API. Sync recommended (`background=false`); outputs over 4 MB use URI delivery, polled until ACTIVE | MP4 with audio; 360p, 720p (default), 1080p and 4K (upscaled); 16:9 or 9:16; extensions up to 40 s total | About $0.10/s at 720p ($17.50/M output tokens, 5,792 tokens/s) | SynthID on all videos |
| **Stability AI**: Stable Image Ultra, SD 3.5 Large / Turbo / Medium / Flash, Core | Sync for generation (raw bytes or JSON base64). Some edit and upscale services are async (id, then poll: 202 still running, 200 done; results kept 24 h). **No video in the current API** | PNG (default), JPEG, WebP. Ultra is about 1 MP (1024² default) | $0.01 per credit: Ultra 8, SD3.5 Large 6.5, Turbo 4, Medium 3.5, Flash 2.5, Core 3 | C2PA signing on API outputs (release notes and integrity report) |
| **Black Forest Labs**: FLUX.2 [pro] / [max] / [flex] / [klein], FLUX 3 Image and Video | Async: POST returns `id` and `polling_url` (you must poll that URL), or set `webhook_url` | Result URLs **expire after 10 minutes**, have no CORS and must not be served directly. FLUX.2 up to 4 MP; FLUX 3 Image up to about 16 MP; FLUX 3 Video is MP4 at 24 fps with audio, 5–20 s, up to 4K | FLUX.2 [pro] from $0.03 per text-to-image, $0.045 per edit. FLUX 3 prices NOT CONFIRMED (shown only in a calculator) | C2PA on every image from api.bfl.ai; their terms forbid removing it. EU endpoint `api.eu.bfl.ai` |
| **Replicate** (hosts many models) | Async with webhooks (`webhook_events_filter`), or sync with `Prefer: wait` (default 60 s) | Depends on the model. API inputs and outputs are "automatically removed after an hour" | Per model | Depends on the model. Webhooks are signed with HMAC-SHA256 over `${webhook-id}.${webhook-timestamp}.${body}` |
| **Runway** (aggregator: gen4.5, gen4_turbo, veo3.1, Seedance, Kling, gpt_image_2_5, nano banana, ...) | Async task: POST returns a task id, then poll (the SDK's `waitForTaskOutput`). Webhooks and URL expiry NOT CONFIRMED | Varies by model | $0.01 per credit: gen4.5 12 credits/s, gen4_turbo 5/s, veo3.1 40/s with audio; gen4_image 5 credits (720p) or 8 (1080p) | Says it adopted C2PA and puts an invisible watermark on every generation (runwayml.com/safety). NOT CONFIRMED in the API docs |
| **Luma** Agents API: uni-1, uni-1-max (images), ray-3.2 (video) | Async: `POST /v1/generations`, poll `GET /v1/generations/{id}`, download from a presigned URL. No webhooks mentioned; docs suggest a 10-minute timeout for video | 2K images. Video 360p–1080p, HDR at 720p/1080p, billed per 5 s block | uni-1 $0.0404, uni-1-max $0.1000 per 2K image. ray-3.2: $0.30 (720p) or $1.20 (1080p) per 5 s | C2PA NOT CONFIRMED. Terms reserve the right to embed credentials, forbid removing them, and require telling users the output is AI-generated |

**Likeness and policy notes for marketing images:**
- **OpenAI:** the usage policies forbid using someone's likeness without consent in ways that could confuse what is authentic. The service terms forbid reproducing "the likeness of any person without express consent" from image inputs. The `moderation` parameter is `auto` or `low`; a refusal comes back as a `moderation_blocked` error.
- **Google Omni:** "Uploading and editing images containing certain recognizable people is not supported". Images of minors and editing uploaded videos are not available in the EEA, Switzerland or the UK.
- **Runway:** checks both inputs and outputs. A moderated task is still charged, and too many get the account suspended. `contentModeration` relaxes only the public-figure check.
- **Stability:** a 403 means moderation refused it; `CONTENT_FILTERED` means the output was blurred.
- **Stability and BFL specific likeness rules:** NOT CONFIRMED.
- **C2PA metadata is easy to lose:** editing, converting or re-encoding strips it (OpenAI, BFL). Keep the original bytes.
- **Storage:** provider URLs expire (BFL 10 min, Replicate 1 h), so copy outputs into R2 right away, the way recordings are copied.

Sources: https://developers.openai.com/api/docs/guides/image-generation, https://developers.openai.com/api/docs/pricing, https://developers.openai.com/api/docs/guides/video-generation, https://help.openai.com/en/articles/8912793-c2pa-and-synthid-in-openai-generated-images, https://ai.google.dev/gemini-api/docs/image-generation, https://ai.google.dev/gemini-api/docs/omni, https://ai.google.dev/gemini-api/docs/pricing, https://ai.google.dev/gemini-api/docs/imagen, https://ai.google.dev/gemini-api/docs/video, https://docs.stability.ai/api-reference, https://docs.stability.ai/pricing, https://platform.stability.ai/docs/release-notes, https://docs.bfl.ml/api_integration/integration_guidelines, https://docs.bfl.ml/quick_start/pricing, https://help.bfl.ai/articles/3705384267-c2pa-in-flux-generated-images, https://replicate.com/docs/topics/predictions/create-a-prediction, https://replicate.com/docs/topics/predictions/data-retention, https://replicate.com/docs/topics/webhooks/verify-webhook, https://docs.dev.runwayml.com/guides/pricing, https://docs.dev.runwayml.com/guides/models, https://docs.dev.runwayml.com/api-details/moderation/, https://docs.agents.lumalabs.ai/, https://docs.agents.lumalabs.ai/guides/pricing/, https://lumalabs.ai/legal/api-terms-of-use

## 3. Anthropic

### Embeddings
- **Confirmed: no embeddings API.** "Anthropic does not offer its own embedding model." (https://platform.claude.com/docs/en/build-with-claude/embeddings)
- The page describes **Voyage AI by MongoDB** as "one embeddings provider" and adds "you should assess a variety of embeddings vendors". So it is the provider the docs feature, not an exclusive recommendation.
- Models: voyage-4-large / voyage-4 / voyage-4-lite, voyage-code-4, voyage-context-4, voyage-multimodal-3.5, rerank-3. 32k context, 1024 dimensions by default.
- Endpoint: `https://ai.mongodb.com/v1/embeddings` with a MongoDB Atlas model API key.

### PDF input
- **Confirmed: Claude reads PDFs directly** in `document` content blocks (https://platform.claude.com/docs/en/build-with-claude/pdf-support).
- Three ways to send one:
  - `source: { type: "url", url }`
  - `source: { type: "base64", media_type: "application/pdf", data }`
  - `source: { type: "file", file_id }`
- On Amazon Bedrock and Google-managed Vertex, only base64 works.
- **Limits:**
  - Request size: 32 MB (Bedrock 20 MB, Google-managed 30 MB; https://platform.claude.com/docs/en/api/overview).
  - Pages: **600 per request (100 when the request's context window is under 1M tokens)**.
  - No password-protected or encrypted PDFs. All active models support PDFs.
- **How a PDF is read and billed:** every page becomes an image plus its extracted text. Text costs 1,500–3,000 tokens per page, on top of the image tokens. Citations, prompt caching and the Batch API all work with PDFs.
- **Retention and isolation:**
  - PDF support is eligible for zero data retention, except "Covered Models".
  - The **Files API is not eligible for zero data retention**.
  - The Files API is GA (no beta header), allows 500 MB per file and 1 TB per org, and is **workspace-scoped**. The docs say never to accept a `file_id` from users, and to use one workspace per tenant for hard isolation (up to 100 workspaces per org) (https://platform.claude.com/docs/en/build-with-claude/files).
- **Other formats:** `document` blocks also take `text/plain`. They do not take .docx or .xlsx, which must be converted to text or PDF first.

### What this means for the step-16 uploads (PDF, .docx, .txt, .md, .csv, 4 MB each)
- PDFs can be sent inline as base64, one request at a time.
- .docx needs text extraction first.
- .txt, .md and .csv can go as plain text.
- Using the Files API would give up zero data retention and needs a workspace per company.

The schema details come from Vapi's OpenAPI spec (https://api.vapi.ai/api-json), read on 2026-10-26.