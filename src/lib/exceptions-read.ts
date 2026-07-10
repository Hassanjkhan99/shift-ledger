// Exceptions read layer (#138) — the list (keyset-paginated, F5) + single-exception detail behind the
// triage screens. Tenant-scoped by the caller's withTenant() (D6). Writes go through the exceptions.ts
// edges via Server Actions; this is the read that frames them. (Wiring these through the #15 GraphQL
// layer is a follow-up; RSC + Prisma keeps #138 self-contained and F5-correct today.)
import type { TenantClient } from "./db";
import { buildKeysetWhere, buildKeysetOrderBy, encodeCursor, decodeCursor } from "./keyset";
import type { KeyColumn } from "./keyset";
import type { ExceptionStatus, CorrectiveStatus, OrgRole } from "../generated/prisma/enums";

const LIST_KEYS: KeyColumn[] = [
  { field: "openedAt", direction: "desc" },
  { field: "id", direction: "desc" },
];

export interface ExceptionListItem {
  id: string;
  title: string;
  status: ExceptionStatus;
  severity: string;
  outletName: string;
  openedAt: string;
}

export interface ExceptionListPage {
  items: ExceptionListItem[];
  nextCursor: string | null;
}

/** Keyset-paginated exceptions list (F5 — cursor seek, never row-skipping), newest first, filterable. */
export async function listExceptions(
  tx: TenantClient,
  opts: {
    status?: ExceptionStatus;
    cursor?: string | null;
    limit?: number;
    propertyScope?: readonly string[];
  } = {},
): Promise<ExceptionListPage> {
  const limit = opts.limit ?? 20;
  const cursorValues = opts.cursor ? decodeCursor(opts.cursor) : null;
  const scope = opts.propertyScope ?? [];
  const rows = await tx.exception.findMany({
    where: {
      deletedAt: null,
      ...(opts.status ? { status: opts.status } : {}),
      ...(scope.length > 0 ? { propertyId: { in: [...scope] } } : {}), // #152 scope
      ...buildKeysetWhere(LIST_KEYS, cursorValues),
    },
    orderBy: buildKeysetOrderBy(LIST_KEYS),
    take: limit + 1,
    select: {
      id: true,
      title: true,
      status: true,
      severity: true,
      openedAt: true,
      outlet: { select: { name: true } },
    },
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      severity: r.severity,
      outletName: r.outlet.name,
      openedAt: r.openedAt.toISOString(),
    })),
    nextCursor: hasMore && last ? encodeCursor([last.openedAt, last.id]) : null,
  };
}

export interface CorrectiveActionView {
  id: string;
  status: CorrectiveStatus;
  description: string;
  assigneeRole: OrgRole | null;
  assigneeUserId: string | null;
  assigneeLabel: string | null;
  dueAt: string | null;
}

export interface ExceptionDetailView {
  id: string;
  title: string;
  detail: string | null;
  status: ExceptionStatus;
  severity: string;
  propertyId: string;
  outletName: string;
  openedAt: string;
  occurrenceId: string;
  correctiveActions: CorrectiveActionView[];
}

export async function getExceptionDetail(
  tx: TenantClient,
  exceptionId: string,
  propertyScope: readonly string[] = [],
): Promise<ExceptionDetailView | null> {
  const e = await tx.exception.findFirst({
    // Out-of-scope exceptions are invisible to a scoped member (#152) — resolve to null (404).
    where: {
      id: exceptionId,
      deletedAt: null,
      ...(propertyScope.length > 0 ? { propertyId: { in: [...propertyScope] } } : {}),
    },
    select: {
      id: true,
      title: true,
      detail: true,
      status: true,
      severity: true,
      propertyId: true,
      openedAt: true,
      taskOccurrenceId: true,
      outlet: { select: { name: true } },
      correctiveActions: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          status: true,
          description: true,
          assigneeRole: true,
          assigneeUserId: true,
          dueAt: true,
          assigneeUser: { select: { email: true, name: true } },
        },
      },
    },
  });
  if (!e) return null;
  return {
    id: e.id,
    title: e.title,
    detail: e.detail,
    status: e.status,
    severity: e.severity,
    propertyId: e.propertyId,
    outletName: e.outlet.name,
    openedAt: e.openedAt.toISOString(),
    occurrenceId: e.taskOccurrenceId,
    correctiveActions: e.correctiveActions.map((c) => ({
      id: c.id,
      status: c.status,
      description: c.description,
      assigneeRole: c.assigneeRole,
      assigneeUserId: c.assigneeUserId,
      assigneeLabel: c.assigneeUser ? (c.assigneeUser.name ?? c.assigneeUser.email) : null,
      dueAt: c.dueAt ? c.dueAt.toISOString() : null,
    })),
  };
}
