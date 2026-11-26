CREATE TABLE "tenant_email_settings" (
    "tenant_id" INTEGER NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::integer,
    "sender_name" VARCHAR(100) NOT NULL,
    "sender_email" VARCHAR(255) NOT NULL,
    "api_key_encrypted" TEXT NOT NULL,
    "checked_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "tenant_email_settings_pkey" PRIMARY KEY ("tenant_id"),
    CONSTRAINT "tenant_email_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id")
        REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "tenant_email_settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_email_settings" FOR ALL TO app_user
    USING (tenant_id = (SELECT NULLIF(current_setting('app.tenant_id', true), '')::integer))
    WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.tenant_id', true), '')::integer));

REVOKE ALL ON "tenant_email_settings" FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
    FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
        EXECUTE format('REVOKE ALL ON TABLE tenant_email_settings FROM %I', api_role);
    END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON "tenant_email_settings" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_email_settings" TO app_admin;
