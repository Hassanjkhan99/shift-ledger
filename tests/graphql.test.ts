import { describe, it, expect, inject, beforeAll, afterAll } from "vitest";
import { graphql } from "graphql";
import { randomUUID } from "node:crypto";
import { QueryClient } from "@tanstack/react-query";
import { withTenant, disconnect, type TenantClient } from "../src/lib/db";
import { schema } from "../src/lib/graphql/schema";
import { createGraphQLYoga } from "../src/lib/graphql/yoga";
import type { GraphQLContext, TenantRunner } from "../src/lib/graphql/context";
import { graphqlQueryKey, graphqlScopeKey } from "../src/lib/graphql/query-keys";
import { useOccurrencesTodayQuery, useExceptionsQuery } from "../src/generated/graphql";
import type { MemberContext } from "../src/lib/http-auth";
import type { OrgRole } from "../src/generated/prisma/enums";

// #15 — GraphQL read layer. The schema is executed directly via graphql() with a hand-built context so
// the resolvers + DataLoaders + scope-auth are exercised without HTTP; one test drives the yoga endpoint.
const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

afterAll(async () => {
  await disconnect();
});

function member(
  orgId: string,
  role: OrgRole,
  userId: string,
  propertyScope: string[] = [],
): MemberContext {
  return { organizationId: orgId, userId, role, propertyScope };
}

// A TenantRunner that wraps withTenant and counts every Prisma MODEL operation (findMany, groupBy,
// count, ...) issued through the tx — the F1 N+1 probe. The set_config/SET TIME ZONE GUC statements
// withTenant issues internally are $-prefixed and not counted; only data queries are.
function countingRun(counter: { n: number }): TenantRunner {
  return (organizationId, fn) => withTenant(organizationId, (tx) => fn(wrapCounting(tx, counter)));
}

