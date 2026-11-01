package telegram

import "context"

// handleLinking will tie a business's Telegram account to its company (a
// one-time link code the owner made, sent with /start, then the chatbot
// added in Telegram), as the old services/telegram-updates.ts does. Until it
// is moved, such updates are answered 200 and change nothing in core.
func (h *Webhook) handleLinking(_ context.Context, _ *Update) error {
	return nil
}
