import { z } from "zod";

export const modelSchema = z.enum(["deepseek-v4-flash", "deepseek-v4-pro"]);
export const reasoningEffortSchema = z.enum(["high", "max"]);
export const taskTypeSchema = z.enum([
  "chapter_generation",
  "chapter_summary",
  "knowledge_extraction",
  "consistency_check"
]);

export const taskProfileSchema = z.object({
  taskType: taskTypeSchema,
  model: modelSchema,
  thinkingEnabled: z.boolean(),
  reasoningEffort: reasoningEffortSchema,
  temperature: z.coerce.number().min(0).max(2),
  topP: z.coerce.number().min(0).max(1),
  maxTokens: z.coerce.number().int().min(256).max(64000),
  stream: z.boolean(),
  streamIncludeUsage: z.boolean(),
  stopSequences: z.array(z.string()).default([]),
  logprobs: z.boolean(),
  topLogprobs: z.coerce.number().int().min(0).max(20)
});

export const settingsUpdateSchema = z.object({
  apiKey: z.string().optional(),
  clearApiKey: z.boolean().optional(),
  baseUrl: z.string().url(),
  betaBaseUrl: z.string().url(),
  profiles: z.array(taskProfileSchema).length(4)
});

export const novelSchema = z.object({
  title: z.string().min(1, "标题不能为空"),
  genre: z.string().optional().nullable(),
  theme: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  writingStyle: z.string().optional().nullable(),
  targetReader: z.string().optional().nullable(),
  status: z.enum(["active", "archived"]).default("active")
});

export const volumeSchema = z.object({
  title: z.string().min(1, "卷名不能为空"),
  summary: z.string().optional().nullable(),
  sortOrder: z.coerce.number().int().min(1)
});

export const chapterSchema = z.object({
  volumeId: z.string().optional().nullable(),
  title: z.string().min(1, "章节标题不能为空"),
  chapterNo: z.coerce.number().int().min(1),
  outline: z.string().optional().nullable(),
  content: z.string().optional().nullable(),
  status: z.string().optional()
});

export const chapterUpdateSchema = chapterSchema.partial().extend({
  content: z.string().optional().nullable()
});

export const selectedContextSchema = z.object({
  includeFixedKnowledge: z.boolean().default(true),
  recentChapterCount: z.coerce.number().int().min(0).max(10).default(3),
  characterIds: z.array(z.string()).default([]),
  locationIds: z.array(z.string()).default([]),
  factionIds: z.array(z.string()).default([]),
  foreshadowingIds: z.array(z.string()).default([]),
  itemIds: z.array(z.string()).default([])
});

export const generationOverrideSchema = z
  .object({
    model: modelSchema.optional(),
    temperature: z.coerce.number().min(0).max(2).optional(),
    topP: z.coerce.number().min(0).max(1).optional(),
    maxTokens: z.coerce.number().int().min(256).max(64000).optional(),
    stream: z.boolean().optional(),
    thinkingEnabled: z.boolean().optional(),
    reasoningEffort: reasoningEffortSchema.optional(),
    stopSequences: z.array(z.string()).optional(),
    logprobs: z.boolean().optional(),
    topLogprobs: z.coerce.number().int().min(0).max(20).optional(),
    streamIncludeUsage: z.boolean().optional()
  })
  .default({});

export const chapterGenerateSchema = z.object({
  chapterGoal: z.string().default(""),
  targetWordCount: z.coerce.number().int().min(100).max(50000).default(3000),
  tone: z.string().default(""),
  selectedContext: selectedContextSchema,
  constraints: z.array(z.string()).default([]),
  overrides: generationOverrideSchema
});

export const promptPreviewSchema = chapterGenerateSchema.omit({
  overrides: true
});

export const knowledgeEntrySchema = z.object({
  title: z.string().min(1, "标题不能为空"),
  type: z.string().min(1, "类型不能为空"),
  content: z.string().min(1, "内容不能为空"),
  isFixedContext: z.boolean().default(false),
  priority: z.coerce.number().int().default(100)
});