function wrapCounting(tx: TenantClient, counter: { n: number }): TenantClient {
  return new Proxy(tx as object, {
    get(target, prop) {
      const value = (target as Record<string | symbol, unknown>)[prop];
      // A model delegate (tx.taskOccurrence, tx.evidence, ...) is a non-$ object; wrap its methods.
      if (
        typeof prop === "string" &&
        !prop.startsWith("$") &&
        value !== null &&
        typeof value === "object"
      ) {
        return new Proxy(value as object, {
          get(model, mProp) {
            const mValue = (model as Record<string | symbol, unknown>)[mProp];
            if (typeof mValue === "function") {
              return (...args: unknown[]) => {
                counter.n += 1;
                return (mValue as (...a: unknown[]) => unknown).apply(model, args);
              };
            }
            return mValue;
          },
        });
      }
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  }) as unknown as TenantClient;
}

async function memberUserId(orgId: string): Promise<string> {
  return withTenant(orgId, (tx) =>
    tx.membership.findFirstOrThrow({ select: { userId: true } }).then((m) => m.userId),
  );
}

let templateAId: string;
let userAId: string;
let userBId: string;
let siteA: { propertyId: string; outletId: string };

beforeAll(async () => {
  userAId = await memberUserId(orgAId);
  userBId = await memberUserId(orgBId);
  siteA = await withTenant(orgAId, async (tx) => {
    const property = await tx.property.findFirstOrThrow({ where: { deletedAt: null } });
    const outlet = await tx.outlet.findFirstOrThrow({
      where: { deletedAt: null, propertyId: property.id },
    });
    return { propertyId: property.id, outletId: outlet.id };
  });
  templateAId = await withTenant(orgAId, (tx) =>
    tx.taskTemplate
      .create({
        data: { organizationId: orgAId, checkType: "temperature", title: "GraphQL read layer tpl" },
        select: { id: true },
      })
      .then((r) => r.id),
  );
});

/**
 * Seed `n` occurrences (each under its own scheduled_task so the (schedule, date) unique holds), all on
 * `localDate`, each with a current completion. Ids are set client-side so createMany can wire the FKs.
 * Returns the occurrence ids.
 */
async function seedOccurrences(localDate: string, n: number): Promise<string[]> {
  const scheduleIds = Array.from({ length: n }, () => randomUUID());
  const occurrenceIds = Array.from({ length: n }, () => randomUUID());
  const dateObj = new Date(`${localDate}T00:00:00.000Z`);
  const dueAt = new Date(`${localDate}T05:00:00.000Z`);
  await withTenant(orgAId, async (tx) => {
    await tx.scheduledTask.createMany({
      data: scheduleIds.map((id) => ({
        id,
        organizationId: orgAId,
        propertyId: siteA.propertyId,
        outletId: siteA.outletId,
        taskTemplateId: templateAId,
        recurrenceJson: { freq: "daily", interval: 1, timeOfDay: "06:00" },
        recurrenceFreq: "daily" as const,
        timeOfDay: new Date("1970-01-01T06:00:00Z"),
        timezone: "Europe/Berlin",
        assigneeRole: "KitchenManager" as const,
        graceMinutes: 15,
        startsOn: new Date(Date.UTC(2026, 0, 1)),
        isActive: true,
      })),
    });
    await tx.taskOccurrence.createMany({
      data: occurrenceIds.map((id, i) => ({
        id,
        organizationId: orgAId,
        propertyId: siteA.propertyId,
        outletId: siteA.outletId,
        scheduledTaskId: scheduleIds[i],
        taskTemplateId: templateAId,
        checkType: "temperature" as const,
        occurrenceLocalDate: dateObj,
        dueAt,
        timezone: "Europe/Berlin",
        assigneeRole: "KitchenManager" as const,
        status: "completed" as const,
        completedAt: dueAt,
      })),
    });
    await tx.taskCompletion.createMany({
      data: occurrenceIds.map((id) => ({
        organizationId: orgAId,
        taskOccurrenceId: id,
        clientSubmissionId: randomUUID(),
        result: "pass" as const,
        completedBy: userAId,
      })),
    });
  });
  return occurrenceIds;
}

const TODAY_QUERY = /* GraphQL */ `
  query T($date: String) {
    occurrencesToday(date: $date) {
      outlet {
        id
        name
      }
      occurrences {
        id
        status
        checkType
        dueAt
        template {
          id
          title
        }
        currentCompletion {
          id
          result
          evidenceCount
        }
      }
    }
  }
`;

async function runToday(date: string, run: TenantRunner) {
  return graphql({
    schema,
    source: TODAY_QUERY,
    variableValues: { date },
    contextValue: {
      member: member(orgAId, "KitchenManager", userAId),
      run,
    } satisfies GraphQLContext,
  });
}

// ---- F1: DataLoader batching — constant query count regardless of row count ----
describe("occurrencesToday — N+1 (F1): query count is constant and <= 3", () => {
  it("issues the same (<=3) number of DB queries for 1 occurrence and for 200", async () => {
    await seedOccurrences("2028-01-03", 1);
    const c1 = { n: 0 };
    const r1 = await runToday("2028-01-03", countingRun(c1));
    expect(r1.errors).toBeUndefined();
    const groups1 = (r1.data as { occurrencesToday: { occurrences: unknown[] }[] })
      .occurrencesToday;
    expect(groups1.reduce((sum, g) => sum + g.occurrences.length, 0)).toBe(1);

    await seedOccurrences("2028-02-03", 200);
    const c200 = { n: 0 };
    const r200 = await runToday("2028-02-03", countingRun(c200));
    expect(r200.errors).toBeUndefined();
    const groups200 = (r200.data as { occurrencesToday: { occurrences: unknown[] }[] })
      .occurrencesToday;
    expect(groups200.reduce((sum, g) => sum + g.occurrences.length, 0)).toBe(200);

    // The heart of F1: the batched query count does not grow with N, and stays within budget.
    expect(c200.n).toBe(c1.n);
    expect(c1.n).toBeLessThanOrEqual(3);
    // Concretely: occurrence list + batched current-completion load + batched evidence-count load.
    expect(c1.n).toBe(3);
  });
});

// ---- Correct outlet-grouped shape (acceptance #1) -------------------------------
describe("occurrencesToday — outlet-grouped shape", () => {
  it("returns occurrences grouped under their outlet", async () => {
    await seedOccurrences("2028-03-03", 2);
    const res = await runToday("2028-03-03", withTenant);
    expect(res.errors).toBeUndefined();
    const groups = (
      res.data as {
        occurrencesToday: { outlet: { id: string }; occurrences: { id: string }[] }[];
      }
    ).occurrencesToday;
    const group = groups.find((g) => g.outlet.id === siteA.outletId);
    expect(group).toBeDefined();
    expect(group!.occurrences.length).toBeGreaterThanOrEqual(2);
  });
});

// ---- D6: cross-tenant id is masked as not-found --------------------------------
describe("occurrence(id) — cross-tenant isolation (D6)", () => {
  it("returns null for another org's occurrence id, but the owning org sees it", async () => {
    const [occId] = await seedOccurrences("2028-04-03", 1);
    const source = /* GraphQL */ `
      query O($id: ID!) {
        occurrence(id: $id) {
          id
        }
      }
    `;

    // Org B (a real member of B) must NOT see org A's occurrence.
    const asB = await graphql({
      schema,
      source,
      variableValues: { id: occId },
      contextValue: { member: member(orgBId, "KitchenManager", userBId), run: withTenant },
    });
    expect(asB.errors).toBeUndefined();
    expect((asB.data as { occurrence: unknown }).occurrence).toBeNull();

    // Sanity: org A does see it (proves the null above is tenant masking, not a broken query).
    const asA = await graphql({
      schema,
      source,
      variableValues: { id: occId },
      contextValue: { member: member(orgAId, "KitchenManager", userAId), run: withTenant },
    });
    expect((asA.data as { occurrence: { id: string } | null }).occurrence?.id).toBe(occId);
  });
});

// ---- scope-auth: a role below the required scope is rejected --------------------
describe("scope-auth — role gating on triage reads", () => {
  it("rejects a Staff member on openExceptionsCount but allows a KitchenManager", async () => {
    const source = /* GraphQL */ `
      {
        openExceptionsCount
      }
    `;
    const asStaff = await graphql({
      schema,
      source,
      contextValue: { member: member(orgAId, "Staff", userAId), run: withTenant },
    });
    expect(asStaff.errors && asStaff.errors.length).toBeGreaterThan(0);
    expect(
      (asStaff.data as { openExceptionsCount: number | null })?.openExceptionsCount ?? null,
    ).toBeNull();

    const asManager = await graphql({
      schema,
      source,
      contextValue: { member: member(orgAId, "KitchenManager", userAId), run: withTenant },
    });
    expect(asManager.errors).toBeUndefined();
    expect(typeof (asManager.data as { openExceptionsCount: number }).openExceptionsCount).toBe(
      "number",
    );
  });

  it("rejects an unauthenticated (no member) caller on a member-scoped read", async () => {
    const res = await graphql({
      schema,
      source: /* GraphQL */ `
        {
          occurrencesToday {
            outlet {
              id
            }
          }
        }
      `,
      contextValue: { member: null, run: withTenant },
    });
    expect(res.errors && res.errors.length).toBeGreaterThan(0);
  });
});

// ---- The yoga endpoint executes operations -------------------------------------
describe("POST /api/graphql (yoga)", () => {
  it("executes occurrencesToday through the embedded yoga handler", async () => {
    await seedOccurrences("2028-05-03", 1);
    const yoga = createGraphQLYoga({
      resolveContext: async () => member(orgAId, "KitchenManager", userAId),
      run: withTenant,
    });
    const res = await yoga.fetch("http://localhost/api/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: TODAY_QUERY, variables: { date: "2028-05-03" } }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data?: { occurrencesToday: { occurrences: unknown[] }[] };
      errors?: unknown[];
    };
    expect(json.errors).toBeUndefined();
    const total = json.data!.occurrencesToday.reduce((s, g) => s + g.occurrences.length, 0);
    expect(total).toBe(1);
  });
});

// ---- Codegen + the query-key convention (D10) ----------------------------------
describe("generated hooks + query-key convention (D10)", () => {
  it("codegen emitted typed react-query hooks with getKey helpers", () => {
    expect(typeof useOccurrencesTodayQuery).toBe("function");
    expect(typeof useOccurrencesTodayQuery.getKey).toBe("function");
    expect(typeof useExceptionsQuery).toBe("function");
  });

  it("graphqlQueryKey builds the [org, property?, outlet?, 'graphql', op, vars] shape", () => {
    expect(graphqlQueryKey({ org: "o1" }, "OccurrencesToday", { date: "2028-01-01" })).toEqual([
      "o1",
      "graphql",
      "OccurrencesToday",
      { date: "2028-01-01" },
    ]);
    expect(
      graphqlQueryKey({ org: "o1", property: "p1", outlet: "x1" }, "OccurrencesToday", {}),
    ).toEqual(["o1", "p1", "x1", "graphql", "OccurrencesToday", {}]);
  });

  it("a scope prefix invalidates a full operation key (invalidateQueries prefix match)", async () => {
    const qc = new QueryClient();
    const scope = { org: "o1", property: "p1", outlet: "x1" };
    const fullKey = graphqlQueryKey(scope, "OccurrencesToday", { date: "2028-01-01" });
    qc.setQueryData(fullKey, { seeded: true });
    expect(qc.getQueryState(fullKey)?.isInvalidated ?? false).toBe(false);

    // #17's contract: invalidating the scope prefix drops the cached read.
    await qc.invalidateQueries({ queryKey: graphqlScopeKey(scope) });
    expect(qc.getQueryState(fullKey)?.isInvalidated).toBe(true);
  });
});
