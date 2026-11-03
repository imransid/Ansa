# comments (core/internal/comments)

**What:** answering comments on a business's Facebook Page posts (the
owner's direction of 2026-11-04, after the research in the owner's local
file `ansa-facebook-comments-research.md`). A comment comes through the
Page's signed webhook ([messenger](messenger.md) reads it and hands it
here), is saved once, encrypted, and answered by a job: the brain reads the
business's own details, the post and the comment and proposes; core
decides what goes out and checks it as it checks chat replies.

**The switch:** `assistant_settings.comments_on` (off by default), owners of
a business only (`settings.AsOwner`: the company row lock, the person read
again; the settings-changes limit). One person's account has no comments
to answer. A Page answers only while both `pages_read_user_content` and
`pages_manage_engagement` are granted, or it is a development stand-in.
Comments come with Messenger in the packages (`Package.AnswersComments`:
Personal has neither).

**Saving (`save.go`, the webhook's and the practice box's one path):**
- The company comes ONLY from the Page id Meta signed, connected in exactly
  one company (`messenger.findPage`, a listed cross-company read).
- One row per company and Meta comment id (`page_comments`): an ad or a
  boosted post can send a comment twice. The comment (its text, or its
  photo or video named: never downloaded) is encrypted with
  `page-comment:<company>:<comment row>:text`; the commenter's name as
  Meta gives it, one plain line of at most 200.
- Never kept: the Page's own replies inside a thread (ansa's own public
  replies come back that way). Saved skipped, with why: the Page's own
  comment on the post (`own_comment`), a reply inside a thread
  (`reply_in_thread`: only comments on the post are answered), one older
  than 7 days (`too_old`: Meta's private reply window), comments switched
  off or one person's account (`comments_off`), the Page without the two
  permissions (`not_allowed`), a package without comments (`package`).
- Otherwise its answering job (`comment.answer`) is queued in the same
  transaction.

**Answering (`answer.go`, `reading.go`, `plan.go`, `decision.go`):**
1. The switch, the Page and the package again (changed meanwhile =
   skipped); the hourly ceilings: 100 comments a business, 5 a commenter on
   one company's Page (`limit`).
2. The business's own details exactly as the chat assistant reads them
   (`assistant.GatherInputs`: name, details, hours, today's menu by label,
   the dishes not available today, instructions, categories), the saved
   answers matching the comment, the post's text (a real Page: Meta's
   `GET /{post id}?fields=message` with the Page's token; else the text of
   the post ansa published, or the practice post; at most 1,000
   characters; never stored) and the comment (at most 2,000).
3. One AI reply of the package counted (as chats: never with the
   business's own key); none left = skipped (`package`), the AI not asked.
4. The brain (`POST /v1/comments/reply`, [brain-service](brain-service.md))
   proposes a kind (question, order, complaint, thanks, spam, unsure) and
   its texts. CORE decides (`planFor`, pure):
   - **question**: the AI's public reply (one plain line, at most 300),
     after ansa's reply checks (`assistant.CheckReply`: amounts only from
     the menu or the owner's own texts, the post's included; no refund
     words; no unknown link).
   - **order** (a price, or wanting to order): a public note chosen by ansa
     (`texts.go`: five wordings in English and five in Bangla, Bangla for a
     comment mostly in Bengali script as `orders.LanguageOf` decides, picked
     by a hash of the comment's id so neighbouring comments differ) and a
     private message: the AI label (`assistant.AILabelIn`, in the comment's
     language) and the AI's text (at most 1,500), after the same checks.
   - **complaint** or **unsure** (also: a text the checks stopped, an empty
     or too long one, an AI that failed, is missing or answered nothing
     usable): a public note (an apology for a complaint), the AI label and
     the business's holding reply in private (never the AI's text), and a
     request (`tickets.CreateChatTicketWithin`: channel chat, the company
     row lock first, routed like every request; the AI's subject, summary
     and category, or "Comment reply stopped: ..." / "Facebook comment
     needs you"; the reason in plain words, `assistant.ReasonText`; never
     the comment), and the owners' alert (`comment.alert`, 20 s later:
     [alerts](alerts.md)).
   - **thanks** and **spam**: nothing (skipped, with that reason).
   Saved in ONE transaction, only while the comment is undecided (a retried
   run never decides twice); every text encrypted
   (`...:public_reply`, `...:private_message`).
5. **"Ask me first"** (`reply_mode` ask_first): the AI's own texts wait
   (status `waiting`): a question's public reply, an order's private
   message, and that order's public note with it (it announces the private
   message, so it never goes first). ansa's fixed notes and the holding
   reply of a complaint never wait.

