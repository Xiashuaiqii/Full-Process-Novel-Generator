"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit, Plus, Trash2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TabList } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { JsonView } from "@/components/ui/json-view";
import { useToast } from "@/components/ui/toast";
import { apiFetch, reportFrontendError } from "@/services/api";

type Entity = Record<string, unknown> & { id: string; name?: string; title?: string };

type FieldConfig = {
  key: string;
  label: string;
  kind?: "text" | "textarea" | "number" | "boolean" | "select" | "reference";
  options?: { value: string; label: string }[];
  required?: boolean;
  refType?: "character" | "location" | "faction" | "chapter" | "foreshadowing" | "item";
  refLabelField?: string;
};

type TabConfig = {
  value: string;
  label: string;
  endpoint: string;
  titleKey: string;
  fields: FieldConfig[];
};

const STATUS_OPTIONS = [
  { value: "active", label: "活跃" },
  { value: "dead", label: "死亡" },
  { value: "missing", label: "失踪" },
  { value: "hidden", label: "隐藏" },
  { value: "retired", label: "退场" }
];

const IMPORTANCE_OPTIONS = [
  { value: "low", label: "低" },
  { value: "normal", label: "普通" },
  { value: "high", label: "高" },
  { value: "critical", label: "关键" }
];

// 定义关联字段映射，用于显示可读名称
type ReferenceFieldConfig = {
  key: string;
  refType: "characters" | "locations" | "factions" | "chapters" | "foreshadowings" | "items";
  labelField: string;
};

function getReferenceFields(tabValue: string): ReferenceFieldConfig[] {
  const map: Record<string, ReferenceFieldConfig[]> = {
    characters: [
      { key: "factionId", refType: "factions", labelField: "name" },
      { key: "currentLocationId", refType: "locations", labelField: "name" },
      { key: "firstAppearanceChapterId", refType: "chapters", labelField: "title" },
      { key: "lastAppearanceChapterId", refType: "chapters", labelField: "title" }
    ],
    locations: [
      { key: "parentId", refType: "locations", labelField: "name" }
    ],
    factions: [
      { key: "leaderCharacterId", refType: "characters", labelField: "name" },
      { key: "territoryLocationId", refType: "locations", labelField: "name" }
    ],
    relationships: [
      { key: "characterAId", refType: "characters", labelField: "name" },
      { key: "characterBId", refType: "characters", labelField: "name" }
    ],
    foreshadowings: [
      { key: "plantedChapterId", refType: "chapters", labelField: "title" },
      { key: "expectedRevealChapterId", refType: "chapters", labelField: "title" },
      { key: "actualRevealChapterId", refType: "chapters", labelField: "title" }
    ],
    items: [
      { key: "ownerCharacterId", refType: "characters", labelField: "name" },
      { key: "currentLocationId", refType: "locations", labelField: "name" }
    ],
    "timeline-events": [
      { key: "chapterId", refType: "chapters", labelField: "title" }
    ]
  };
  return map[tabValue] ?? [];
}

