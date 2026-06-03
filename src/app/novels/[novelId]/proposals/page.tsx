import { AppShell } from "@/components/layout/AppShell";
import { ProposalsPage } from "@/components/proposals/ProposalsPage";

export default async function NovelProposalsPage({
  params
}: {
  params: Promise<{ novelId: string }>;
}) {
  const { novelId } = await params;
  return (
    <AppShell title="更新建议审核">
      <ProposalsPage novelId={novelId} />
    </AppShell>
  );
}
