ALTER TYPE "public"."ticket_channel" ADD VALUE IF NOT EXISTS 'chat';--> statement-breakpoint
ALTER TABLE "assistant_activity" DROP CONSTRAINT "assistant_activity_action_known";--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "ai_engine" text DEFAULT 'api_key' NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "anthropic_key_encrypted" text;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "anthropic_key_hint" text;--> statement-breakpoint
ALTER TABLE "assistant_activity" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "assistant_handled_message_id" uuid;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_ai_engine_known" CHECK ("assistant_settings"."ai_engine" IN ('api_key', 'claude_code'));--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_anthropic_key_with_hint" CHECK (num_nonnulls("assistant_settings"."anthropic_key_encrypted", "assistant_settings"."anthropic_key_hint") IN (0, 2) AND char_length("assistant_settings"."anthropic_key_hint") = 4);--> statement-breakpoint
ALTER TABLE "assistant_activity" ADD CONSTRAINT "assistant_activity_reason_known" CHECK ("assistant_activity"."reason" IN ('unsure', 'complaint', 'refund', 'asked_for_person', 'order', 'price_not_on_menu', 'refund_promise', 'unknown_link', 'unusable_answer', 'model_failed', 'model_unavailable', 'reply_limit', 'send_failed'));--> statement-breakpoint
ALTER TABLE "assistant_activity" ADD CONSTRAINT "assistant_activity_reason_only_on_handover" CHECK (("assistant_activity"."reason" IS NOT NULL) = ("assistant_activity"."action" = 'handed_over'));--> statement-breakpoint
ALTER TABLE "assistant_activity" ADD CONSTRAINT "assistant_activity_action_known" CHECK ("assistant_activity"."action" IN ('call_solved', 'call_needs_person', 'email_made_request', 'taken_over', 'handed_back', 'replied', 'drafted', 'handed_over', 'draft_sent', 'draft_discarded'));