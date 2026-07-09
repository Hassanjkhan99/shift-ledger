// New-template screen (#135). Author roles only; others 404.
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { resolveMemberForOrg } from "@/lib/http-auth";
import { canManageTemplates } from "@/lib/permissions";
import { TemplateForm } from "../TemplateForm";

export default async function NewTemplatePage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await resolveMemberForOrg((await headers()) as unknown as Headers, org);
  if (!ctx || !canManageTemplates(ctx.role)) notFound();

  return (
    <div className="mx-auto w-full max-w-md">
      <Link
        href={`/${org}/settings/templates`}
        className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        ← Templates
      </Link>
      <h1 className="mb-4 mt-2 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        New template
      </h1>
      <TemplateForm org={org} mode="create" />
    </div>
  );
}
