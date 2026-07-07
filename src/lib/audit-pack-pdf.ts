// Audit-pack PDF rendering (#14; §7.4 / §22) via @react-pdf/renderer (spine item).
//
// Renders a compact, deterministic summary page: org, generation time, the filter scope, the record
// count in scope, and the activity_log chain head (F6) that proves the audited scope was intact at
// export time. Uses React.createElement (no JSX) so this stays a plain .ts lib. The renderer runs
// headlessly in Node (no browser), so it works in Server Actions, an Inngest worker, and tests alike.
import React from "react";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";

export interface AuditPackData {
  organizationName: string;
  generatedAtIso: string;
  filters: Record<string, unknown>;
  recordCount: number;
  chainHeadHash: string | null;
}

const h = React.createElement;

function line(label: string, value: string): React.ReactElement {
  return h(
    View,
    { style: { flexDirection: "row", marginBottom: 4 } },
    h(Text, { style: { width: 140, fontSize: 10, color: "#555" } }, label),
    h(Text, { style: { fontSize: 10 } }, value),
  );
}

/** Render the audit pack to PDF bytes. */
export async function renderAuditPackPdf(data: AuditPackData): Promise<Uint8Array> {
  const doc = h(
    Document,
    { title: "Shift Ledger audit pack", author: "Shift Ledger" },
    h(
      Page,
      { size: "A4", style: { padding: 40 } },
      h(
        Text,
        { style: { fontSize: 18, marginBottom: 6 } },
        "Shift Ledger - Operational Proof Pack",
      ),
      h(
        Text,
        { style: { fontSize: 9, color: "#888", marginBottom: 16 } },
        "Operational-proof / documentation export. Not a legal-compliance certification.",
      ),
      line("Organization", data.organizationName),
      line("Generated (UTC)", data.generatedAtIso),
      line("Records in scope", String(data.recordCount)),
      line("Filter scope", JSON.stringify(data.filters)),
      line("Chain head (SHA-256)", data.chainHeadHash ?? "(no chained activity)"),
      h(
        Text,
        { style: { fontSize: 8, color: "#aaa", marginTop: 24 } },
        "The chain head is the tamper-evident activity_log row_hash at export time; a matching value on re-verification proves the audited history was unaltered.",
      ),
    ),
  );
  const buf = await renderToBuffer(doc);
  return new Uint8Array(buf);
}
