// Template detail / edit (#135). Author roles only; others 404. Edit the definition + activate/deactivate.
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { resolveMemberForOrg } from "@/lib/http-auth";
import { withTenant } from "@/lib/db";
import { canManageTemplates } from "@/lib/permissions";
import { getTemplate } from "@/lib/templates";
import { TemplateForm } from "../TemplateForm";
import { TemplateActiveButton } from "../TemplateActiveButton";

export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ org: string; templateId: string }>;
}) {
  const { org, templateId } = await params;
  const ctx = await resolveMemberForOrg((await headers()) as unknown as Headers, org);
  if (!ctx || !canManageTemplates(ctx.role)) notFound();

  const template = await withTenant(ctx.organizationId, (tx) => getTemplate(tx, templateId));
  if (!template) notFound();

  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      <div>
        <Link
          href={`/${org}/settings/templates`}
          className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          ← Templates
        </Link>
        <div className="mt-2 flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            {template.title}
          </h1>
          <TemplateActiveButton org={org} templateId={template.id} active={template.isActive} />
        </div>
      </div>
      <TemplateForm
        org={org}
        mode="edit"
        initial={{
          id: template.id,
          title: template.title,
          checkType: template.checkType,
          requiredEvidence: template.requiredEvidence,
          targetConfig: template.targetConfig,
          instructions: template.instructions,
        }}
      />
    </div>
  );
}