export const characterSchema = z.object({
  name: z.string().min(1, "角色名不能为空"),
  alias: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  age: z.string().optional().nullable(),
  identity: z.string().optional().nullable(),
  personality: z.string().optional().nullable(),
  appearance: z.string().optional().nullable(),
  motivation: z.string().optional().nullable(),
  secret: z.string().optional().nullable(),
  factionId: z.string().optional().nullable(),
  currentLocationId: z.string().optional().nullable(),
  realmLevel: z.string().optional().nullable(),
  ability: z.string().optional().nullable(),
  status: z.enum(["active", "dead", "missing", "hidden", "retired"]).default("active"),
  firstAppearanceChapterId: z.string().optional().nullable(),
  lastAppearanceChapterId: z.string().optional().nullable()
});

export const locationSchema = z.object({
  name: z.string().min(1, "地点名不能为空"),
  type: z.string().min(1, "类型不能为空"),
  parentId: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  climate: z.string().optional().nullable(),
  culture: z.string().optional().nullable(),
  dangerLevel: z.string().optional().nullable(),
  currentStatus: z.string().optional().nullable()
});

export const factionSchema = z.object({
  name: z.string().min(1, "势力名不能为空"),
  type: z.string().min(1, "类型不能为空"),
  description: z.string().optional().nullable(),
  leaderCharacterId: z.string().optional().nullable(),
  territoryLocationId: z.string().optional().nullable(),
  ideology: z.string().optional().nullable(),
  strengthLevel: z.string().optional().nullable(),
  currentStatus: z.string().optional().nullable()
});

export const relationshipSchema = z.object({
  characterAId: z.string().min(1, "角色 A 不能为空"),
  characterBId: z.string().min(1, "角色 B 不能为空"),
  relationshipType: z.string().min(1, "关系类型不能为空"),
  relationshipStrength: z.coerce.number().int().min(-100).max(100).default(0),
  description: z.string().optional().nullable(),
  currentStatus: z.string().optional().nullable()
});

export const foreshadowingSchema = z.object({
  title: z.string().min(1, "伏笔标题不能为空"),
  description: z.string().min(1, "伏笔描述不能为空"),
  plantedChapterId: z.string().optional().nullable(),
  expectedRevealChapterId: z.string().optional().nullable(),
  actualRevealChapterId: z.string().optional().nullable(),
  status: z.enum(["planted", "developing", "revealed", "abandoned"]).default("planted"),
  importance: z.enum(["low", "normal", "high", "critical"]).default("normal")
});

export const itemSchema = z.object({
  name: z.string().min(1, "道具名不能为空"),
  type: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  ownerCharacterId: z.string().optional().nullable(),
  currentLocationId: z.string().optional().nullable(),
  ability: z.string().optional().nullable(),
  currentStatus: z.string().optional().nullable()
});

export const timelineEventSchema = z.object({
  chapterId: z.string().optional().nullable(),
  eventOrder: z.coerce.number().int().optional().nullable(),
  eventTimeText: z.string().optional().nullable(),
  title: z.string().min(1, "事件标题不能为空"),
  description: z.string().min(1, "事件描述不能为空"),
  importance: z.enum(["low", "normal", "high", "critical"]).default("normal")
});

export const summaryOutputSchema = z.object({
  short_summary: z.string(),
  long_summary: z.string(),
  key_events: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      importance: z.enum(["low", "normal", "high", "critical"])
    })
  ),
  characters: z.array(z.string()),
  locations: z.array(z.string()),
  foreshadowing_updates: z.array(z.string())
});

export const consistencyOutputSchema = z.object({
  issues: z.array(
    z.object({
      type: z.enum([
        "character_status_conflict",
        "location_conflict",
        "timeline_conflict",
        "foreshadowing_conflict",
        "worldview_conflict",
        "relationship_conflict",
        "item_conflict"
      ]),
      severity: z.enum(["low", "medium", "high"]),
      title: z.string(),
      description: z.string(),
      related_entity: z.string(),
      suggestion: z.string()
    })
  )
});

export const editProposalSchema = z.object({
  afterData: z.unknown()
});

export const frontendLogSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]).default("error"),
  scope: z.string().default("frontend"),
  message: z.string().min(1),
  details: z.unknown().optional(),
  stack: z.string().optional()
});
