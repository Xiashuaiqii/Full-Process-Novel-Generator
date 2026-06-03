"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  FilePlus2,
  FolderPlus,
  History,
  ListChecks,
  Loader2,
  Save,
  ScrollText,
  Settings,
  WandSparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { TabList } from "@/components/ui/tabs";
import { JsonView } from "@/components/ui/json-view";
import { useToast } from "@/components/ui/toast";
import { apiFetch, reportFrontendError } from "@/services/api";
import { countChineseWords } from "@/lib/word-count";
import { useWorkspaceStore } from "@/store/workspace-store";

type Novel = {
  id: string;
  title: string;
  genre?: string | null;
  theme?: string | null;
  description?: string | null;
  writingStyle?: string | null;
  targetReader?: string | null;
};

type Volume = {
  id: string;
  novelId: string;
  title: string;
  summary?: string | null;
  sortOrder: number;
};

type Chapter = {
  id: string;
  novelId: string;
  volumeId?: string | null;
  title: string;
  chapterNo: number;
  outline?: string | null;
  content?: string | null;
  status: string;
  wordCount: number;
  summaryShort?: string | null;
  summaryLong?: string | null;
};

type Entity = Record<string, unknown> & { id: string; name?: string; title?: string };
type Proposal = Record<string, unknown> & {
  id: string;
  proposalType: string;
  action: string;
  title?: string | null;
  reason?: string | null;
  confidence?: number | null;
  afterData?: unknown;
};

type SelectedContext = {
  includeFixedKnowledge: boolean;
  recentChapterCount: number;
  characterIds: string[];
  locationIds: string[];
  factionIds: string[];
  foreshadowingIds: string[];
  itemIds: string[];
};

const defaultContext: SelectedContext = {
  includeFixedKnowledge: true,
  recentChapterCount: 3,
  characterIds: [],
  locationIds: [],
  factionIds: [],
  foreshadowingIds: [],
  itemIds: []
};

