// Export jobs read layer (#139) — the list behind the exports screen: each job's status, error, and
// whether its audit-pack PDF is downloadable yet. Tenant-scoped by the caller's withTenant() (D6). The
// enqueue + worker live in exports.ts; the signed download is /api/exports/[id]/download (#14/#107).
import type { TenantClient } from "./db";
import type { ExportJobStatus } from "../generated/prisma/enums";

export interface ExportJobView {
  id: string;
  status: ExportJobStatus;
  error: string | null;
  createdAt: string;
  filters: { from?: string; to?: string };
  /** True once the job is completed and its pack object is a live, finalized attachment. */
  downloadable: boolean;
}

export async function listExportJobs(tx: TenantClient, limit = 30): Promise<ExportJobView[]> {
  const rows = await tx.exportJob.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      status: true,
      error: true,
      createdAt: true,
      filtersJson: true,
      auditPack: {
        select: { attachment: { select: { status: true, deletedAt: true } } },
      },
    },
  });
  return rows.map((j) => {
    const att = j.auditPack?.attachment;
    const filters = (j.filtersJson ?? {}) as { from?: string; to?: string };
    return {
      id: j.id,
      status: j.status,
      error: j.error,
      createdAt: j.createdAt.toISOString(),
      filters: { from: filters.from, to: filters.to },
      downloadable:
        j.status === "completed" && !!att && att.status === "uploaded" && !att.deletedAt,
    };
  });
}
