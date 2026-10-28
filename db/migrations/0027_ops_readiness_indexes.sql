CREATE INDEX "tickets_open_company_id_assignee_idx" ON "tickets" USING btree ("company_id","assigned_to_user_id","ticket_number") WHERE "tickets"."status" = 'open';--> statement-breakpoint
CREATE INDEX "tickets_open_company_id_ticket_number_idx" ON "tickets" USING btree ("company_id","ticket_number") WHERE "tickets"."status" = 'open';--> statement-breakpoint
CREATE INDEX "outgoing_emails_company_id_status_delivery_problem_idx" ON "outgoing_emails" USING btree ("company_id","status","delivery_problem");--> statement-breakpoint
CREATE INDEX "calls_company_id_phone_line_id_created_at_idx" ON "calls" USING btree ("company_id","phone_line_id","created_at");--> statement-breakpoint
CREATE INDEX "inbound_emails_company_id_ticket_id_idx" ON "inbound_emails" USING btree ("company_id","ticket_id");--> statement-breakpoint
CREATE INDEX "company_documents_company_id_created_at_idx" ON "company_documents" USING btree ("company_id","created_at");