CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "callbacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"caller_id" uuid,
	"due_at" timestamp with time zone NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "callbacks_status_check" CHECK (status in ('pending', 'done', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"caller_id" uuid NOT NULL,
	"called_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text NOT NULL,
	"duration_sec" integer,
	"notes" text DEFAULT '' NOT NULL,
	"undo" jsonb,
	CONSTRAINT "calls_outcome_check" CHECK (outcome in ('answered', 'no_answer', 'busy', 'switched_off', 'wrong_number', 'interested', 'not_interested', 'callback_requested', 'will_enroll'))
);
--> statement-breakpoint
CREATE TABLE "campaign_callers" (
	"campaign_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"daily_call_target" integer,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "campaign_callers_campaign_id_user_id_pk" PRIMARY KEY("campaign_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"class_label" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"daily_call_target" integer DEFAULT 0 NOT NULL,
	"enrollment_target" integer DEFAULT 0 NOT NULL,
	"script" text DEFAULT '' NOT NULL,
	"fee" text DEFAULT '' NOT NULL,
	"link" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_status_check" CHECK (status in ('draft', 'active', 'ended')),
	CONSTRAINT "campaigns_dates_check" CHECK ("campaigns"."end_date" >= "campaigns"."start_date")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"alt_phone" text,
	"school" text DEFAULT '' NOT NULL,
	"district" text DEFAULT '' NOT NULL,
	"grade_or_batch" text DEFAULT '' NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"assigned_to" uuid,
	"stage" text DEFAULT 'new' NOT NULL,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_call_at" timestamp with time zone,
	"last_outcome" text,
	"next_callback_at" timestamp with time zone,
	"last_whatsapp_at" timestamp with time zone,
	"import_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_stage_check" CHECK (stage in ('new', 'contacted', 'interested', 'payment_details_sent', 'enrolled', 'not_interested', 'wrong_number', 'do_not_contact')),
	CONSTRAINT "contacts_last_outcome_check" CHECK (last_outcome is null or last_outcome in ('answered', 'no_answer', 'busy', 'switched_off', 'wrong_number', 'interested', 'not_interested', 'callback_requested', 'will_enroll'))
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"campaign_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"file_name" text DEFAULT '' NOT NULL,
	"mapping" jsonb,
	"strategy" text NOT NULL,
	"one_caller_id" uuid,
	"default_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"default_source" text DEFAULT '' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"rejected_in_browser" jsonb,
	"status" text DEFAULT 'running' NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_batches_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "import_chunks" (
	"batch_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"created" integer[] NOT NULL,
	"skipped" integer[] NOT NULL,
	"invalid" integer[] NOT NULL,
	CONSTRAINT "import_chunks_batch_id_index_pk" PRIMARY KEY("batch_id","index")
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"language" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "templates_language_check" CHECK (language in ('si', 'en'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"phone" text,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_role_check" CHECK (role in ('owner', 'caller'))
);
--> statement-breakpoint
CREATE TABLE "whatsapp_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"caller_id" uuid NOT NULL,
	"template_id" uuid,
	"template_name" text DEFAULT '' NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callbacks" ADD CONSTRAINT "callbacks_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callbacks" ADD CONSTRAINT "callbacks_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callbacks" ADD CONSTRAINT "callbacks_caller_id_users_id_fk" FOREIGN KEY ("caller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_caller_id_users_id_fk" FOREIGN KEY ("caller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_callers" ADD CONSTRAINT "campaign_callers_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_callers" ADD CONSTRAINT "campaign_callers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_one_caller_id_users_id_fk" FOREIGN KEY ("one_caller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_chunks" ADD CONSTRAINT "import_chunks_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_logs" ADD CONSTRAINT "whatsapp_logs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_logs" ADD CONSTRAINT "whatsapp_logs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_logs" ADD CONSTRAINT "whatsapp_logs_caller_id_users_id_fk" FOREIGN KEY ("caller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_logs" ADD CONSTRAINT "whatsapp_logs_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_at_index" ON "audit_events" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_action_at_index" ON "audit_events" USING btree ("action","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_entity_entity_id_at_index" ON "audit_events" USING btree ("entity","entity_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_actor_id_index" ON "audit_events" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "callbacks_one_pending_per_contact" ON "callbacks" USING btree ("contact_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "callbacks_caller_id_status_due_at_index" ON "callbacks" USING btree ("caller_id","status","due_at");--> statement-breakpoint
CREATE INDEX "callbacks_campaign_id_status_due_at_index" ON "callbacks" USING btree ("campaign_id","status","due_at");--> statement-breakpoint
CREATE INDEX "callbacks_contact_id_index" ON "callbacks" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "calls_contact_id_called_at_index" ON "calls" USING btree ("contact_id","called_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "calls_campaign_id_called_at_index" ON "calls" USING btree ("campaign_id","called_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "calls_caller_id_called_at_index" ON "calls" USING btree ("caller_id","called_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "campaign_callers_user_id_index" ON "campaign_callers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_campaign_phone_key" ON "contacts" USING btree ("campaign_id","phone");--> statement-breakpoint
CREATE INDEX "contacts_phone_index" ON "contacts" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "contacts_campaign_id_assigned_to_stage_index" ON "contacts" USING btree ("campaign_id","assigned_to","stage");--> statement-breakpoint
CREATE INDEX "contacts_campaign_id_created_at_index" ON "contacts" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "contacts_campaign_id_assigned_to_next_callback_at_index" ON "contacts" USING btree ("campaign_id","assigned_to","next_callback_at");--> statement-breakpoint
CREATE INDEX "contacts_campaign_id_assigned_to_last_call_at_index" ON "contacts" USING btree ("campaign_id","assigned_to","last_call_at");--> statement-breakpoint
CREATE INDEX "contacts_assigned_to_index" ON "contacts" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "contacts_import_batch_id_index" ON "contacts" USING btree ("import_batch_id");--> statement-breakpoint
CREATE INDEX "contacts_tags_idx" ON "contacts" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "import_batches_campaign_id_index" ON "import_batches" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "import_batches_created_by_index" ON "import_batches" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "import_batches_one_caller_id_index" ON "import_batches" USING btree ("one_caller_id");--> statement-breakpoint
CREATE INDEX "whatsapp_logs_contact_id_sent_at_index" ON "whatsapp_logs" USING btree ("contact_id","sent_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "whatsapp_logs_campaign_id_sent_at_index" ON "whatsapp_logs" USING btree ("campaign_id","sent_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "whatsapp_logs_caller_id_index" ON "whatsapp_logs" USING btree ("caller_id");--> statement-breakpoint
CREATE INDEX "whatsapp_logs_template_id_index" ON "whatsapp_logs" USING btree ("template_id");