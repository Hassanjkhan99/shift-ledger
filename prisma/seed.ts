// Seed two demo organizations with users, memberships, properties, outlets, and an
// activity_log entry each. Seeding connects as the SUPERUSER (SUPERUSER_DATABASE_URL) so
// it bypasses RLS and can populate multiple tenants. The app runtime never uses this role.
//
// Idempotent: safe to run repeatedly (upserts on natural keys).
import "dotenv/config"; // load .env when run standalone via `tsx prisma/seed.ts`
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

export interface SeedResult {
  orgAId: string;
  orgBId: string;
}

async function seedOrg(
  db: PrismaClient,
  opts: {
    name: string;
    slug: string;
    timezone: string;
    country: string;
    locale: string;
    ownerEmail: string;
  },
) {
  const org = await db.organization.upsert({
    where: { slug: opts.slug },
    update: {},
    create: {
      name: opts.name,
      slug: opts.slug,
      defaultTimezone: opts.timezone,
      defaultLocale: opts.locale,
    },
  });

  const owner = await db.user.upsert({
    where: { email: opts.ownerEmail },
    update: {},
    create: {
      email: opts.ownerEmail,
      name: `${opts.name} Owner`,
      emailVerified: true,
      locale: opts.locale,
    },
  });

  await db.membership.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: owner.id } },
    update: {},
    create: { organizationId: org.id, userId: owner.id, role: "Owner" },
  });

  const property = await db.property.upsert({
    where: { organizationId_name: { organizationId: org.id, name: `${opts.name} — Main Site` } },
    update: {},
    create: {
      organizationId: org.id,
      name: `${opts.name} — Main Site`,
      timezone: opts.timezone,
      countryCode: opts.country,
    },
  });

  await db.outlet.upsert({
    where: { propertyId_name: { propertyId: property.id, name: "Main Kitchen" } },
    update: {},
    create: { organizationId: org.id, propertyId: property.id, name: "Main Kitchen" },
  });

  // One audit entry per org (only if none exists yet — activity_log has no natural unique key).
  const existing = await db.activityLog.count({ where: { organizationId: org.id } });
  if (existing === 0) {
    await db.activityLog.create({
      data: {
        organizationId: org.id,
        subjectType: "organization",
        subjectId: org.id,
        action: "organization.seeded",
        actorLabel: "system:seed",
      },
    });
  }

  return org.id;
}

export async function seed(
  connectionString = process.env.SUPERUSER_DATABASE_URL,
): Promise<SeedResult> {
  if (!connectionString) {
    throw new Error("SUPERUSER_DATABASE_URL is not set (seeding must bypass RLS as superuser)");
  }
  const adapter = new PrismaPg({ connectionString });
  const db = new PrismaClient({ adapter });
  try {
    const orgAId = await seedOrg(db, {
      name: "Demo Hotel Group A",
      slug: "demo-a",
      timezone: "Europe/Berlin",
      country: "DE",
      locale: "de",
      ownerEmail: "owner-a@example.com",
    });
    const orgBId = await seedOrg(db, {
      name: "Demo Hotel Group B",
      slug: "demo-b",
      timezone: "Europe/Amsterdam",
      country: "NL",
      locale: "nl",
      ownerEmail: "owner-b@example.com",
    });
    return { orgAId, orgBId };
  } finally {
    await db.$disconnect();
  }
}

// CLI entry: `npm run seed`
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("prisma/seed.ts")) {
  seed()
    .then((ids) => {
      console.log("Seeded:", ids);
      process.exit(0);
    })
    .catch((e) => {
      console.error("Seed failed:", e);
      process.exit(1);
    });
}
