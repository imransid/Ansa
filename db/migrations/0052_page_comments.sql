CREATE TABLE "page_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"page_id" text NOT NULL,
	"post_id" text NOT NULL,
	"comment_id" text NOT NULL,
	"parent_id" text,
	"commenter_id" text NOT NULL,
	"commenter_name" text,
	"text_encrypted" text NOT NULL,
	"commented_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"skip_reason" text,
	"kind" text,
	"decided_at" timestamp with time zone,
	"delivery_started_at" timestamp with time zone,
	"public_reply_encrypted" text,
	"public_reply_status" text,
	"public_reply_error" text,
	"public_reply_comment_id" text,
	"private_message_encrypted" text,
	"private_message_status" text,
	"private_message_error" text,
	"private_message_id" text,
	"conversation_id" uuid,
	"ticket_id" uuid,
	"handled_by_user_id" text,
	"handled_at" timestamp with time zone,
	CONSTRAINT "page_comments_company_comment_unique" UNIQUE("company_id","comment_id"),
	CONSTRAINT "page_comments_status_known" CHECK ("page_comments"."status" IN ('new', 'answered', 'waiting', 'skipped', 'failed')),
	CONSTRAINT "page_comments_skip_reason_known" CHECK ("page_comments"."skip_reason" IN ('thanks', 'spam', 'own_comment', 'reply_in_thread', 'comments_off', 'package', 'limit', 'too_old', 'not_allowed', 'discarded')),
	CONSTRAINT "page_comments_skip_reason_when_skipped" CHECK (("page_comments"."status" = 'skipped') = ("page_comments"."skip_reason" IS NOT NULL)),
	CONSTRAINT "page_comments_kind_known" CHECK ("page_comments"."kind" IN ('question', 'order', 'complaint', 'thanks', 'spam', 'unsure')),
	CONSTRAINT "page_comments_public_reply_status_known" CHECK ("page_comments"."public_reply_status" IN ('sending', 'sent', 'failed', 'unclear', 'waiting', 'discarded')),
	CONSTRAINT "page_comments_private_message_status_known" CHECK ("page_comments"."private_message_status" IN ('sending', 'sent', 'failed', 'unclear', 'waiting', 'discarded')),
	CONSTRAINT "page_comments_public_reply_whole" CHECK (("page_comments"."public_reply_encrypted" IS NULL) = ("page_comments"."public_reply_status" IS NULL)),
	CONSTRAINT "page_comments_private_message_whole" CHECK (("page_comments"."private_message_encrypted" IS NULL) = ("page_comments"."private_message_status" IS NULL)),
	CONSTRAINT "page_comments_public_reply_error_code" CHECK ("page_comments"."public_reply_error" IS NULL OR "page_comments"."public_reply_error" ~ '^[a-z_]{1,40}$'),
	CONSTRAINT "page_comments_private_message_error_code" CHECK ("page_comments"."private_message_error" IS NULL OR "page_comments"."private_message_error" ~ '^[a-z_]{1,40}$'),
	CONSTRAINT "page_comments_ids_length" CHECK (char_length("page_comments"."comment_id") BETWEEN 1 AND 200 AND char_length("page_comments"."post_id") BETWEEN 1 AND 200
      AND char_length("page_comments"."page_id") BETWEEN 1 AND 100 AND char_length("page_comments"."commenter_id") BETWEEN 1 AND 200),
	CONSTRAINT "page_comments_commenter_name_length" CHECK ("page_comments"."commenter_name" IS NULL OR char_length("page_comments"."commenter_name") BETWEEN 1 AND 200),
	CONSTRAINT "page_comments_handled_together" CHECK (("page_comments"."handled_by_user_id" IS NULL) = ("page_comments"."handled_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "comments_on" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "page_comments" ADD CONSTRAINT "page_comments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_comments" ADD CONSTRAINT "page_comments_connection_in_same_company_fk" FOREIGN KEY ("company_id","connection_id") REFERENCES "public"."social_connections"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_comments" ADD CONSTRAINT "page_comments_conversation_in_same_company_fk" FOREIGN KEY ("company_id","conversation_id") REFERENCES "public"."conversations"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_comments" ADD CONSTRAINT "page_comments_ticket_in_same_company_fk" FOREIGN KEY ("company_id","ticket_id") REFERENCES "public"."tickets"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_comments" ADD CONSTRAINT "page_comments_handler_in_same_company_fk" FOREIGN KEY ("company_id","handled_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_comments_company_received_idx" ON "page_comments" USING btree ("company_id","received_at");