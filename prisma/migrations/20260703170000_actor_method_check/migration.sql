-- Shared-tablet actor-identity domain guard (#11; D8, §8.14).
-- task_completions.actor_confirmation_method already exists (text NOT NULL DEFAULT 'session',
-- added in 20260703140000_completions_evidence). Prisma cannot express a CHECK constraint, so the
-- allowed domain lives here: the method must be one of the three shared-tablet actor-identity
-- values. Mirrored at the app boundary by assertValidConfirmationMethod() in src/lib/actor-identity.ts.

-- Add the constraint NOT VALID first, then VALIDATE it in a separate statement. The column
-- previously accepted arbitrary text (text NOT NULL DEFAULT 'session'), so an environment with
-- pre-existing task_completions rows could hold a legacy out-of-domain value. A plain ADD CONSTRAINT
-- validates every historical row at deploy and aborts on a single legacy typo. NOT VALID enforces
-- the CHECK only for NEW/updated rows (letting existing data be remediated independently), and the
-- subsequent VALIDATE CONSTRAINT then verifies the existing rows without blocking the schema change.
-- The test DB is ephemeral, so both statements run clean here; the split matters for real deploys.
ALTER TABLE "task_completions"
  ADD CONSTRAINT "task_completions_actor_confirmation_method_check"
  CHECK ("actor_confirmation_method" IN ('session', 'pin', 'initials')) NOT VALID;

ALTER TABLE "task_completions"
  VALIDATE CONSTRAINT "task_completions_actor_confirmation_method_check";
