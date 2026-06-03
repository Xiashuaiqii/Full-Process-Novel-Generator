import Link from "next/link";
import { BookOpen, Home, ListChecks, Settings, ScrollText } from "lucide-react";

export function AppShell({
  children,
  title,
  actions
}: {
  children: React.ReactNode;
  title?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <BookOpen className="h-5 w-5 text-primary" />
              NovelForge Local
            </Link>
            {title ? <span className="hidden text-sm text-muted-foreground md:inline">{title}</span> : null}
          </div>
          <nav className="flex items-center gap-1">
            <Link className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm hover:bg-muted" href="/">
              <Home className="h-4 w-4" />
              首页
            </Link>
            <Link className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm hover:bg-muted" href="/logs">
              <ScrollText className="h-4 w-4" />
              日志中心
            </Link>
            <Link className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm hover:bg-muted" href="/settings">
              <Settings className="h-4 w-4" />
              设置
            </Link>
            {actions}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-4 py-4">{children}</main>
      <footer className="mx-auto flex max-w-[1600px] items-center gap-2 px-4 pb-6 text-xs text-muted-foreground">
        <ListChecks className="h-3.5 w-3.5" />
        本地单机应用，数据保存在 SQLite。
      </footer>
    </div>
  );
}