const TABS: TabConfig[] = [
  {
    value: "knowledge-entries",
    label: "固定设定 / 世界观",
    endpoint: "knowledge-entries",
    titleKey: "title",
    fields: [
      { key: "title", label: "标题", required: true },
      { key: "type", label: "类型", kind: "select", options: ["worldview", "cultivation", "rule", "history", "style", "race", "technology", "custom"].map((value) => ({ value, label: value })) },
      { key: "content", label: "内容", kind: "textarea", required: true },
      { key: "isFixedContext", label: "固定进入上下文", kind: "boolean" },
      { key: "priority", label: "优先级", kind: "number" }
    ]
  },
  {
    value: "characters",
    label: "角色",
    endpoint: "characters",
    titleKey: "name",
    fields: [
      { key: "name", label: "姓名", required: true },
      { key: "alias", label: "别名" },
      { key: "gender", label: "性别" },
      { key: "age", label: "年龄" },
      { key: "identity", label: "身份", kind: "textarea" },
      { key: "personality", label: "性格", kind: "textarea" },
      { key: "appearance", label: "外貌", kind: "textarea" },
      { key: "motivation", label: "动机", kind: "textarea" },
      { key: "secret", label: "秘密", kind: "textarea" },
      { key: "factionId", label: "所属势力", kind: "reference", refType: "faction", refLabelField: "name" },
      { key: "currentLocationId", label: "当前地点", kind: "reference", refType: "location", refLabelField: "name" },
      { key: "realmLevel", label: "境界" },
      { key: "ability", label: "能力", kind: "textarea" },
      { key: "status", label: "状态", kind: "select", options: STATUS_OPTIONS },
      { key: "firstAppearanceChapterId", label: "首次出场章节", kind: "reference", refType: "chapter", refLabelField: "title" },
      { key: "lastAppearanceChapterId", label: "最近出场章节", kind: "reference", refType: "chapter", refLabelField: "title" }
    ]
  },
  {
    value: "locations",
    label: "地点地图",
    endpoint: "locations",
    titleKey: "name",
    fields: [
      { key: "name", label: "名称", required: true },
      { key: "type", label: "类型", kind: "select", options: ["world", "continent", "country", "province", "city", "village", "sect", "mountain", "river", "secret_realm", "building", "room", "custom"].map((value) => ({ value, label: value })) },
      { key: "parentId", label: "上级地点", kind: "reference", refType: "location", refLabelField: "name" },
      { key: "description", label: "描述", kind: "textarea" },
      { key: "climate", label: "气候" },
      { key: "culture", label: "文化", kind: "textarea" },
      { key: "dangerLevel", label: "危险等级" },
      { key: "currentStatus", label: "当前状态", kind: "textarea" }
    ]
  },
  {
    value: "factions",
    label: "势力组织",
    endpoint: "factions",
    titleKey: "name",
    fields: [
      { key: "name", label: "名称", required: true },
      { key: "type", label: "类型", kind: "select", options: ["sect", "kingdom", "family", "guild", "company", "army", "secret_org", "custom"].map((value) => ({ value, label: value })) },
      { key: "description", label: "描述", kind: "textarea" },
      { key: "leaderCharacterId", label: "领袖", kind: "reference", refType: "character", refLabelField: "name" },
      { key: "territoryLocationId", label: "领地", kind: "reference", refType: "location", refLabelField: "name" },
      { key: "ideology", label: "理念", kind: "textarea" },
      { key: "strengthLevel", label: "实力等级" },
      { key: "currentStatus", label: "当前状态", kind: "textarea" }
    ]
  },
  {
    value: "relationships",
    label: "人物关系",
    endpoint: "relationships",
    titleKey: "relationshipType",
    fields: [
      { key: "characterAId", label: "角色 A", required: true, kind: "reference", refType: "character", refLabelField: "name" },
      { key: "characterBId", label: "角色 B", required: true, kind: "reference", refType: "character", refLabelField: "name" },
      { key: "relationshipType", label: "关系类型", kind: "select", options: ["friend", "enemy", "family", "lover", "master_disciple", "rival", "alliance", "suspicion", "custom"].map((value) => ({ value, label: value })) },
      { key: "relationshipStrength", label: "关系强度 -100 到 100", kind: "number" },
      { key: "description", label: "描述", kind: "textarea" },
      { key: "currentStatus", label: "当前状态", kind: "textarea" }
    ]
  },
  {
    value: "foreshadowings",
    label: "伏笔",
    endpoint: "foreshadowings",
    titleKey: "title",
    fields: [
      { key: "title", label: "标题", required: true },
      { key: "description", label: "描述", kind: "textarea", required: true },
      { key: "plantedChapterId", label: "埋设章节", kind: "reference", refType: "chapter", refLabelField: "title" },
      { key: "expectedRevealChapterId", label: "预计揭露章节", kind: "reference", refType: "chapter", refLabelField: "title" },
      { key: "actualRevealChapterId", label: "实际揭露章节", kind: "reference", refType: "chapter", refLabelField: "title" },
      { key: "status", label: "状态", kind: "select", options: ["planted", "developing", "revealed", "abandoned"].map((value) => ({ value, label: value })) },
      { key: "importance", label: "重要性", kind: "select", options: IMPORTANCE_OPTIONS }
    ]
  },
  {
    value: "items",
    label: "道具",
    endpoint: "items",
    titleKey: "name",
    fields: [
      { key: "name", label: "名称", required: true },
      { key: "type", label: "类型" },
      { key: "description", label: "描述", kind: "textarea" },
      { key: "ownerCharacterId", label: "持有者", kind: "reference", refType: "character", refLabelField: "name" },
      { key: "currentLocationId", label: "当前地点", kind: "reference", refType: "location", refLabelField: "name" },
      { key: "ability", label: "能力", kind: "textarea" },
      { key: "currentStatus", label: "当前状态", kind: "textarea" }
    ]
  },
  {
    value: "timeline-events",
    label: "时间线事件",
    endpoint: "timeline-events",
    titleKey: "title",
    fields: [
      { key: "chapterId", label: "关联章节", kind: "reference", refType: "chapter", refLabelField: "title" },
      { key: "eventOrder", label: "事件顺序", kind: "number" },
      { key: "eventTimeText", label: "时间文本" },
      { key: "title", label: "标题", required: true },
      { key: "description", label: "描述", kind: "textarea", required: true },
      { key: "importance", label: "重要性", kind: "select", options: IMPORTANCE_OPTIONS }
    ]
  }
];

