# conversations (core/internal/conversations)

**What:** the Inbox's data: contacts (one per customer and channel),
conversations (one per contact) and messages.
**Rules:**
- Every function takes the company first; every statement names `company_id`.
- A message's text is stored encrypted with the context
  `conversation-message:<company>:<message id>` (`MessageContext`), the same
  as the old backend.
- A customer's message is saved once per channel message id (a platform
  sending it twice changes nothing), with the assistant's reply job in the
  same transaction (so a failure can't leave it saved and unanswered: the
  platform's retry would find it saved), and returns a `Turn`; it restarts
  the 24-hour reply window.
- A message the business wrote in its own app (Telegram, its Facebook Page,
  the WhatsApp Business app: each channel passes who connected that account)
  is saved as `business_account` (`own_answer.go`). Answering yourself means
  you're handling it (the owner's direction, 2026-11-03): in the same
  transaction ansa's wait to step in ends and its reply waiting for approval
  ("Ask me first") is discarded; where ansa answers every message
  ("Always", also before anything is saved) the conversation is also taken
  over, as a person's reply in ansa takes it, until someone presses "Hand
  back to ansa". With "Only when I'm away" it is not taken over. The
  conversation records a person for a take over (the database's rule): the
  one who connected the account. The activity lines it writes
  (`taken_over`, `draft_discarded`) name no one: nobody did anything in ansa.
- A message ansa sent by another way than the conversation's route, the
  private reply to a customer's Facebook comment ([comments](comments.md)),
  is saved as ansa's, "sent", once per Meta's id
  (`InsertSentAssistantMessageWithin`, `sent.go`, in the caller's
  transaction with `ConversationForWithin`): it moves the conversation up
  the Inbox, never the 24-hour window (only the customer's own message
  opens it), and the next automated message carries no AI label again.
- Two saves at once for a new contact end on one conversation.
**Tests:** `store_test.go`, `own_answer_test.go` (live database: "Always"
takes over in the holder's name with lines naming no one, a second answer
changes nothing more; "Only when I'm away" only ends the wait; both discard
ansa's waiting reply).
