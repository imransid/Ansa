CREATE TABLE "assistant_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "assistant_activity_action_known" CHECK ("assistant_activity"."action" IN ('call_solved', 'call_needs_person', 'email_made_request', 'taken_over', 'handed_back'))
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "contacts_company_channel_external_unique" UNIQUE("company_id","channel","external_id"),
	CONSTRAINT "contacts_channel_known" CHECK ("contacts"."channel" IN ('telegram', 'messenger', 'phone', 'email', 'stand_in')),
	CONSTRAINT "contacts_external_id_length" CHECK (char_length("contacts"."external_id") BETWEEN 1 AND 400),
	CONSTRAINT "contacts_display_name_length" CHECK (char_length("contacts"."display_name") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"handled_by" text DEFAULT 'assistant' NOT NULL,
	"taken_over_by_user_id" text,
	"taken_over_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_customer_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "conversations_company_contact_unique" UNIQUE("company_id","contact_id"),
	CONSTRAINT "conversations_handled_by_known" CHECK ("conversations"."handled_by" IN ('assistant', 'person')),
	CONSTRAINT "conversations_taken_over_fields_together" CHECK (num_nonnulls("conversations"."taken_over_by_user_id", "conversations"."taken_over_at") = CASE WHEN "conversations"."handled_by" = 'person' THEN 2 ELSE 0 END)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"author" text NOT NULL,
	"author_user_id" text,
	"body_encrypted" text,
	"call_id" uuid,
	"inbound_email_id" uuid,
	"send_status" text,
	"channel_message_id" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "messages_call_id_unique" UNIQUE("call_id"),
	CONSTRAINT "messages_inbound_email_id_unique" UNIQUE("inbound_email_id"),
	CONSTRAINT "messages_conversation_channel_message_unique" UNIQUE("conversation_id","channel_message_id"),
	CONSTRAINT "messages_direction_known" CHECK ("messages"."direction" IN ('in', 'out')),
	CONSTRAINT "messages_author_known" CHECK ("messages"."author" IN ('customer', 'assistant', 'person')),
	CONSTRAINT "messages_send_status_known" CHECK ("messages"."send_status" IN ('draft', 'sending', 'sent', 'failed', 'unclear', 'discarded')),
	CONSTRAINT "messages_one_kind" CHECK (num_nonnulls("messages"."body_encrypted", "messages"."call_id", "messages"."inbound_email_id") = 1),
	CONSTRAINT "messages_author_matches_direction" CHECK (("messages"."author" = 'customer') = ("messages"."direction" = 'in') AND ("messages"."direction" = 'out') = ("messages"."send_status" IS NOT NULL)),
	CONSTRAINT "messages_person_named" CHECK (("messages"."author" = 'person') = ("messages"."author_user_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_company_id_id_unique" UNIQUE("company_id","id");--> statement-breakpoint
ALTER TABLE "assistant_activity" ADD CONSTRAINT "assistant_activity_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_activity" ADD CONSTRAINT "assistant_activity_conversation_in_same_company_fk" FOREIGN KEY ("company_id","conversation_id") REFERENCES "public"."conversations"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_activity" ADD CONSTRAINT "assistant_activity_actor_in_same_company_fk" FOREIGN KEY ("company_id","actor_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_in_same_company_fk" FOREIGN KEY ("company_id","contact_id") REFERENCES "public"."contacts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_taker_in_same_company_fk" FOREIGN KEY ("company_id","taken_over_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_in_same_company_fk" FOREIGN KEY ("company_id","conversation_id") REFERENCES "public"."conversations"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_in_same_company_fk" FOREIGN KEY ("company_id","author_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_call_in_same_company_fk" FOREIGN KEY ("company_id","call_id") REFERENCES "public"."calls"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_inbound_email_in_same_company_fk" FOREIGN KEY ("company_id","inbound_email_id") REFERENCES "public"."inbound_emails"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_activity_company_created_idx" ON "assistant_activity" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "conversations_company_activity_idx" ON "conversations" USING btree ("company_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_conversation_in_same_company_fk" FOREIGN KEY ("company_id","conversation_id") REFERENCES "public"."conversations"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_conversation_in_same_company_fk" FOREIGN KEY ("company_id","conversation_id") REFERENCES "public"."conversations"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_conversation_in_same_company_fk" FOREIGN KEY ("company_id","conversation_id") REFERENCES "public"."conversations"("company_id","id") ON DELETE no action ON UPDATE no action;
