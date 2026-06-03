import { AppShell } from "@/components/layout/AppShell";
import { NovelList } from "@/components/novels/NovelList";

export default function HomePage() {
  return (
    <AppShell title="小说列表">
      <NovelList />
    </AppShell>
  );
}
