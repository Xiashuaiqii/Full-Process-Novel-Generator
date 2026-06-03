import { AppShell } from "@/components/layout/AppShell";
import { LogsCenter } from "@/components/logs/LogsCenter";

export default function LogsPage() {
  return (
    <AppShell title="日志中心">
      <LogsCenter />
    </AppShell>
  );
}
