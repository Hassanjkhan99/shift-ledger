// Occurrence detail read (#137) — the single-occurrence view behind the task detail screen: the frozen
// template/threshold/required-evidence, current status + due, and the completion version history (§8.14).
// Tenant-scoped by the caller's withTenant() (D6). The completion WRITE path is the tested #17 actions;
// this is the read that frames them.
import type { TenantClient } from "./db";
import type {
  CheckType,
  EvidenceType,
  OccurrenceStatus,
  CompletionResult,
} from "../generated/prisma/enums";

export interface CompletionHistoryEntry {
  id: string;
  version: number;
  isCurrent: boolean;
  result: CompletionResult;
  measuredNumeric: string | null;
  recordedAt: string;
  actorConfirmationMethod: string;
  completedBy: string; // email or name
  editReason: string | null;
}

export interface OccurrenceDetail {
  id: string;
  status: OccurrenceStatus;
  checkType: CheckType;
  dueAt: string;
  outletId: string;
  outletName: string;
  assigneeRole: string | null;
  templateTitle: string;
  instructions: string | null;
  requiredEvidence: EvidenceType[];
  targetConfig: { minC?: number; maxC?: number } | null;
  completions: CompletionHistoryEntry[];
}

const TERMINAL: ReadonlySet<OccurrenceStatus> = new Set<OccurrenceStatus>([
  "completed",
  "completed_late",
  "failed",
  "skipped",
  "cancelled",
]);

/** True if the occurrence can still be acted on (complete/fail/skip) — i.e. not in a terminal state. */
export function isActionable(status: OccurrenceStatus): boolean {
  return !TERMINAL.has(status);
}

function parseTargetConfig(snapshot: unknown): OccurrenceDetail["targetConfig"] {
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    const tc = (snapshot as { targetConfig?: unknown }).targetConfig;
    if (tc && typeof tc === "object" && !Array.isArray(tc)) {
      const o = tc as { minC?: unknown; maxC?: unknown };
      const minC = typeof o.minC === "number" ? o.minC : undefined;
      const maxC = typeof o.maxC === "number" ? o.maxC : undefined;
      if (minC !== undefined || maxC !== undefined) return { minC, maxC };
    }
  }
  return null;
}

function parseRequiredEvidence(snapshot: unknown): EvidenceType[] {
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    const re = (snapshot as { requiredEvidence?: unknown }).requiredEvidence;
    if (Array.isArray(re)) return re as EvidenceType[];
  }
  return [];
}

export async function readOccurrenceDetail(
  tx: TenantClient,
  occurrenceId: string,
): Promise<OccurrenceDetail | null> {
  const occ = await tx.taskOccurrence.findFirst({
    where: { id: occurrenceId },
    select: {
      id: true,
      status: true,
      checkType: true,
      dueAt: true,
      outletId: true,
      assigneeRole: true,
      configSnapshot: true,
      outlet: { select: { name: true } },
      taskTemplate: { select: { title: true, instructions: true } },
      completions: {
        orderBy: { version: "desc" },
        select: {
          id: true,
          version: true,
          isCurrent: true,
          result: true,
          measuredNumeric: true,
          recordedAt: true,
          actorConfirmationMethod: true,
          editReason: true,
          completedByUser: { select: { email: true, name: true } },
        },
      },
    },
  });
  if (!occ) return null;

  return {
    id: occ.id,
    status: occ.status,
    checkType: occ.checkType,
    dueAt: occ.dueAt.toISOString(),
    outletId: occ.outletId,
    outletName: occ.outlet.name,
    assigneeRole: occ.assigneeRole,
    templateTitle: occ.taskTemplate.title,
    instructions: occ.taskTemplate.instructions,
    requiredEvidence: parseRequiredEvidence(occ.configSnapshot),
    targetConfig: parseTargetConfig(occ.configSnapshot),
    completions: occ.completions.map((c) => ({
      id: c.id,
      version: c.version,
      isCurrent: c.isCurrent,
      result: c.result,
      measuredNumeric: c.measuredNumeric?.toString() ?? null,
      recordedAt: c.recordedAt.toISOString(),
      actorConfirmationMethod: c.actorConfirmationMethod,
      completedBy: c.completedByUser.name ?? c.completedByUser.email,
      editReason: c.editReason,
    })),
  };
}
