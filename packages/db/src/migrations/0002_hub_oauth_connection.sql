CREATE TABLE "hub_oauth_connection" (
	"user_id" text NOT NULL,
	"service_id" text NOT NULL,
	"binding" text NOT NULL,
	"authorization_id" text NOT NULL,
	"pending_session_id" text,
	"pending_verifier" text,
	"pending_expires_at" timestamp with time zone,
	"grant_id" text,
	"encrypted_grant" text,
	"refresh_deadline" timestamp with time zone,
	CONSTRAINT "hub_oauth_connection_user_id_service_id_pk" PRIMARY KEY("user_id","service_id")
);
--> statement-breakpoint
ALTER TABLE "hub_oauth_connection" ADD CONSTRAINT "hub_oauth_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;