"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TabList } from "@/components/ui/tabs";
import { JsonView } from "@/components/ui/json-view";
import { apiFetch } from "@/services/api";

type AppLog = {
  id: string;
  level: string;
  scope: string;
  message: string;
  details?: unknown;
  stack?: string | null;
  requestPath?: string | null;
  method?: string | null;
  novelId?: string | null;
  chapterId?: string | null;
  generationTaskId?: string | null;
  createdAt: string;
};

type AiPromptLog = {
  id: string;
  generationTaskId?: string | null;
  novelId?: string | null;
  chapterId?: string | null;
  taskType: string;
  model: string;
  baseUrlMode: string;
  messages: unknown;
  contextSnapshot?: unknown;
  tools?: unknown;
  toolChoice?: unknown;
  requestParams?: unknown;
  responsePreview?: string | null;
  finishReason?: string | null;
  usage?: unknown;
  errorMessage?: string | null;
  createdAt: string;
};

export function LogsCenter() {
  const [tab, setTab] = useState("app");
  const [level, setLevel] = useState("");
  const [taskType, setTaskType] = useState("");

  const appLogs = useQuery({
    queryKey: ["logs", level],
    queryFn: () => apiFetch<AppLog[]>(`/api/logs${level ? `?level=${level}` : ""}`)
  });

  const aiLogs = useQuery({
    queryKey: ["logs", "ai", taskType],
    queryFn: () => apiFetch<AiPromptLog[]>(`/api/logs/ai${taskType ? `?taskType=${taskType}` : ""}`)
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">日志中心</h1>
          <p className="mt-1 text-sm text-muted-foreground">查看每一次报错、每一轮发给 DeepSeek 的 Prompt 和请求参数。</p>
        </div>
        <Button variant="secondary" onClick={() => { void appLogs.refetch(); void aiLogs.refetch(); }}>
          <RefreshCw className="h-4 w-4" />
          刷新
        </Button>
      </div>

      <TabList
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "app", label: "错误与系统日志" },
          { value: "ai", label: "大模型调用记录" }
        ]}
      />

      {tab === "app" ? (
        <div className="space-y-3">
          <div className="grid max-w-sm gap-2">
            <Label>日志级别筛选</Label>
            <select className="h-9 rounded-md border bg-white px-3 text-sm" value={level} onChange={(event) => setLevel(event.target.value)}>
              <option value="">全部</option>
              <option value="error">error</option>
              <option value="warn">warn</option>
              <option value="info">info</option>
              <option value="debug">debug</option>
            </select>
          </div>
          {appLogs.data?.map((log) => <AppLogCard key={log.id} log={log} />)}
          {appLogs.data?.length === 0 ? <Empty text="暂无系统日志。" /> : null}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid max-w-sm gap-2">
            <Label>任务类型筛选</Label>
            <select className="h-9 rounded-md border bg-white px-3 text-sm" value={taskType} onChange={(event) => setTaskType(event.target.value)}>
              <option value="">全部</option>
              <option value="chapter_generation">章节正文生成</option>
              <option value="chapter_summary">章节摘要生成</option>
              <option value="knowledge_extraction">知识库更新抽取</option>
              <option value="consistency_check">一致性检查</option>
            </select>
          </div>
          {aiLogs.data?.map((log) => <AiLogCard key={log.id} log={log} />)}
          {aiLogs.data?.length === 0 ? <Empty text="暂无大模型调用记录。" /> : null}
        </div>
      )}
    </div>
  );
}

function AppLogCard({ log }: { log: AppLog }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className={log.level === "error" ? "text-red-700" : ""}>{log.message}</CardTitle>
            <div className="mt-1 text-xs text-muted-foreground">
              {log.level} / {log.scope} / {new Date(log.createdAt).toLocaleString()}
              {log.requestPath ? ` / ${log.method} ${log.requestPath}` : ""}
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setOpen((value) => !value)}>
            {open ? "收起" : "展开"}
          </Button>
        </div>
      </CardHeader>
      {open ? (
        <CardContent className="space-y-3">
          <JsonView value={{ details: log.details, stack: log.stack, novelId: log.novelId, chapterId: log.chapterId, generationTaskId: log.generationTaskId }} />
        </CardContent>
      ) : null}
    </Card>
  );
}

function AiLogCard({ log }: { log: AiPromptLog }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{taskLabel(log.taskType)} / {log.model}</CardTitle>
            <div className="mt-1 text-xs text-muted-foreground">
              {log.baseUrlMode} / {new Date(log.createdAt).toLocaleString()}
              {log.finishReason ? ` / finish_reason=${log.finishReason}` : ""}
              {log.errorMessage ? ` / 错误=${log.errorMessage}` : ""}
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setOpen((value) => !value)}>
            {open ? "收起" : "查看 Prompt"}
          </Button>
        </div>
      </CardHeader>
      {open ? (
        <CardContent className="space-y-3">
          <Field title="messages">
            <JsonView value={log.messages} />
          </Field>
          <Field title="上下文快照">
            <JsonView value={log.contextSnapshot} />
          </Field>
          <Field title="请求参数">
            <JsonView value={log.requestParams} />
          </Field>
          <Field title="tools / tool_choice">
            <JsonView value={{ tools: log.tools, toolChoice: log.toolChoice }} />
          </Field>
          <Field title="返回预览与 usage">
            <JsonView value={{ responsePreview: log.responsePreview, usage: log.usage, errorMessage: log.errorMessage }} />
          </Field>
        </CardContent>
      ) : null}
    </Card>
  );
}

function Field({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{title}</div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-md border bg-white p-8 text-center text-sm text-muted-foreground">{text}</div>;
}

function taskLabel(taskType: string) {
  const map: Record<string, string> = {
    chapter_generation: "章节正文生成",
    chapter_summary: "章节摘要生成",
    knowledge_extraction: "知识库更新抽取",
    consistency_check: "一致性检查"
  };
  return map[taskType] ?? taskType;
}
