-- Shared-tablet actor-identity domain guard (#11; D8, §8.14).
-- task_completions.actor_confirmation_method already exists (text NOT NULL DEFAULT 'session',
-- added in 20260703140000_completions_evidence). Prisma cannot express a CHECK constraint, so the
-- allowed domain lives here: the method must be one of the three shared-tablet actor-identity
-- values. Mirrored at the app boundary by assertValidConfirmationMethod() in src/lib/actor-identity.ts.

ALTER TABLE "task_completions"
  ADD CONSTRAINT "task_completions_actor_confirmation_method_check"
  CHECK ("actor_confirmation_method" IN ('session', 'pin', 'initials'));
