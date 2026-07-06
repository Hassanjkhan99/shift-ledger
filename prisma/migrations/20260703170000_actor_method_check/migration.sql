-- Shared-tablet actor-identity domain guard (#11; D8, §8.14).
-- task_completions.actor_confirmation_method already exists (text NOT NULL DEFAULT 'session',
-- added in 20260703140000_completions_evidence). Prisma cannot express a CHECK constraint, so the
-- allowed domain lives here: the method must be one of the three shared-tablet actor-identity
-- values. Mirrored at the app boundary by assertValidConfirmationMethod() in src/lib/actor-identity.ts.

-- Add the constraint NOT VALID and DO NOT validate here. The column previously accepted arbitrary
-- text (text NOT NULL DEFAULT 'session'), so an environment with pre-existing task_completions rows
-- could hold a legacy out-of-domain value; a plain ADD CONSTRAINT — or a VALIDATE in this same
-- migration — would scan every historical row at deploy and abort on a single legacy typo. NOT VALID
-- enforces the CHECK for all NEW/updated rows immediately (which is all we need going forward) while
-- leaving existing rows unscanned. Validating the backlog is intentionally deferred: a later
-- data-cleanup migration maps/removes any legacy value and only then runs
-- `VALIDATE CONSTRAINT "task_completions_actor_confirmation_method_check"`. (No such legacy data
-- exists yet — the table is new — but keeping it NOT VALID makes the deploy safe regardless.)
ALTER TABLE "task_completions"
  ADD CONSTRAINT "task_completions_actor_confirmation_method_check"
  CHECK ("actor_confirmation_method" IN ('session', 'pin', 'initials')) NOT VALID;
