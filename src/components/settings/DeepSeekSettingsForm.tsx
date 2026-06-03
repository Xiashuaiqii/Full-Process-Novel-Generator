"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, TestTube2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { apiFetch, reportFrontendError } from "@/services/api";

type TaskProfile = {
  taskType: "chapter_generation" | "chapter_summary" | "knowledge_extraction" | "consistency_check";
  model: "deepseek-v4-flash" | "deepseek-v4-pro";
  thinkingEnabled: boolean;
  reasoningEffort: "high" | "max";
  temperature: number;
  topP: number;
  maxTokens: number;
  stream: boolean;
  streamIncludeUsage: boolean;
  stopSequences: string[];
  logprobs: boolean;
  topLogprobs: number;
};

type SettingsPayload = {
  apiKeyMasked?: string | null;
  hasApiKey: boolean;
  baseUrl: string;
  betaBaseUrl: string;
  profiles: TaskProfile[];
};

const TASK_LABELS: Record<TaskProfile["taskType"], string> = {
  chapter_generation: "章节正文生成",
  chapter_summary: "章节摘要生成",
  knowledge_extraction: "知识库更新抽取",
  consistency_check: "一致性检查"
};

export function DeepSeekSettingsForm() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState("");
  const [form, setForm] = useState<SettingsPayload | null>(null);

  const settings = useQuery({
    queryKey: ["settings", "deepseek"],
    queryFn: () => apiFetch<SettingsPayload>("/api/settings/deepseek")
  });

  useEffect(() => {
    if (settings.data) {
      setForm(settings.data);
    }
  }, [settings.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch<SettingsPayload>("/api/settings/deepseek", {
        method: "PUT",
        body: JSON.stringify({
          ...form,
          apiKey: apiKey.trim() || undefined,
          clearApiKey: false
        })
      }),
    onSuccess: () => {
      setApiKey("");
      toast({ title: "设置已保存" });
      void queryClient.invalidateQueries({ queryKey: ["settings", "deepseek"] });
    },
    onError: (error) => {
      reportFrontendError(error, "settings_save");
      toast({ title: "保存失败", description: error.message, variant: "destructive" });
    }
  });

  const clearKeyMutation = useMutation({
    mutationFn: () =>
      apiFetch<SettingsPayload>("/api/settings/deepseek", {
        method: "PUT",
        body: JSON.stringify({
          ...form,
          apiKey: "",
          clearApiKey: true
        })
      }),
    onSuccess: () => {
      toast({ title: "API Key 已清空" });
      void queryClient.invalidateQueries({ queryKey: ["settings", "deepseek"] });
    },
    onError: (error) => toast({ title: "清空失败", description: error.message, variant: "destructive" })
  });

  const testMutation = useMutation({
    mutationFn: () => apiFetch<{ message: string; response: string }>("/api/settings/deepseek/test", { method: "POST" }),
    onSuccess: (data) => {
      toast({ title: "测试连接成功", description: data.response });
    },
    onError: (error) => {
      reportFrontendError(error, "settings_test");
      toast({ title: "测试连接失败", description: error.message, variant: "destructive" });
    }
  });

  const updateProfile = (index: number, patch: Partial<TaskProfile>) => {
    setForm((current) => {
      if (!current) return current;
      const profiles = current.profiles.map((profile, itemIndex) =>
        itemIndex === index ? { ...profile, ...patch } : profile
      );
      return { ...current, profiles };
    });
  };

  if (settings.isLoading || !form) {
    return <div className="text-sm text-muted-foreground">正在加载设置...</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">DeepSeek 设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          API Key 加密保存在本地 SQLite，不写入浏览器 localStorage，也不会进入调用日志。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>连接配置</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>当前 Key：</span>
            <Badge>{form.hasApiKey ? form.apiKeyMasked || "已配置" : "未配置"}</Badge>
          </div>
          <div className="grid gap-2">
            <Label>DeepSeek API Key</Label>
            <Input
              type="password"
              value={apiKey}
              placeholder="输入新 Key 后保存，留空则不修改"
              onChange={(event) => setApiKey(event.target.value)}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>baseURL</Label>
              <Input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>betaBaseURL</Label>
              <Input value={form.betaBaseUrl} onChange={(event) => setForm({ ...form, betaBaseUrl: event.target.value })} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              <Save className="h-4 w-4" />
              {saveMutation.isPending ? "保存中" : "保存设置"}
            </Button>
            <Button variant="secondary" disabled={testMutation.isPending} onClick={() => testMutation.mutate()}>
              <TestTube2 className="h-4 w-4" />
              {testMutation.isPending ? "测试中" : "测试连接"}
            </Button>
            <Button
              variant="destructive"
              disabled={clearKeyMutation.isPending}
              onClick={() => {
                if (confirm("确认清空本地保存的 DeepSeek API Key？")) {
                  clearKeyMutation.mutate();
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
              清空 API Key
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {form.profiles.map((profile, index) => (
          <Card key={profile.taskType}>
            <CardHeader>
              <CardTitle>{TASK_LABELS[profile.taskType]}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="模型">
                  <select
                    className="h-9 rounded-md border bg-white px-3 text-sm"
                    value={profile.model}
                    onChange={(event) => updateProfile(index, { model: event.target.value as TaskProfile["model"] })}
                  >
                    <option value="deepseek-v4-flash">deepseek-v4-flash</option>
                    <option value="deepseek-v4-pro">deepseek-v4-pro</option>
                  </select>
                </Field>
                <Field label="reasoning_effort">
                  <select
                    className="h-9 rounded-md border bg-white px-3 text-sm"
                    value={profile.reasoningEffort}
                    onChange={(event) => updateProfile(index, { reasoningEffort: event.target.value as TaskProfile["reasoningEffort"] })}
                  >
                    <option value="high">high</option>
                    <option value="max">max</option>
                  </select>
                </Field>
                <NumberField label="temperature" min={0} max={2} step={0.05} value={profile.temperature} onChange={(value) => updateProfile(index, { temperature: value })} />
                <NumberField label="top_p" min={0} max={1} step={0.05} value={profile.topP} onChange={(value) => updateProfile(index, { topP: value })} />
                <NumberField label="max_tokens" min={256} max={64000} step={1} value={profile.maxTokens} onChange={(value) => updateProfile(index, { maxTokens: value })} />
                <NumberField label="top_logprobs" min={0} max={20} step={1} value={profile.topLogprobs} onChange={(value) => updateProfile(index, { topLogprobs: value })} />
              </div>
              <p className="text-xs text-muted-foreground">通常建议只调整 temperature 或 top_p 其中一个。</p>
              <div className="grid gap-2 md:grid-cols-2">
                <Check label="启用 thinking" checked={profile.thinkingEnabled} onChange={(value) => updateProfile(index, { thinkingEnabled: value })} />
                <Check label="stream" checked={profile.stream} onChange={(value) => updateProfile(index, { stream: value })} />
                <Check label="流式包含 usage" checked={profile.streamIncludeUsage} onChange={(value) => updateProfile(index, { streamIncludeUsage: value })} />
                <Check label="logprobs 调试" checked={profile.logprobs} onChange={(value) => updateProfile(index, { logprobs: value })} />
              </div>
              <Field label="stop sequences（一行一个）">
                <Textarea
                  rows={3}
                  value={profile.stopSequences.join("\n")}
                  onChange={(event) =>
                    updateProfile(index, {
                      stopSequences: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean)
                    })
                  }
                />
              </Field>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  );
}

function Check({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}
