import { WorkspaceClient } from "@/components/workspace/WorkspaceClient";

export default async function NovelWorkspacePage({
  params
}: {
  params: Promise<{ novelId: string }>;
}) {
  const { novelId } = await params;
  return <WorkspaceClient novelId={novelId} />;
}