export function KnowledgeTabs({ novelId }: { novelId: string }) {
  const [active, setActive] = useState(TABS[0].value);
  const current = TABS.find((tab) => tab.value === active) ?? TABS[0];
  
  // 预加载所有关联实体数据
  const characters = useQuery({
    queryKey: ["characters", novelId],
    queryFn: () => apiFetch<Entity[]>(`/api/novels/${novelId}/characters`),
    staleTime: 60000
  });
  const locations = useQuery({
    queryKey: ["locations", novelId],
    queryFn: () => apiFetch<Entity[]>(`/api/novels/${novelId}/locations`),
    staleTime: 60000
  });
  const factions = useQuery({
    queryKey: ["factions", novelId],
    queryFn: () => apiFetch<Entity[]>(`/api/novels/${novelId}/factions`),
    staleTime: 60000
  });
  const chapters = useQuery({
    queryKey: ["chapters", novelId],
    queryFn: () => apiFetch<Entity[]>(`/api/novels/${novelId}/chapters`),
    staleTime: 60000
  });
  const foreshadowings = useQuery({
    queryKey: ["foreshadowings", novelId],
    queryFn: () => apiFetch<Entity[]>(`/api/novels/${novelId}/foreshadowings`),
    staleTime: 60000
  });
  const items = useQuery({
    queryKey: ["items", novelId],
    queryFn: () => apiFetch<Entity[]>(`/api/novels/${novelId}/items`),
    staleTime: 60000
  });

  const referenceData = useMemo(() => ({
    characters: characters.data ?? [],
    locations: locations.data ?? [],
    factions: factions.data ?? [],
    chapters: chapters.data ?? [],
    foreshadowings: foreshadowings.data ?? [],
    items: items.data ?? []
  }), [characters.data, locations.data, factions.data, chapters.data, foreshadowings.data, items.data]);

  const isLoading = characters.isLoading || locations.isLoading || factions.isLoading || 
                    chapters.isLoading || foreshadowings.isLoading || items.isLoading;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">知识库管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">维护结构化设定，章节生成时可手动选择进入 Prompt 的上下文。</p>
        </div>
        <Link className="inline-flex h-9 items-center rounded-md border bg-white px-3 text-sm hover:bg-muted" href={`/novels/${novelId}`}>返回工作台</Link>
      </div>
      <TabList value={active} onChange={setActive} tabs={TABS.map((tab) => ({ value: tab.value, label: tab.label }))} />
      {isLoading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">正在加载关联数据...</div>
      ) : (
        <KnowledgeTable novelId={novelId} config={current} referenceData={referenceData} />
      )}
    </div>
  );
}

type ReferenceData = {
  characters: Entity[];
  locations: Entity[];
  factions: Entity[];
  chapters: Entity[];
  foreshadowings: Entity[];
  items: Entity[];
};

