CREATE TABLE "location_reports" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "location_reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"location_id" text NOT NULL,
	"message" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "location_reports" ADD CONSTRAINT "location_reports_location_id_location_data_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location_data"("id") ON DELETE cascade ON UPDATE no action;