**Sending (`deliver.go`, `delivery_store.go`):** the private message first,
then the public reply, through core/internal/messenger (the ONLY code that
talks to Meta): Meta's private reply (`POST /{page id}/messages`,
`recipient {comment_id}`, messaging_type RESPONSE, one message per comment)
and the public reply (`POST /{comment id}/comments`), each with the Page's
token (read by core/internal/social right before) and `appsecret_proof`;
only ids and status codes read, errors as codes. A private message needs
`pages_messaging` (or a stand-in): without it, it fails before Meta is
asked, and a public note announcing it is never posted
(`private_message_failed`). Each part ends `sent`, `failed` or `unclear`;
the comment `answered`, or `failed` when every part failed. The start of
sending is claimed once (`delivery_started_at`): a run cut off after it
never sends again by itself, and what it left "sending" becomes `unclear`.
**Joining Messenger:** Meta's answer to a private reply names the
commenter's Page-scoped id; the contact `"<page id>:<psid>"` and its
Messenger conversation are found or made, the private message saved in it
as ansa's (encrypted, `sent`, Meta's id:
`conversations.InsertSentAssistantMessageWithin`), and the comment's
request becomes that conversation's. When they answer in Messenger their
message joins it and the chat assistant carries on (orders included).
**Stand-in (development):** the stand-in Page's replies are written to
`.dev-messages/` (`to`: `facebook-comment:<id>` or
`messenger:<page>:<psid>`), its commenter's id is `standins.PSID(name)`, so
the practice chat's Messenger chat for the same name shows the private
message and continues it. Production refuses stand-ins (`not_connected`).

**Send and Discard (`review.go`):** anyone in the company (the person read
again), only while the comment waits: Send makes its waiting parts
"sending" and queues the job (it sends them, once); Discard sends nothing
(skipped, `discarded`, shown to the screens as skipped with no reason).
Who pressed it is kept.

**API ([api](api.md), `internal/api/comments.go`, `practice_comments.go`):**
- `GET /api/v1/comments?page=N` (everyone): `{comments, total, page,
  pageSize: 50, commentsOn}`, newest first; each `{id, receivedAt,
  commenterName, postText (the first 200 characters of a post ansa
  published, else ""), text ("" when unreadable), readable, kind, status,
  skipReason, publicReply {text, status} | null, privateMessage {text,
  status, conversationId} | null, requestNumber (0 = none)}`. While a
  comment is `new` (being answered or sent) its parts are null.
- `POST /api/v1/comments/{id}/send` and `/discard`, body `{}` (everyone,
  the inbox-changes limit): `{"outcome": "sent" | "discarded" | "changed"}`
  ("changed": no longer waiting, or not this company's).
- `GET /api/v1/comments/settings` (everyone): `{on, canChange, pages:
  [{name, allowed}]}`. `POST` `{"on": bool}` (owners, settings-changes
  limit): `{"outcome": "saved"}`; a member 403, a person's account 409.
- Practice (development and owners only, as the practice chat):
  `GET /api/v1/practice/comment/posts` (the stand-in Page's newest 10
  published posts, their first 300 characters; none = ansa's fixed post
  `dev-post-todays-special`, "Today's special: Kacchi Biryani, cooked
  fresh this morning."), `POST /api/v1/practice/comment` `{postId, name,
  text}` (one of those posts, a name of 1-100, a comment of 1-2,000; 300 an
  hour per company; no stand-in Page = 409) saved through `Save` as Meta's
  are: `{commentId}`; `GET /api/v1/practice/comment/{commentId}`: one
  comment as in the list, and `next`: "answering" while it is new, else
  "done".

**Logging:** codes and error types only (`comments: run finished`,
`comments: brain unavailable`); never a comment, a reply, a name or a token.

**Tests:** `save_test.go` (saved once, encrypted for its company and row;
the Page's own replies never kept; own comment, thread reply, too old,
switched off, a person's account, one permission only, no package);
`answer_test.go` (a question in public, the brain's slice; a price question
in Bangla: a Bangla note, the AI label first, the Messenger conversation
made and their answer joining it; a made-up price stopped, a request with
its reason in the commenter's conversation, the owners alerted; a complaint
and praise and spam; the AI down; production refusing stand-ins);
`review_test.go` (Ask me first: waiting, Send once through the job,
Discard, another company's people and comments); `more_test.go` (the
ceilings and the package's AI replies; a run cut off; a real Page through a
fake Graph API: the post read, the private reply first with the comment's
id, the public note, Meta's ids kept; no note without its private message;
the notes vary; core decides what the brain proposes);
`internal/messenger/comment_test.go`, `internal/api/comments_test.go`,
`internal/alerts/comments_test.go`; the demo's (`cmd/simulate/demo_test.go`).
