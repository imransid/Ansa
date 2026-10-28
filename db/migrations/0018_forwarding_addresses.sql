ALTER TABLE "inbound_addresses" DROP CONSTRAINT "inbound_addresses_address_unique";--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "inbound_token" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_inbound_token_unique" UNIQUE("inbound_token");--> statement-breakpoint
ALTER TABLE "inbound_addresses" ADD CONSTRAINT "inbound_addresses_company_id_address_unique" UNIQUE("company_id","address");--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_inbound_token_format" CHECK ("companies"."inbound_token" ~ '^[0-9a-f]{32}$');