-- Shared-tablet PIN mechanism (#69; D8, §8.8/§8.14).
-- Hand-written to match schema.prisma AND to express what Prisma cannot: RLS (ENABLE + FORCE +
-- tenant_isolation policy). staff_pins is a MUTABLE, org-scoped table (one PIN per member per
-- org): NOT append-only — a PIN is set/reset/relocked in place, so it has updated_at and no
-- reject trigger (unlike activity_log / task_completions). The PIN is stored ONLY as a scrypt
-- hash (pin_hash), never plaintext; issuance/verification/lockout live in src/lib/staff-pin.ts.

-- ============================================================================
-- Table (§8.8 — per-membership PIN, keyed by (organization_id, user_id))
-- ============================================================================

CREATE TABLE "staff_pins" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "pin_set_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "staff_pins_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- Constraints + indexes
-- ============================================================================

-- One PIN per member per org.
CREATE UNIQUE INDEX "staff_pins_org_user_key" ON "staff_pins"("organization_id", "user_id");

-- Pick-user / verify lookups by (org, user).
CREATE INDEX "staff_pins_org_user_idx" ON "staff_pins"("organization_id", "user_id");

-- ============================================================================
-- Foreign keys (ON DELETE RESTRICT per §8.0 — audit integrity, no cascading hard delete).
-- ============================================================================

ALTER TABLE "staff_pins" ADD CONSTRAINT "staff_pins_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_pins" ADD CONSTRAINT "staff_pins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Row-Level Security (ENABLE + FORCE + tenant_isolation) — mirrors exceptions_corrective.
-- Predicate reads transaction-local GUC app.current_org_id; unset => NULL => zero rows.
-- Mutable table: NO append-only reject trigger.
-- ============================================================================

ALTER TABLE "staff_pins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_pins" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "staff_pins"
  USING ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
