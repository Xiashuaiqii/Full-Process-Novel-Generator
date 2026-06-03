import { AppShell } from "@/components/layout/AppShell";
import { DeepSeekSettingsForm } from "@/components/settings/DeepSeekSettingsForm";

export default function SettingsPage() {
  return (
    <AppShell title="DeepSeek 设置">
      <DeepSeekSettingsForm />
    </AppShell>
  );
}