function KnowledgeTable({ novelId, config, referenceData }: { novelId: string; config: TabConfig; referenceData: ReferenceData }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Entity | null>(null);
  const [open, setOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<{ entity: Entity; type: string } | null>(null);

  const query = useQuery({
    queryKey: ["knowledge", config.endpoint, novelId],
    queryFn: () => apiFetch<Entity[]>(`/api/novels/${novelId}/${config.endpoint}`)
  });

  const save = useMutation({
    mutationFn: (value: Entity) => {
      if (editing) {
        return apiFetch(`/${"api"}/${config.endpoint}/${editing.id}`, {
          method: "PUT",
          body: JSON.stringify(value)
        });
      }
      return apiFetch(`/api/novels/${novelId}/${config.endpoint}`, {
        method: "POST",
        body: JSON.stringify(value)
      });
    },
    onSuccess: () => {
      toast({ title: "记录已保存" });
      setOpen(false);
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["knowledge", config.endpoint, novelId] });
    },
    onError: (error) => {
      reportFrontendError(error, "knowledge_save");
      toast({ title: "保存失败", description: error.message, variant: "destructive" });
    }
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/${config.endpoint}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "记录已删除" });
      void queryClient.invalidateQueries({ queryKey: ["knowledge", config.endpoint, novelId] });
    },
    onError: (error) => toast({ title: "删除失败", description: error.message, variant: "destructive" })
  });

  // 获取关联字段配置
  const referenceFields = useMemo(() => getReferenceFields(config.value), [config.value]);

  // 获取关联实体的显示名称
  const getReferenceName = (fieldKey: string, id: string | null | undefined): string => {
    if (!id) return "-";
    const refConfig = referenceFields.find((f) => f.key === fieldKey);
    if (!refConfig) return id.slice(0, 8) + "...";
    const entity = referenceData[refConfig.refType].find((e) => e.id === id);
    if (!entity) return "未知";
    return String(entity[refConfig.labelField as keyof Entity] ?? "未命名");
  };

  // 获取关联实体完整数据
  const getReferenceEntity = (fieldKey: string, id: string | null | undefined): Entity | null => {
    if (!id) return null;
    const refConfig = referenceFields.find((f) => f.key === fieldKey);
    if (!refConfig) return null;
    return referenceData[refConfig.refType].find((e) => e.id === id) ?? null;
  };

  const titleField = config.fields.find((field) => field.key === config.titleKey);
  const secondaryFields = config.fields.filter((field) => field.key !== config.titleKey).slice(0, 4);

  // 判断字段是否是关联字段
  const isReferenceField = (key: string): boolean => {
    return referenceFields.some((f) => f.key === key);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">共 {query.data?.length ?? 0} 条</div>
        <Button onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="h-4 w-4" />
          新增{config.label}
        </Button>
      </div>
      <div className="overflow-hidden rounded-md border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="px-3 py-2">{titleField?.label ?? "名称"}</th>
              {secondaryFields.map((field) => (
                <th key={field.key} className="hidden px-3 py-2 lg:table-cell">{field.label}</th>
              ))}
              <th className="w-32 px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {query.data?.map((item) => (
              <tr key={item.id} className="border-t">
                <td className="px-3 py-2">
                  <div className="font-medium">{String(item[config.titleKey] ?? "未命名")}</div>
                  <div className="mt-1 text-xs text-muted-foreground">ID: {item.id.slice(0, 8)}...</div>
                </td>
                {secondaryFields.map((field) => (
                  <td key={field.key} className="hidden max-w-[240px] truncate px-3 py-2 text-muted-foreground lg:table-cell">
                    {field.kind === "boolean" ? (
                      item[field.key] ? "是" : "否"
                    ) : isReferenceField(field.key) ? (
                      <ReferenceBadge
                        name={getReferenceName(field.key, String(item[field.key]))}
                        onClick={() => {
                          const entity = getReferenceEntity(field.key, String(item[field.key]));
                          if (entity) {
                            const refConfig = referenceFields.find((f) => f.key === field.key);
                            setDetailItem({ entity, type: refConfig?.refType ?? "unknown" });
                          }
                        }}
                      />
                    ) : (
                      String(item[field.key] ?? "")
                    )}
                  </td>
                ))}
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => { setEditing(item); setOpen(true); }}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (confirm("确认删除这条记录？")) {
                          remove.mutate(item.id);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {query.data?.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">暂无数据。</div> : null}
      </div>
      <EntityFormDialog
        open={open}
        title={`${editing ? "编辑" : "新增"}${config.label}`}
        config={config}
        initialValue={editing}
        loading={save.isPending}
        referenceData={referenceData}
        onClose={() => { setOpen(false); setEditing(null); }}
        onSubmit={(value) => save.mutate(value)}
      />
      {/* 关联实体详情弹窗 */}
      <Dialog 
        open={Boolean(detailItem)} 
        title={detailItem ? `${getEntityTypeLabel(detailItem.type)}详情` : "详情"} 
        onClose={() => setDetailItem(null)}
        className="max-w-2xl"
      >
        {detailItem && (
          <div className="space-y-3">
            <div className="text-lg font-medium">{String(detailItem.entity.name ?? detailItem.entity.title ?? "未命名")}</div>
            <div className="text-xs text-slate-500">ID: {detailItem.entity.id}</div>
            <JsonView value={detailItem.entity} />
          </div>
        )}
      </Dialog>
    </div>
  );
}

