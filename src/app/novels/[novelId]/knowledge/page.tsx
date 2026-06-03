import { AppShell } from "@/components/layout/AppShell";
import { KnowledgeTabs } from "@/components/knowledge/KnowledgeTabs";

export default async function KnowledgePage({
  params
}: {
  params: Promise<{ novelId: string }>;
}) {
  const { novelId } = await params;
  return (
    <AppShell title="知识库管理">
      <KnowledgeTabs novelId={novelId} />
    </AppShell>
  );
}