export function WorkspaceClient({ novelId }: { novelId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { currentChapterId, setCurrentChapterId } = useWorkspaceStore();
  const [rightTab, setRightTab] = useState("generate");
  const [chapterTitle, setChapterTitle] = useState("");
  const [outline, setOutline] = useState("");
  const [content, setContent] = useState("");
  const [generationText, setGenerationText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [promptPreview, setPromptPreview] = useState<unknown>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);

  const novel = useQuery({
    queryKey: ["novel", novelId],
    queryFn: () => apiFetch<Novel>(`/api/novels/${novelId}`)
  });
  const volumes = useQuery({
    queryKey: ["volumes", novelId],
    queryFn: () => apiFetch<Volume[]>(`/api/novels/${novelId}/volumes`)
  });
  const chapters = useQuery({
    queryKey: ["chapters", novelId],
    queryFn: () => apiFetch<Chapter[]>(`/api/novels/${novelId}/chapters`)
  });
  const characters = useEntity("characters", novelId);
  const locations = useEntity("locations", novelId);
  const factions = useEntity("factions", novelId);
  const foreshadowings = useEntity("foreshadowings", novelId);
  const items = useEntity("items", novelId);

  const currentChapter = useMemo(
    () => chapters.data?.find((chapter) => chapter.id === currentChapterId) ?? chapters.data?.[0] ?? null,
    [chapters.data, currentChapterId]
  );

  useEffect(() => {
    if (!currentChapterId && chapters.data?.[0]) {
      setCurrentChapterId(chapters.data[0].id);
    }
  }, [chapters.data, currentChapterId, setCurrentChapterId]);

  useEffect(() => {
    if (currentChapter) {
      setChapterTitle(currentChapter.title);
      setOutline(currentChapter.outline ?? "");
      setContent(currentChapter.content ?? "");
      setGenerationText("");
    }
  }, [currentChapter?.id, currentChapter]);

  const saveChapter = useMutation({
    mutationFn: () =>
      apiFetch<Chapter>(`/api/chapters/${currentChapter?.id}`, {
        method: "PUT",
        body: JSON.stringify({ title: chapterTitle, outline, content })
      }),
    onSuccess: () => {
      toast({ title: "章节已保存" });
      void queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
    },
    onError: (error) => {
      reportFrontendError(error, "chapter_save");
      toast({ title: "保存失败", description: error.message, variant: "destructive" });
    }
  });

  const createVolume = async () => {
    const title = window.prompt("请输入新卷名称");
    if (!title?.trim()) return;
    const sortOrder = (volumes.data?.length ?? 0) + 1;
    try {
      await apiFetch(`/api/novels/${novelId}/volumes`, {
        method: "POST",
        body: JSON.stringify({ title, sortOrder })
      });
      toast({ title: "卷已创建" });
      await queryClient.invalidateQueries({ queryKey: ["volumes", novelId] });
    } catch (error) {
      reportFrontendError(error, "volume_create");
      toast({ title: "创建卷失败", description: String(error instanceof Error ? error.message : error), variant: "destructive" });
    }
  };

  const createChapter = async () => {
    const title = window.prompt("请输入新章节标题");
    if (!title?.trim()) return;
    const chapterNo = Math.max(0, ...(chapters.data?.map((chapter) => chapter.chapterNo) ?? [])) + 1;
    try {
      const created = await apiFetch<Chapter>(`/api/novels/${novelId}/chapters`, {
        method: "POST",
        body: JSON.stringify({ title, chapterNo, volumeId: volumes.data?.[0]?.id ?? null })
      });
      setCurrentChapterId(created.id);
      toast({ title: "章节已创建" });
      await queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
    } catch (error) {
      reportFrontendError(error, "chapter_create");
      toast({ title: "创建章节失败", description: String(error instanceof Error ? error.message : error), variant: "destructive" });
    }
  };

  if (novel.isLoading || chapters.isLoading || volumes.isLoading) {
    return <div className="p-4 text-sm text-muted-foreground">正在加载工作台...</div>;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="flex w-[280px] shrink-0 flex-col border-r bg-white">
        <div className="border-b p-4">
          <div className="font-semibold">{novel.data?.title ?? "小说工作台"}</div>
          <div className="mt-1 text-xs text-muted-foreground">{novel.data?.genre || "未分类"}</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <LinkButton href="/" icon={<ArrowLeft className="h-4 w-4" />} label="首页" />
            <LinkButton href="/settings" icon={<Settings className="h-4 w-4" />} label="设置" />
            <LinkButton href={`/novels/${novelId}/knowledge`} icon={<BookOpen className="h-4 w-4" />} label="知识库" />
            <LinkButton href={`/novels/${novelId}/proposals`} icon={<ListChecks className="h-4 w-4" />} label="建议" />
            <LinkButton href="/logs" icon={<ScrollText className="h-4 w-4" />} label="日志" />
          </div>
        </div>
        <div className="flex gap-2 border-b p-3">
          <Button variant="secondary" size="sm" onClick={createVolume}>
            <FolderPlus className="h-4 w-4" />
            新建卷
          </Button>
          <Button variant="secondary" size="sm" onClick={createChapter}>
            <FilePlus2 className="h-4 w-4" />
            新建章节
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <ChapterTree
            volumes={volumes.data ?? []}
            chapters={chapters.data ?? []}
            currentChapterId={currentChapter?.id ?? null}
            onSelect={setCurrentChapterId}
          />
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto p-4">
        {currentChapter ? (
          <div className="mx-auto max-w-5xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Badge>第 {currentChapter.chapterNo} 章</Badge>
                <Badge>{currentChapter.status}</Badge>
                <span className="text-sm text-muted-foreground">字数：{countChineseWords(content)}</span>
                {isGenerating ? <Badge className="bg-amber-50 text-amber-700">正在生成中</Badge> : null}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setVersionsOpen(true)}>
                  <History className="h-4 w-4" />
                  历史版本
                </Button>
                <Button disabled={saveChapter.isPending} onClick={() => saveChapter.mutate()}>
                  <Save className="h-4 w-4" />
                  {saveChapter.isPending ? "保存中" : "保存"}
                </Button>
              </div>
            </div>
            <Input value={chapterTitle} onChange={(event) => setChapterTitle(event.target.value)} className="h-11 text-lg font-semibold" />
            <Textarea rows={5} value={outline} onChange={(event) => setOutline(event.target.value)} placeholder="章节大纲" />
            <Textarea
              value={isGenerating ? generationText : content}
              onChange={(event) => {
                setContent(event.target.value);
                if (isGenerating) setGenerationText(event.target.value);
              }}
              className="min-h-[70vh] resize-y leading-7"
              placeholder="在这里写作或生成章节正文..."
            />
          </div>
        ) : (
          <div className="rounded-md border bg-white p-8 text-center text-sm text-muted-foreground">还没有章节，请先新建章节。</div>
        )}
      </main>

      <aside className="flex w-[380px] shrink-0 flex-col border-l bg-white">
        <div className="border-b p-3">
          <TabList
            value={rightTab}
            onChange={setRightTab}
            tabs={[
              { value: "generate", label: "AI 生成" },
              { value: "context", label: "上下文选择" },
              { value: "tools", label: "章节工具" },
              { value: "proposals", label: "更新建议" }
            ]}
          />
        </div>
        <RightPanel
          tab={rightTab}
          novelId={novelId}
          chapter={currentChapter}
          characters={characters.data ?? []}
          locations={locations.data ?? []}
          factions={factions.data ?? []}
          foreshadowings={foreshadowings.data ?? []}
          items={items.data ?? []}
          onGenerated={(text) => {
            setGenerationText(text);
            setContent(text);
          }}
          generationText={generationText}
          setGenerationText={setGenerationText}
          setIsGenerating={setIsGenerating}
          isGenerating={isGenerating}
          onPromptPreview={setPromptPreview}
          onOpenVersions={() => setVersionsOpen(true)}
          onOpenLogs={() => setLogsOpen(true)}
        />
      </aside>

      <PromptPreviewDialog
        open={Boolean(promptPreview)}
        onClose={() => setPromptPreview(null)}
        data={promptPreview}
      />
      <VersionsDialog open={versionsOpen} onClose={() => setVersionsOpen(false)} chapterId={currentChapter?.id ?? null} />
      <PromptLogsDialog open={logsOpen} onClose={() => setLogsOpen(false)} chapterId={currentChapter?.id ?? null} />
    </div>
  );
}

