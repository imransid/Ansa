CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"line_total_cents" integer NOT NULL,
	CONSTRAINT "order_items_name_length" CHECK (char_length("order_items"."name") BETWEEN 1 AND 120),
	CONSTRAINT "order_items_quantity_range" CHECK ("order_items"."quantity" BETWEEN 1 AND 50),
	CONSTRAINT "order_items_amounts" CHECK ("order_items"."unit_price_cents" >= 0 AND "order_items"."line_total_cents" = "order_items"."quantity" * "order_items"."unit_price_cents")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"order_number" integer,
	"status" text NOT NULL,
	"fulfilment" text NOT NULL,
	"address_encrypted" text,
	"notes_encrypted" text,
	"wanted_time" text NOT NULL,
	"currency" text NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"delivery_fee_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"summary_message_id" uuid,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"placed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "orders_company_number_unique" UNIQUE("company_id","order_number"),
	CONSTRAINT "orders_status_known" CHECK ("orders"."status" IN ('proposed', 'new', 'accepted', 'ready', 'done', 'cancelled')),
	CONSTRAINT "orders_fulfilment_known" CHECK ("orders"."fulfilment" IN ('delivery', 'pickup')),
	CONSTRAINT "orders_number_once_placed" CHECK (("orders"."status" = 'proposed') = ("orders"."order_number" IS NULL) AND ("orders"."order_number" IS NULL) = ("orders"."placed_at" IS NULL)),
	CONSTRAINT "orders_number_positive" CHECK ("orders"."order_number" IS NULL OR "orders"."order_number" > 0),
	CONSTRAINT "orders_address_only_for_delivery" CHECK (("orders"."fulfilment" = 'delivery') = ("orders"."address_encrypted" IS NOT NULL)),
	CONSTRAINT "orders_wanted_time_length" CHECK (char_length("orders"."wanted_time") BETWEEN 1 AND 100),
	CONSTRAINT "orders_currency_format" CHECK ("orders"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "orders_amounts_add_up" CHECK ("orders"."subtotal_cents" >= 0 AND "orders"."delivery_fee_cents" >= 0 AND "orders"."total_cents" = "orders"."subtotal_cents" + "orders"."delivery_fee_cents"),
	CONSTRAINT "orders_fee_only_for_delivery" CHECK ("orders"."fulfilment" = 'delivery' OR "orders"."delivery_fee_cents" = 0)
);
--> statement-breakpoint
ALTER TABLE "assistant_activity" DROP CONSTRAINT "assistant_activity_action_known";--> statement-breakpoint
ALTER TABLE "assistant_activity" DROP CONSTRAINT "assistant_activity_reason_known";--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD COLUMN "delivery_fee_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_in_same_company_fk" FOREIGN KEY ("company_id","order_id") REFERENCES "public"."orders"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_conversation_in_same_company_fk" FOREIGN KEY ("company_id","conversation_id") REFERENCES "public"."conversations"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_updater_in_same_company_fk" FOREIGN KEY ("company_id","updated_by_user_id") REFERENCES "public"."users"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_one_proposed_per_conversation" ON "orders" USING btree ("company_id","conversation_id") WHERE "orders"."status" = 'proposed';--> statement-breakpoint
CREATE INDEX "orders_company_status_placed_idx" ON "orders" USING btree ("company_id","status","placed_at");--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_delivery_fee_range" CHECK ("assistant_settings"."delivery_fee_cents" BETWEEN 0 AND 100000000);--> statement-breakpoint
ALTER TABLE "assistant_activity" ADD CONSTRAINT "assistant_activity_action_known" CHECK ("assistant_activity"."action" IN ('call_solved', 'call_needs_person', 'email_made_request', 'taken_over', 'handed_back', 'replied', 'drafted', 'handed_over', 'draft_sent', 'draft_discarded', 'order_placed'));--> statement-breakpoint
ALTER TABLE "assistant_activity" ADD CONSTRAINT "assistant_activity_reason_known" CHECK ("assistant_activity"."reason" IN ('unsure', 'complaint', 'refund', 'asked_for_person', 'order', 'needs_decision', 'important_person', 'price_not_on_menu', 'refund_promise', 'unknown_link', 'unusable_answer', 'model_failed', 'model_unavailable', 'reply_limit', 'send_failed', 'order_change', 'order_unclear'));