# conversations (core/internal/conversations)

**What:** the Inbox's data: contacts (one per customer and channel),
conversations (one per contact) and messages.
**Rules:**
- Every function takes the company first; every statement names `company_id`.
- A message's text is stored encrypted with the context
  `conversation-message:<company>:<message id>` (`MessageContext`), the same
  as the old backend.
- A customer's message is saved once per channel message id (a platform
  sending it twice changes nothing) and returns a `Turn` the assistant may
  answer; it restarts the 24-hour reply window.
- A message the business wrote in its own app is saved as `business_account`
  and stops the assistant's wait to step in.
- Two saves at once for a new contact end on one conversation.
**Tests:** `store_test.go` (live database).