function useEntity(type: string, novelId: string) {
  return useQuery({
    queryKey: [type, novelId],
    queryFn: () => apiFetch<Entity[]>(`/api/novels/${novelId}/${type}`)
  });
}

function LinkButton({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link className="inline-flex h-8 items-center justify-center gap-1 rounded-md border bg-white px-2 text-xs hover:bg-muted" href={href}>
      {icon}
      {label}
    </Link>
  );
}

function ChapterTree({
  volumes,
  chapters,
  currentChapterId,
  onSelect
}: {
  volumes: Volume[];
  chapters: Chapter[];
  currentChapterId: string | null;
  onSelect: (id: string) => void;
}) {
  const ungrouped = chapters.filter((chapter) => !chapter.volumeId);
  return (
    <div className="space-y-3">
      {volumes.map((volume) => (
        <div key={volume.id}>
          <div className="mb-1 text-xs font-semibold text-muted-foreground">{volume.sortOrder}. {volume.title}</div>
          <div className="space-y-1">
            {chapters.filter((chapter) => chapter.volumeId === volume.id).map((chapter) => (
              <ChapterButton key={chapter.id} chapter={chapter} active={chapter.id === currentChapterId} onClick={() => onSelect(chapter.id)} />
            ))}
          </div>
        </div>
      ))}
      {ungrouped.length ? (
        <div>
          <div className="mb-1 text-xs font-semibold text-muted-foreground">未分卷</div>
          <div className="space-y-1">
            {ungrouped.map((chapter) => (
              <ChapterButton key={chapter.id} chapter={chapter} active={chapter.id === currentChapterId} onClick={() => onSelect(chapter.id)} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ChapterButton({ chapter, active, onClick }: { chapter: Chapter; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-md px-2 py-2 text-left text-sm transition ${active ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
    >
      <div className="truncate">第 {chapter.chapterNo} 章 {chapter.title}</div>
      <div className={`mt-1 text-xs ${active ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{chapter.wordCount} 字</div>
    </button>
  );
}

function RightPanel({
  tab,
  novelId,
  chapter,
  characters,
  locations,
  factions,
  foreshadowings,
  items,
  onGenerated,
  generationText,
  setGenerationText,
  isGenerating,
  setIsGenerating,
  onPromptPreview,
  onOpenVersions,
  onOpenLogs
}: {
  tab: string;
  novelId: string;
  chapter: Chapter | null;
  characters: Entity[];
  locations: Entity[];
  factions: Entity[];
  foreshadowings: Entity[];
  items: Entity[];
  onGenerated: (text: string) => void;
  generationText: string;
  setGenerationText: (text: string) => void;
  isGenerating: boolean;
  setIsGenerating: (value: boolean) => void;
  onPromptPreview: (value: unknown) => void;
  onOpenVersions: () => void;
  onOpenLogs: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [context, setContext] = useState<SelectedContext>(defaultContext);
  const [goal, setGoal] = useState("");
  const [targetWordCount, setTargetWordCount] = useState(3000);
  const [tone, setTone] = useState("");
  const [constraints, setConstraints] = useState("");
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState("");
  const [topP, setTopP] = useState("");
  const [maxTokens, setMaxTokens] = useState("");
  const [stream, setStream] = useState(true);

  const proposals = useQuery({
    queryKey: ["chapter-proposals", chapter?.id],
    queryFn: () => apiFetch<Proposal[]>(`/api/chapters/${chapter?.id}/proposals`),
    enabled: Boolean(chapter?.id)
  });

  const toolMutation = useMutation({
    mutationFn: (action: "summarize" | "extract-knowledge" | "check-consistency") =>
      apiFetch(`/api/chapters/${chapter?.id}/${action}`, { method: "POST" }),
    onSuccess: (_data, action) => {
      toast({ title: actionLabel(action) + "完成" });
      void queryClient.invalidateQueries();
    },
    onError: (error) => {
      reportFrontendError(error, "chapter_tool");
      toast({ title: "操作失败", description: error.message, variant: "destructive" });
    }
  });

  const generate = async () => {
    if (!chapter) return;
    setIsGenerating(true);
    setGenerationText("");
    try {
      const response = await fetch(`/api/chapters/${chapter.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapterGoal: goal,
          targetWordCount,
          tone,
          selectedContext: context,
          constraints: constraints.split("\n").map((item) => item.trim()).filter(Boolean),
          overrides: {
            ...(model ? { model } : {}),
            ...(temperature ? { temperature: Number(temperature) } : {}),
            ...(topP ? { topP: Number(topP) } : {}),
            ...(maxTokens ? { maxTokens: Number(maxTokens) } : {}),
            stream
          }
        })
      });

      if (!response.ok) {
        const json = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(json?.error || "章节生成请求失败");
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/event-stream")) {
        const json = await response.json() as { ok: boolean; data?: { content?: string }; error?: string };
        if (!json.ok) throw new Error(json.error || "章节生成失败");
        const text = json.data?.content ?? "";
        onGenerated(text);
        toast({ title: "章节生成完成" });
        await queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("浏览器无法读取流式响应");
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const eventLine = part.split("\n").find((line) => line.startsWith("event:"));
          const dataLine = part.split("\n").find((line) => line.startsWith("data:"));
          if (!eventLine || !dataLine) continue;
          const event = eventLine.replace("event:", "").trim();
          const data = JSON.parse(dataLine.replace("data:", "").trim()) as { token?: string; error?: string };
          if (event === "token" && data.token) {
            fullText += data.token;
            setGenerationText(fullText);
          }
          if (event === "error") {
            throw new Error(data.error || "生成失败");
          }
          if (event === "done") {
            onGenerated(fullText);
            toast({ title: "章节生成完成" });
            await queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
          }
        }
      }
    } catch (error) {
      reportFrontendError(error, "chapter_generation");
      toast({ title: "生成失败", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const preview = async () => {
    if (!chapter) return;
    try {
      const data = await apiFetch(`/api/chapters/${chapter.id}/prompt-preview`, {
        method: "POST",
        body: JSON.stringify({
          chapterGoal: goal,
          targetWordCount,
          tone,
          selectedContext: context,
          constraints: constraints.split("\n").map((item) => item.trim()).filter(Boolean)
        })
      });
      onPromptPreview(data);
    } catch (error) {
      reportFrontendError(error, "prompt_preview");
      toast({ title: "Prompt 预览失败", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  if (!chapter) {
    return <div className="p-4 text-sm text-muted-foreground">请选择章节。</div>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      {tab === "generate" ? (
        <div className="space-y-4">
          <Field label="本章目标">
            <Textarea rows={4} value={goal} onChange={(event) => setGoal(event.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="目标字数">
              <Input type="number" value={targetWordCount} onChange={(event) => setTargetWordCount(Number(event.target.value))} />
            </Field>
            <Field label="氛围语气">
              <Input value={tone} onChange={(event) => setTone(event.target.value)} />
            </Field>
          </div>
          <Field label="强制约束（一行一条）">
            <Textarea rows={4} value={constraints} onChange={(event) => setConstraints(event.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="覆盖模型">
              <select className="h-9 rounded-md border bg-white px-3 text-sm" value={model} onChange={(event) => setModel(event.target.value)}>
                <option value="">使用默认</option>
                <option value="deepseek-v4-flash">deepseek-v4-flash</option>
                <option value="deepseek-v4-pro">deepseek-v4-pro</option>
              </select>
            </Field>
            <Field label="流式输出">
              <label className="flex h-9 items-center gap-2 rounded-md border bg-white px-3 text-sm">
                <input type="checkbox" checked={stream} onChange={(event) => setStream(event.target.checked)} />
                启用
              </label>
            </Field>
            <Field label="temperature">
              <Input type="number" step="0.05" value={temperature} onChange={(event) => setTemperature(event.target.value)} placeholder="默认" />
            </Field>
            <Field label="top_p">
              <Input type="number" step="0.05" value={topP} onChange={(event) => setTopP(event.target.value)} placeholder="默认" />
            </Field>
            <Field label="max_tokens">
              <Input type="number" value={maxTokens} onChange={(event) => setMaxTokens(event.target.value)} placeholder="默认" />
            </Field>
          </div>
          <Button className="w-full" disabled={isGenerating} onClick={generate}>
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
            {isGenerating ? "正在生成中" : "生成章节"}
          </Button>
        </div>
      ) : null}

      {tab === "context" ? (
        <ContextSelector
          value={context}
          onChange={setContext}
          characters={characters}
          locations={locations}
          factions={factions}
          foreshadowings={foreshadowings}
          items={items}
          onPreview={preview}
        />
      ) : null}

      {tab === "tools" ? (
        <div className="space-y-3">
          <Button className="w-full" variant="secondary" disabled={toolMutation.isPending} onClick={() => toolMutation.mutate("summarize")}>生成章节摘要</Button>
          <Button className="w-full" variant="secondary" disabled={toolMutation.isPending} onClick={() => toolMutation.mutate("extract-knowledge")}>抽取知识库更新建议</Button>
          <Button className="w-full" variant="secondary" disabled={toolMutation.isPending} onClick={() => toolMutation.mutate("check-consistency")}>一致性检查</Button>
          <Button className="w-full" variant="outline" onClick={onOpenLogs}>查看本章 Prompt 记录</Button>
          <Button className="w-full" variant="outline" onClick={onOpenVersions}>查看章节版本</Button>
          <Link className="inline-flex h-9 w-full items-center justify-center rounded-md border bg-white text-sm hover:bg-muted" href="/logs">查看全局日志中心</Link>
        </div>
      ) : null}

      {tab === "proposals" ? (
        <ProposalList proposals={proposals.data ?? []} chapterId={chapter.id} />
      ) : null}
    </div>
  );
}

function ContextSelector({
  value,
  onChange,
  characters,
  locations,
  factions,
  foreshadowings,
  items,
  onPreview
}: {
  value: SelectedContext;
  onChange: (value: SelectedContext) => void;
  characters: Entity[];
  locations: Entity[];
  factions: Entity[];
  foreshadowings: Entity[];
  items: Entity[];
  onPreview: () => void;
}) {
  return (
    <div className="space-y-4">
      <Check label="包含固定世界观" checked={value.includeFixedKnowledge} onChange={(checked) => onChange({ ...value, includeFixedKnowledge: checked })} />
      <Field label="最近章节摘要数量">
        <select className="h-9 rounded-md border bg-white px-3 text-sm" value={value.recentChapterCount} onChange={(event) => onChange({ ...value, recentChapterCount: Number(event.target.value) })}>
          {[0, 1, 3, 5, 10].map((count) => <option key={count} value={count}>{count}</option>)}
        </select>
      </Field>
      <Multi title="出场角色" items={characters} ids={value.characterIds} onChange={(ids) => onChange({ ...value, characterIds: ids })} />
      <Multi title="场景地点" items={locations} ids={value.locationIds} onChange={(ids) => onChange({ ...value, locationIds: ids })} />
      <Multi title="相关势力" items={factions} ids={value.factionIds} onChange={(ids) => onChange({ ...value, factionIds: ids })} />
      <Multi title="相关伏笔" items={foreshadowings} ids={value.foreshadowingIds} onChange={(ids) => onChange({ ...value, foreshadowingIds: ids })} />
      <Multi title="相关道具" items={items} ids={value.itemIds} onChange={(ids) => onChange({ ...value, itemIds: ids })} />
      <Button className="w-full" variant="secondary" onClick={onPreview}>显示将进入 Prompt 的上下文预览</Button>
    </div>
  );
}

function Multi({ title, items, ids, onChange }: { title: string; items: Entity[]; ids: string[]; onChange: (ids: string[]) => void }) {
  return (
    <div className="space-y-2">
      <Label>{title}</Label>
      <div className="max-h-40 space-y-1 overflow-auto rounded-md border bg-white p-2">
        {items.length === 0 ? <div className="text-xs text-muted-foreground">暂无数据</div> : null}
        {items.map((item) => (
          <label key={item.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={ids.includes(item.id)}
              onChange={(event) => {
                onChange(event.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id));
              }}
            />
            {String(item.name || item.title || item.id)}
          </label>
        ))}
      </div>
    </div>
  );
}

function ProposalList({ proposals, chapterId }: { proposals: Proposal[]; chapterId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const action = useMutation({
    mutationFn: ({ id, type, afterData }: { id: string; type: "accept" | "reject" | "edit-and-accept"; afterData?: unknown }) =>
      apiFetch(`/api/proposals/${id}/${type}`, {
        method: "POST",
        body: type === "edit-and-accept" ? JSON.stringify({ afterData }) : "{}"
      }),
    onSuccess: () => {
      toast({ title: "建议已处理" });
      void queryClient.invalidateQueries({ queryKey: ["chapter-proposals", chapterId] });
    },
    onError: (error) => toast({ title: "处理失败", description: error.message, variant: "destructive" })
  });

  if (!proposals.length) {
    return <div className="text-sm text-muted-foreground">当前章节没有待审核建议。</div>;
  }

  return (
    <div className="space-y-3">
      {proposals.map((proposal) => (
        <div key={proposal.id} className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap gap-2">
            <Badge>{proposal.proposalType}</Badge>
            <Badge>{proposal.action}</Badge>
          </div>
          <div className="font-medium">{proposal.title || "未命名建议"}</div>
          <div className="text-xs text-muted-foreground">{proposal.reason || "无理由"}</div>
          <JsonView value={proposal.afterData} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => action.mutate({ id: proposal.id, type: "accept" })}>接受</Button>
            <Button size="sm" variant="destructive" onClick={() => action.mutate({ id: proposal.id, type: "reject" })}>拒绝</Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const text = window.prompt("编辑 afterData JSON", JSON.stringify(proposal.afterData, null, 2));
                if (!text) return;
                try {
                  action.mutate({ id: proposal.id, type: "edit-and-accept", afterData: JSON.parse(text) as unknown });
                } catch {
                  toast({ title: "JSON 无法解析", variant: "destructive" });
                }
              }}
            >
              编辑后接受
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function VersionsDialog({ open, onClose, chapterId }: { open: boolean; onClose: () => void; chapterId: string | null }) {
  const versions = useQuery({
    queryKey: ["versions", chapterId],
    queryFn: () => apiFetch<Array<Record<string, unknown>>>(`/api/chapters/${chapterId}/versions`),
    enabled: open && Boolean(chapterId)
  });
  return (
    <Dialog open={open} title="章节历史版本" onClose={onClose} className="max-w-5xl">
      <div className="space-y-3">
        {versions.data?.map((version) => (
          <div key={String(version.id)} className="space-y-2 rounded-md border p-3">
            <div className="text-sm font-medium">{String(version.source)} / {new Date(String(version.createdAt)).toLocaleString()}</div>
            <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-sm">{String(version.content ?? "")}</pre>
          </div>
        ))}
        {versions.data?.length === 0 ? <div className="text-sm text-muted-foreground">暂无历史版本。</div> : null}
      </div>
    </Dialog>
  );
}

function PromptLogsDialog({ open, onClose, chapterId }: { open: boolean; onClose: () => void; chapterId: string | null }) {
  const logs = useQuery({
    queryKey: ["chapter-prompt-logs", chapterId],
    queryFn: () => apiFetch<Array<Record<string, unknown>>>(`/api/chapters/${chapterId}/prompt-logs`),
    enabled: open && Boolean(chapterId)
  });
  return (
    <Dialog open={open} title="本章 Prompt 记录" onClose={onClose} className="max-w-5xl">
      <div className="space-y-3">
        {logs.data?.map((log) => (
          <div key={String(log.id)} className="space-y-2 rounded-md border p-3">
            <div className="text-sm font-medium">{String(log.taskType)} / {String(log.model)} / {new Date(String(log.createdAt)).toLocaleString()}</div>
            <JsonView value={log} />
          </div>
        ))}
        {logs.data?.length === 0 ? <div className="text-sm text-muted-foreground">暂无 Prompt 记录。</div> : null}
      </div>
    </Dialog>
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

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

function actionLabel(action: string) {
  const map: Record<string, string> = {
    summarize: "章节摘要",
    "extract-knowledge": "知识库抽取",
    "check-consistency": "一致性检查"
  };
  return map[action] ?? action;
}

type ContextItem = { id: string; name: string; [key: string]: unknown };

type PromptPreviewData = {
  messages?: Array<{ role: string; content: string }>;
  promptSnapshot?: string;
  contextSnapshot?: Record<string, unknown>;
  contextDetails?: {
    fixedKnowledgeEntries?: ContextItem[];
    recentChapters?: ContextItem[];
    previousChapterContents?: ContextItem[];
    characters?: ContextItem[];
    locations?: ContextItem[];
    factions?: ContextItem[];
    foreshadowings?: ContextItem[];
    items?: ContextItem[];
  };
};

function PromptPreviewDialog({ open, onClose, data }: { open: boolean; onClose: () => void; data: unknown }) {
  const [selectedItem, setSelectedItem] = useState<ContextItem | null>(null);
  const previewData = data as PromptPreviewData;

  const contextDetails = previewData?.contextDetails || {};

  const sections: Array<{ key: keyof typeof contextDetails; label: string; emptyText: string; showContent?: boolean }> = [
    { key: "fixedKnowledgeEntries", label: "固定世界观", emptyText: "无固定世界观条目" },
    { key: "recentChapters", label: "最近章节摘要", emptyText: "无最近章节" },
    { key: "previousChapterContents", label: "前两章正文", emptyText: "无前章正文", showContent: true },
    { key: "characters", label: "出场角色", emptyText: "无出场角色" },
    { key: "locations", label: "场景地点", emptyText: "无场景地点" },
    { key: "factions", label: "相关势力", emptyText: "无相关势力" },
    { key: "foreshadowings", label: "相关伏笔", emptyText: "无相关伏笔" },
    { key: "items", label: "相关道具", emptyText: "无相关道具" }
  ];

  return (
    <>
      <Dialog open={open} title="Prompt 预览" onClose={onClose} className="max-w-5xl">
        <div className="space-y-4">
          {/* 上下文摘要区域 */}
          <div className="rounded-md border bg-slate-50 p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">上下文选择摘要</h3>
            <div className="grid gap-3 md:grid-cols-2">
              {sections.map(({ key, label, emptyText, showContent }) => {
                const items = contextDetails[key] || [];
                return (
                  <div key={key} className="rounded-md border bg-white p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-600">{label}</span>
                      <Badge className="bg-slate-200 text-slate-700 text-xs">{items.length}</Badge>
                    </div>
                    {items.length === 0 ? (
                      <div className="text-xs text-slate-400">{emptyText}</div>
                    ) : showContent ? (
                      <div className="space-y-2">
                        {items.map((item) => (
                          <div key={item.id} className="rounded-md bg-slate-50 p-2 text-xs">
                            <div className="mb-1 font-medium text-slate-700">第{item.chapterNo}章《{item.name}》</div>
                            <div className="max-h-24 overflow-auto text-slate-600 whitespace-pre-wrap">
                              {String(item.content || "").slice(0, 500)}
                              {String(item.content || "").length > 500 && "..."}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {items.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setSelectedItem(item)}
                            className="inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700 transition hover:bg-slate-200 hover:text-slate-900"
                            title="点击查看详情"
                          >
                            {item.name || "未命名"}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Prompt 内容区域 */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">完整 Prompt</h3>
            {previewData?.messages?.map((message, index) => (
              <div key={index} className="rounded-md border">
                <div className="border-b bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
                  {message.role === "system" ? "系统提示" : message.role === "user" ? "用户输入" : "助手回复"}
                </div>
                <pre className="max-h-64 overflow-auto p-3 text-xs leading-relaxed text-slate-800 whitespace-pre-wrap">{message.content}</pre>
              </div>
            ))}
          </div>

          {/* 原始数据（可折叠） */}
          <details className="rounded-md border">
            <summary className="cursor-pointer bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100">
              原始数据快照（调试）
            </summary>
            <div className="p-3">
              <JsonView value={data} />
            </div>
          </details>
        </div>
      </Dialog>

      {/* 详情弹窗 */}
      <Dialog open={Boolean(selectedItem)} title={selectedItem?.name || "详情"} onClose={() => setSelectedItem(null)} className="max-w-2xl">
        {selectedItem && (
          <div className="space-y-3">
            <div className="text-xs text-slate-500">ID: {selectedItem.id}</div>
            <JsonView value={selectedItem} />
          </div>
        )}
      </Dialog>
    </>
  );
}
