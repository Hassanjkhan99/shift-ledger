-- Better Auth provider tables (#114). Managed by Better Auth via its Prisma adapter (src/lib/auth.ts).
-- GLOBAL (not tenant-scoped, NO RLS) like `users`: authentication identity/session is not per-tenant;
-- tenancy is resolved separately via organizations/memberships (resolveMemberContext). Text ids
-- (Better Auth generates them). Named auth_* to avoid colliding with the domain schema.

CREATE TABLE "auth_user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_user_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "auth_user_email_key" ON "auth_user"("email");

CREATE TABLE "auth_session" (
    "id" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "token" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "auth_session_token_key" ON "auth_session"("token");
CREATE INDEX "auth_session_user_id_idx" ON "auth_session"("user_id");
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "auth_account" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(6),
    "refresh_token_expires_at" TIMESTAMPTZ(6),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_account_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "auth_account_user_id_idx" ON "auth_account"("user_id");
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "auth_verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_verification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification"("identifier");