function getEntityTypeLabel(type: string): string {
  const map: Record<string, string> = {
    characters: "角色",
    locations: "地点",
    factions: "势力",
    chapters: "章节",
    foreshadowings: "伏笔",
    items: "道具"
  };
  return map[type] ?? type;
}

function ReferenceBadge({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700 transition hover:bg-slate-200 hover:text-slate-900"
      title="点击查看详情"
    >
      {name}
      <ExternalLink className="h-3 w-3" />
    </button>
  );
}

function EntityFormDialog({
  open,
  title,
  config,
  initialValue,
  loading,
  referenceData,
  onClose,
  onSubmit
}: {
  open: boolean;
  title: string;
  config: TabConfig;
  initialValue: Entity | null;
  loading: boolean;
  referenceData: ReferenceData;
  onClose: () => void;
  onSubmit: (value: Entity) => void;
}) {
  const [form, setForm] = useState<Entity>({ id: "" });

  useEffect(() => {
    const base: Entity = { id: "" };
    for (const field of config.fields) {
      if (field.kind === "boolean") base[field.key] = false;
      else if (field.kind === "number") base[field.key] = field.key === "priority" ? 100 : 0;
      else if (field.kind === "select") base[field.key] = field.options?.[0]?.value ?? "";
      else base[field.key] = "";
    }
    setForm({ ...base, ...(initialValue ?? {}) });
  }, [config, initialValue, open]);

  const update = (key: string, value: unknown) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  // 获取关联选项
  const getReferenceOptions = (field: FieldConfig): { value: string; label: string }[] => {
    if (!field.refType) return [];
    const entities = referenceData[`${field.refType}s` as keyof ReferenceData] as Entity[];
    return [
      { value: "", label: "请选择..." },
      ...entities.map((e) => ({
        value: e.id,
        label: String(e[field.refLabelField ?? "name"] ?? "未命名")
      }))
    ];
  };

  return (
    <Dialog open={open} title={title} onClose={onClose}>
      <div className="grid gap-4">
        {config.fields.map((field) => (
          <div key={field.key} className="grid gap-2">
            <Label>{field.label}{field.required ? " *" : ""}</Label>
            {field.kind === "textarea" ? (
              <Textarea rows={4} value={String(form[field.key] ?? "")} onChange={(event) => update(field.key, event.target.value)} />
            ) : field.kind === "boolean" ? (
              <label className="flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm">
                <input type="checkbox" checked={Boolean(form[field.key])} onChange={(event) => update(field.key, event.target.checked)} />
                是
              </label>
            ) : field.kind === "number" ? (
              <Input type="number" value={Number(form[field.key] ?? 0)} onChange={(event) => update(field.key, Number(event.target.value))} />
            ) : field.kind === "select" ? (
              <select className="h-9 rounded-md border bg-white px-3 text-sm" value={String(form[field.key] ?? "")} onChange={(event) => update(field.key, event.target.value)}>
                {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            ) : field.kind === "reference" ? (
              <select className="h-9 rounded-md border bg-white px-3 text-sm" value={String(form[field.key] ?? "")} onChange={(event) => update(field.key, event.target.value)}>
                {getReferenceOptions(field).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            ) : (
              <Input value={String(form[field.key] ?? "")} onChange={(event) => update(field.key, event.target.value)} />
            )}
          </div>
        ))}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button disabled={loading} onClick={() => onSubmit(form)}>
            {loading ? "保存中" : "保存"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
