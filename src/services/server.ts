import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/local-user";
import { encryptSecret, maskApiKey } from "@/lib/crypto";
import { countChineseWords } from "@/lib/word-count";
import { safeJsonParse, truncateForDisplay } from "@/lib/json";
import { logError, writeAppLog } from "@/lib/logging";
import {
  buildChapterGenerationPrompt,
  buildChapterSummaryPrompt,
  buildConsistencyCheckPrompt,
  buildKnowledgeContext,
  buildKnowledgeExtractionPrompt
} from "@/lib/prompt-builder";
import {
  buildDeepSeekRequestParams,
  callDeepSeekJson,
  callDeepSeekStrictTools,
  callDeepSeekText,
  callDeepSeekTextStream,
  createAiPromptLog,
  getDeepSeekClient,
  getDeepSeekSettings,
  KNOWLEDGE_EXTRACTION_TOOLS,
  updateAiPromptLog,
  usageToTaskUpdate,
  type DeepSeekOverrides,
  type DeepSeekTaskType
} from "@/lib/deepseek";
import {
  characterSchema,
  chapterGenerateSchema,
  chapterSchema,
  chapterUpdateSchema,
  consistencyOutputSchema,
  editProposalSchema,
  factionSchema,
  foreshadowingSchema,
  frontendLogSchema,
  itemSchema,
  knowledgeEntrySchema,
  locationSchema,
  novelSchema,
  promptPreviewSchema,
  relationshipSchema,
  settingsUpdateSchema,
  summaryOutputSchema,
  timelineEventSchema,
  volumeSchema
} from "@/lib/schemas";
import { z } from "zod";

type Delegate = {
  findMany(args?: Record<string, unknown>): Promise<unknown[]>;
  findFirst(args?: Record<string, unknown>): Promise<unknown | null>;
  findUnique(args: Record<string, unknown>): Promise<unknown | null>;
  findUniqueOrThrow(args: Record<string, unknown>): Promise<unknown>;
  create(args: Record<string, unknown>): Promise<unknown>;
  createMany(args: Record<string, unknown>): Promise<unknown>;
  update(args: Record<string, unknown>): Promise<unknown>;
  delete(args: Record<string, unknown>): Promise<unknown>;
  count(args?: Record<string, unknown>): Promise<number>;
};

type EntityConfig = {
  apiPlural: string;
  delegate: keyof PrismaClient;
  schema: z.ZodTypeAny;
  orderBy: Record<string, "asc" | "desc">;
};

const ENTITY_CONFIGS: EntityConfig[] = [
  {
    apiPlural: "knowledge-entries",
    delegate: "knowledgeEntry",
    schema: knowledgeEntrySchema,
    orderBy: { priority: "asc" }
  },
  {
    apiPlural: "characters",
    delegate: "character",
    schema: characterSchema,
    orderBy: { createdAt: "desc" }
  },
  {
    apiPlural: "locations",
    delegate: "location",
    schema: locationSchema,
    orderBy: { createdAt: "desc" }
  },
  {
    apiPlural: "factions",
    delegate: "faction",
    schema: factionSchema,
    orderBy: { createdAt: "desc" }
  },
  {
    apiPlural: "relationships",
    delegate: "characterRelationship",
    schema: relationshipSchema,
    orderBy: { createdAt: "desc" }
  },
  {
    apiPlural: "foreshadowings",
    delegate: "foreshadowing",
    schema: foreshadowingSchema,
    orderBy: { createdAt: "desc" }
  },
  {
    apiPlural: "items",
    delegate: "item",
    schema: itemSchema,
    orderBy: { createdAt: "desc" }
  },
  {
    apiPlural: "timeline-events",
    delegate: "timelineEvent",
    schema: timelineEventSchema,
    orderBy: { createdAt: "desc" }
  }
];

function delegate(name: keyof PrismaClient): Delegate {
  return (prisma as unknown as Record<string, Delegate>)[String(name)];
}

function entityConfig(apiPlural: string) {
  const config = ENTITY_CONFIGS.find((item) => item.apiPlural === apiPlural);
  if (!config) throw new Error(`未知知识库实体类型：${apiPlural}`);
  return config;
}

function asRecord(value: unknown) {
  return value as Record<string, unknown>;
}

async function requireNovel(novelId: string) {
  const user = await getOrCreateLocalUser();
  const novel = await prisma.novel.findFirst({
    where: { id: novelId, userId: user.id }
  });
  if (!novel) {
    throw new Error("小说不存在或不属于当前本地用户。");
  }
  return novel;
}

async function requireChapter(chapterId: string) {
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
  if (!chapter) {
    throw new Error("章节不存在。");
  }
  const novel = await requireNovel(chapter.novelId);
  return { chapter, novel };
}

async function requireChapterInNovel(chapterId: string, novelId: string) {
  const chapter = await prisma.chapter.findFirst({
    where: { id: chapterId, novelId }
  });
  if (!chapter) {
    throw new Error("章节不存在或不属于当前小说。");
  }
  return chapter;
}

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function nonEmpty(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function pickNonEmpty<T extends Record<string, unknown>>(data: T) {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value.trim()) continue;
    if (value === "unknown") continue;
    result[key] = value;
  }
  return result;
}

export async function getSettingsPayload() {
  const settings = await getDeepSeekSettings();
  return {
    id: settings.id,
    userId: settings.userId,
    apiKeyMasked: settings.apiKeyMasked,
    hasApiKey: Boolean(settings.apiKeyEncrypted),
    baseUrl: settings.baseUrl,
    betaBaseUrl: settings.betaBaseUrl,
    profiles: settings.profiles.sort((a, b) => a.taskType.localeCompare(b.taskType))
  };
}

export async function updateDeepSeekSettings(body: unknown) {
  const input = settingsUpdateSchema.parse(body);
  const user = await getOrCreateLocalUser();
  const existing = await getDeepSeekSettings();

  const data: {
    baseUrl: string;
    betaBaseUrl: string;
    apiKeyEncrypted?: string | null;
    apiKeyMasked?: string | null;
  } = {
    baseUrl: input.baseUrl,
    betaBaseUrl: input.betaBaseUrl
  };

  if (input.clearApiKey) {
    data.apiKeyEncrypted = null;
    data.apiKeyMasked = null;
  } else if (input.apiKey?.trim()) {
    data.apiKeyEncrypted = encryptSecret(input.apiKey.trim());
    data.apiKeyMasked = maskApiKey(input.apiKey.trim());
  }

  const settings = await prisma.deepSeekSettings.upsert({
    where: { userId: user.id },
    update: data,
    create: {
      userId: user.id,
      ...data
    }
  });

  for (const profile of input.profiles) {
    await prisma.deepSeekTaskProfile.upsert({
      where: {
        settingsId_taskType: {
          settingsId: settings.id,
          taskType: profile.taskType
        }
      },
      update: {
        model: profile.model,
        thinkingEnabled: profile.thinkingEnabled,
        reasoningEffort: profile.reasoningEffort,
        temperature: profile.temperature,
        topP: profile.topP,
        maxTokens: profile.maxTokens,
        stream: profile.stream,
        streamIncludeUsage: profile.streamIncludeUsage,
        stopSequences: profile.stopSequences,
        logprobs: profile.logprobs,
        topLogprobs: profile.topLogprobs
      },
      create: {
        settingsId: settings.id,
        taskType: profile.taskType,
        model: profile.model,
        thinkingEnabled: profile.thinkingEnabled,
        reasoningEffort: profile.reasoningEffort,
        temperature: profile.temperature,
        topP: profile.topP,
        maxTokens: profile.maxTokens,
        stream: profile.stream,
        streamIncludeUsage: profile.streamIncludeUsage,
        stopSequences: profile.stopSequences,
        logprobs: profile.logprobs,
        topLogprobs: profile.topLogprobs
      }
    });
  }

  if (!existing) {
    await writeAppLog({
      level: "info",
      scope: "settings",
      message: "DeepSeek 设置已创建"
    });
  }

  return getSettingsPayload();
}

export async function testDeepSeekConnection() {
  const settings = await getDeepSeekSettings();
  const profile =
    settings.profiles.find((item) => item.taskType === "chapter_summary") ??
    settings.profiles[0];
  const client = await getDeepSeekClient("normal");
  const response = await client.chat.completions.create({
    model: profile?.model ?? "deepseek-v4-flash",
    messages: [
      {
        role: "user",
        content: "请只回复 JSON：{\"ok\":true}"
      }
    ],
    max_tokens: 32,
    temperature: 0,
    response_format: { type: "json_object" },
    user_id: "local-user"
  } as never);

  return {
    message: "连接成功",
    model: profile?.model,
    response: response.choices[0]?.message?.content ?? ""
  };
}

export async function listNovels() {
  const user = await getOrCreateLocalUser();
  return prisma.novel.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" }
  });
}

export async function createNovel(body: unknown) {
  const user = await getOrCreateLocalUser();
  const input = novelSchema.parse(body);
  return prisma.novel.create({
    data: { ...input, userId: user.id }
  });
}

export async function getNovel(novelId: string) {
  return requireNovel(novelId);
}

export async function updateNovel(novelId: string, body: unknown) {
  await requireNovel(novelId);
  const input = novelSchema.partial().parse(body);
  return prisma.novel.update({
    where: { id: novelId },
    data: input
  });
}

export async function deleteNovel(novelId: string) {
  await requireNovel(novelId);
  await prisma.$transaction([
    prisma.volume.deleteMany({ where: { novelId } }),
    prisma.chapterVersion.deleteMany({
      where: { chapterId: { in: (await prisma.chapter.findMany({ where: { novelId }, select: { id: true } })).map((item) => item.id) } }
    }),
    prisma.chapter.deleteMany({ where: { novelId } }),
    prisma.knowledgeEntry.deleteMany({ where: { novelId } }),
    prisma.character.deleteMany({ where: { novelId } }),
    prisma.location.deleteMany({ where: { novelId } }),
    prisma.faction.deleteMany({ where: { novelId } }),
    prisma.characterRelationship.deleteMany({ where: { novelId } }),
    prisma.foreshadowing.deleteMany({ where: { novelId } }),
    prisma.item.deleteMany({ where: { novelId } }),
    prisma.timelineEvent.deleteMany({ where: { novelId } }),
    prisma.generationTask.deleteMany({ where: { novelId } }),
    prisma.knowledgeUpdateProposal.deleteMany({ where: { novelId } }),
    prisma.aiPromptLog.deleteMany({ where: { novelId } }),
    prisma.appLog.deleteMany({ where: { novelId } }),
    prisma.novel.delete({ where: { id: novelId } })
  ]);
  return { id: novelId };
}

export async function listVolumes(novelId: string) {
  await requireNovel(novelId);
  return prisma.volume.findMany({
    where: { novelId },
    orderBy: { sortOrder: "asc" }
  });
}

export async function createVolume(novelId: string, body: unknown) {
  await requireNovel(novelId);
  const input = volumeSchema.parse(body);
  return prisma.volume.create({ data: { ...input, novelId } });
}

export async function updateVolume(volumeId: string, body: unknown) {
  const volume = await prisma.volume.findUnique({ where: { id: volumeId } });
  if (!volume) throw new Error("卷不存在。");
  await requireNovel(volume.novelId);
  const input = volumeSchema.partial().parse(body);
  return prisma.volume.update({ where: { id: volumeId }, data: input });
}

export async function deleteVolume(volumeId: string) {
  const volume = await prisma.volume.findUnique({ where: { id: volumeId } });
  if (!volume) throw new Error("卷不存在。");
  await requireNovel(volume.novelId);
  await prisma.chapter.updateMany({
    where: { volumeId },
    data: { volumeId: null }
  });
  return prisma.volume.delete({ where: { id: volumeId } });
}

export async function listChapters(novelId: string) {
  await requireNovel(novelId);
  return prisma.chapter.findMany({
    where: { novelId },
    orderBy: [{ chapterNo: "asc" }, { createdAt: "asc" }]
  });
}

export async function createChapter(novelId: string, body: unknown) {
  await requireNovel(novelId);
  const input = chapterSchema.parse(body);
  if (input.volumeId) {
    const volume = await prisma.volume.findFirst({
      where: { id: input.volumeId, novelId }
    });
    if (!volume) throw new Error("卷不存在或不属于当前小说。");
  }
  return prisma.chapter.create({
    data: {
      ...input,
      novelId,
      wordCount: countChineseWords(input.content ?? "")
    }
  });
}

export async function getChapter(chapterId: string) {
  const { chapter } = await requireChapter(chapterId);
  return chapter;
}

export async function updateChapter(chapterId: string, body: unknown) {
  const { chapter } = await requireChapter(chapterId);
  const input = chapterUpdateSchema.parse(body);
  if (input.volumeId) {
    const volume = await prisma.volume.findFirst({
      where: { id: input.volumeId, novelId: chapter.novelId }
    });
    if (!volume) throw new Error("卷不存在或不属于当前小说。");
  }
  return prisma.chapter.update({
    where: { id: chapterId },
    data: {
      ...input,
      wordCount:
        input.content !== undefined ? countChineseWords(input.content ?? "") : undefined
    }
  });
}

export async function deleteChapter(chapterId: string) {
  const { chapter } = await requireChapter(chapterId);
  await prisma.$transaction([
    prisma.chapterVersion.deleteMany({ where: { chapterId } }),
    prisma.timelineEvent.updateMany({
      where: { novelId: chapter.novelId, chapterId },
      data: { chapterId: null }
    }),
    prisma.knowledgeUpdateProposal.deleteMany({ where: { chapterId } }),
    prisma.generationTask.deleteMany({ where: { chapterId } }),
    prisma.aiPromptLog.deleteMany({ where: { chapterId } }),
    prisma.chapter.delete({ where: { id: chapterId } })
  ]);
  return { id: chapterId };
}

export async function getChapterVersions(chapterId: string) {
  await requireChapter(chapterId);
  return prisma.chapterVersion.findMany({
    where: { chapterId },
    orderBy: { createdAt: "desc" }
  });
}

export async function listEntity(novelId: string, apiPlural: string) {
  await requireNovel(novelId);
  const config = entityConfig(apiPlural);
  return delegate(config.delegate).findMany({
    where: { novelId },
    orderBy: config.orderBy
  });
}

export async function createEntity(novelId: string, apiPlural: string, body: unknown) {
  await requireNovel(novelId);
  const config = entityConfig(apiPlural);
  const input = config.schema.parse(body);
  if (apiPlural === "timeline-events" && input.chapterId) {
    await requireChapterInNovel(String(input.chapterId), novelId);
  }
  return delegate(config.delegate).create({
    data: { ...input, novelId }
  });
}

export async function updateEntity(apiPlural: string, id: string, body: unknown) {
  const config = entityConfig(apiPlural);
  const model = delegate(config.delegate);
  const existing = await model.findUnique({ where: { id } });
  if (!existing) throw new Error("记录不存在。");
  const record = asRecord(existing);
  const novelId = String(record.novelId);
  await requireNovel(novelId);
  const input = config.schema.partial().parse(body);
  if (apiPlural === "timeline-events" && input.chapterId) {
    await requireChapterInNovel(String(input.chapterId), novelId);
  }
  return model.update({ where: { id }, data: input });
}

export async function deleteEntity(apiPlural: string, id: string) {
  const config = entityConfig(apiPlural);
  const model = delegate(config.delegate);
  const existing = await model.findUnique({ where: { id } });
  if (!existing) throw new Error("记录不存在。");
  await requireNovel(String(asRecord(existing).novelId));
  return model.delete({ where: { id } });
}

async function loadGenerationContext(chapterId: string, body: unknown) {
  const input = chapterGenerateSchema.parse(body);
  const { chapter, novel } = await requireChapter(chapterId);
  const volume = chapter.volumeId
    ? await prisma.volume.findFirst({
        where: { id: chapter.volumeId, novelId: novel.id }
      })
    : null;

  const fixedKnowledgeEntries = input.selectedContext.includeFixedKnowledge
    ? await prisma.knowledgeEntry.findMany({
        where: { novelId: novel.id, isFixedContext: true },
        orderBy: { priority: "asc" }
      })
    : [];

  const recentChapters =
    input.selectedContext.recentChapterCount > 0
      ? await prisma.chapter.findMany({
          where: {
            novelId: novel.id,
            chapterNo: { lt: chapter.chapterNo },
            OR: [{ summaryShort: { not: null } }, { summaryLong: { not: null } }]
          },
          orderBy: { chapterNo: "desc" },
          take: input.selectedContext.recentChapterCount
        })
      : [];

  const previousChapterContents =
    await prisma.chapter.findMany({
      where: {
        novelId: novel.id,
        chapterNo: { lt: chapter.chapterNo },
        content: { not: null }
      },
      orderBy: { chapterNo: "desc" },
      take: 2
    });

  const [characters, locations, factions, foreshadowings, items] = await Promise.all([
    prisma.character.findMany({
      where: { novelId: novel.id, id: { in: input.selectedContext.characterIds } }
    }),
    prisma.location.findMany({
      where: { novelId: novel.id, id: { in: input.selectedContext.locationIds } }
    }),
    prisma.faction.findMany({
      where: { novelId: novel.id, id: { in: input.selectedContext.factionIds } }
    }),
    prisma.foreshadowing.findMany({
      where: { novelId: novel.id, id: { in: input.selectedContext.foreshadowingIds } }
    }),
    prisma.item.findMany({
      where: { novelId: novel.id, id: { in: input.selectedContext.itemIds } }
    })
  ]);

  if (characters.length !== input.selectedContext.characterIds.length) {
    throw new Error("选择的角色中存在不属于当前小说的记录。");
  }
  if (locations.length !== input.selectedContext.locationIds.length) {
    throw new Error("选择的地点中存在不属于当前小说的记录。");
  }
  if (factions.length !== input.selectedContext.factionIds.length) {
    throw new Error("选择的势力中存在不属于当前小说的记录。");
  }
  if (foreshadowings.length !== input.selectedContext.foreshadowingIds.length) {
    throw new Error("选择的伏笔中存在不属于当前小说的记录。");
  }
  if (items.length !== input.selectedContext.itemIds.length) {
    throw new Error("选择的道具中存在不属于当前小说的记录。");
  }

  const prompt = buildChapterGenerationPrompt({
    novel,
    volume,
    chapter,
    fixedKnowledgeEntries,
    recentChapters: recentChapters.reverse(),
    previousChapterContents: previousChapterContents.reverse(),
    selectedCharacters: characters,
    selectedLocations: locations,
    selectedFactions: factions,
    selectedForeshadowings: foreshadowings,
    selectedItems: items,
    chapterGoal: input.chapterGoal,
    targetWordCount: input.targetWordCount,
    tone: input.tone,
    constraints: input.constraints
  });

  return { input, novel, chapter, prompt };
}

export async function previewChapterPrompt(chapterId: string, body: unknown) {
  const parsed = promptPreviewSchema.parse(body);
  const context = await loadGenerationContext(chapterId, {
    ...parsed,
    overrides: {}
  });

  // 从 loadGenerationContext 的查询结果中获取实际数据
  const { chapter, novel } = context;

  const snapshot = context.prompt.contextSnapshot as Record<string, string[]>;

  const fixedKnowledgeEntries = parsed.selectedContext.includeFixedKnowledge && snapshot.fixedKnowledgeEntryIds?.length
    ? await prisma.knowledgeEntry.findMany({
        where: { novelId: novel.id, isFixedContext: true, id: { in: snapshot.fixedKnowledgeEntryIds } },
        orderBy: { priority: "asc" }
      })
    : [];

  const recentChapters = parsed.selectedContext.recentChapterCount > 0 && snapshot.recentChapterIds?.length
    ? await prisma.chapter.findMany({
        where: {
          novelId: novel.id,
          id: { in: snapshot.recentChapterIds }
        },
        orderBy: { chapterNo: "asc" }
      })
    : [];

  const previousChapterContents = snapshot.previousChapterContentIds?.length
    ? await prisma.chapter.findMany({
        where: {
          novelId: novel.id,
          id: { in: snapshot.previousChapterContentIds }
        },
        orderBy: { chapterNo: "asc" }
      })
    : [];

  const [characters, locations, factions, foreshadowings, items] = await Promise.all([
    snapshot.characterIds?.length
      ? prisma.character.findMany({ where: { novelId: novel.id, id: { in: snapshot.characterIds } } })
      : Promise.resolve([]),
    snapshot.locationIds?.length
      ? prisma.location.findMany({ where: { novelId: novel.id, id: { in: snapshot.locationIds } } })
      : Promise.resolve([]),
    snapshot.factionIds?.length
      ? prisma.faction.findMany({ where: { novelId: novel.id, id: { in: snapshot.factionIds } } })
      : Promise.resolve([]),
    snapshot.foreshadowingIds?.length
      ? prisma.foreshadowing.findMany({ where: { novelId: novel.id, id: { in: snapshot.foreshadowingIds } } })
      : Promise.resolve([]),
    snapshot.itemIds?.length
      ? prisma.item.findMany({ where: { novelId: novel.id, id: { in: snapshot.itemIds } } })
      : Promise.resolve([])
  ]);

  return {
    messages: context.prompt.messages,
    promptSnapshot: context.prompt.promptSnapshot,
    contextSnapshot: context.prompt.contextSnapshot,
    contextDetails: {
      fixedKnowledgeEntries: fixedKnowledgeEntries.map((e: { id: string; title: string; type: string; content: string }) => ({ id: e.id, name: e.title, type: e.type, content: e.content })),
      recentChapters: recentChapters.map((c: { id: string; title: string; chapterNo: number; summaryShort: string | null; summaryLong: string | null }) => ({ id: c.id, name: c.title, chapterNo: c.chapterNo, summary: c.summaryShort || c.summaryLong })),
      previousChapterContents: previousChapterContents.map((c: { id: string; title: string; chapterNo: number; content: string | null }) => ({ id: c.id, name: c.title, chapterNo: c.chapterNo, content: c.content })),
      characters: characters.map((c: { id: string; name: string; identity: string | null; status: string }) => ({ id: c.id, name: c.name, identity: c.identity, status: c.status })),
      locations: locations.map((l: { id: string; name: string; type: string }) => ({ id: l.id, name: l.name, type: l.type })),
      factions: factions.map((f: { id: string; name: string; type: string }) => ({ id: f.id, name: f.name, type: f.type })),
      foreshadowings: foreshadowings.map((f: { id: string; title: string; status: string; importance: string }) => ({ id: f.id, name: f.title, status: f.status, importance: f.importance })),
      items: items.map((i: { id: string; name: string; type: string | null }) => ({ id: i.id, name: i.name, type: i.type }))
    }
  };
}

export async function generateChapter(chapterId: string, body: unknown) {
  const context = await loadGenerationContext(chapterId, body);
  const { input, novel, chapter, prompt } = context;
  const settingsParams = await buildDeepSeekRequestParams({
    taskType: "chapter_generation",
    messages: prompt.messages,
    overrides: input.overrides,
    responseFormat: "text"
  });
  const model = String(settingsParams.profile.model);
  const useStream = settingsParams.profile.stream;
  const user = await getOrCreateLocalUser();
  const task = await prisma.generationTask.create({
    data: {
      userId: user.id,
      novelId: novel.id,
      chapterId: chapter.id,
      taskType: "chapter_generation",
      status: "running",
      model,
      requestPayload: {
        params: settingsParams.params,
        promptSnapshot: prompt.promptSnapshot,
        contextSnapshot: prompt.contextSnapshot
      }
    }
  });
  const promptLog = await createAiPromptLog({
    generationTaskId: task.id,
    novelId: novel.id,
    chapterId: chapter.id,
    taskType: "chapter_generation",
    model,
    baseUrlMode: "normal",
    messages: prompt.messages,
    contextSnapshot: prompt.contextSnapshot,
    requestParams: settingsParams.params
  });

  if (!useStream) {
    try {
      const result = await callDeepSeekText({
        taskType: "chapter_generation",
        messages: prompt.messages,
        overrides: input.overrides as DeepSeekOverrides
      });
      if (result.finishReason === "length") {
        throw new Error("输出被截断，请提高 max_tokens。");
      }
      await saveGeneratedChapter({
        chapterId: chapter.id,
        content: result.content,
        model,
        promptSnapshot: prompt.promptSnapshot,
        requestSnapshot: settingsParams.params,
        responseSnapshot: result.raw,
        taskId: task.id,
        finishReason: result.finishReason,
        usage: result.usage
      });
      await updateAiPromptLog(promptLog.id, {
        responsePreview: truncateForDisplay(result.content),
        finishReason: result.finishReason,
        usage: result.usage
      });
      return {
        stream: false,
        taskId: task.id,
        content: result.content,
        usage: result.usage,
        finishReason: result.finishReason
      };
    } catch (error) {
      await markTaskFailed(task.id, error);
      await updateAiPromptLog(promptLog.id, {
        errorMessage: error instanceof Error ? error.message : "生成失败"
      });
      throw error;
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      void (async () => {
        try {
          const result = await callDeepSeekTextStream({
            taskType: "chapter_generation",
            messages: prompt.messages,
            overrides: input.overrides as DeepSeekOverrides,
            onToken(token) {
              controller.enqueue(encoder.encode(sse("token", { token })));
            }
          });

          if (result.finishReason === "length") {
            throw new Error("输出被截断，请提高 max_tokens。");
          }

          await saveGeneratedChapter({
            chapterId: chapter.id,
            content: result.content,
            model,
            promptSnapshot: prompt.promptSnapshot,
            requestSnapshot: settingsParams.params,
            responseSnapshot: {
              contentPreview: truncateForDisplay(result.content),
              usage: result.usage,
              finishReason: result.finishReason
            },
            taskId: task.id,
            finishReason: result.finishReason,
            usage: result.usage
          });
          await updateAiPromptLog(promptLog.id, {
            responsePreview: truncateForDisplay(result.content),
            finishReason: result.finishReason,
            usage: result.usage
          });
          controller.enqueue(
            encoder.encode(
              sse("done", {
                taskId: task.id,
                usage: result.usage,
                finishReason: result.finishReason
              })
            )
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "生成失败";
          await markTaskFailed(task.id, error);
          await updateAiPromptLog(promptLog.id, { errorMessage: message });
          await logError({
            scope: "chapter_generation",
            message,
            error,
            novelId: novel.id,
            chapterId: chapter.id,
            generationTaskId: task.id
          });
          controller.enqueue(encoder.encode(sse("error", { error: message, taskId: task.id })));
        } finally {
          controller.close();
        }
      })();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}

async function saveGeneratedChapter(input: {
  chapterId: string;
  content: string;
  model: string;
  promptSnapshot: string;
  requestSnapshot: unknown;
  responseSnapshot: unknown;
  taskId: string;
  finishReason?: string | null;
  usage?: ReturnType<typeof usageToTaskUpdate> extends infer _T ? never : never;
}) {
  const usage = input.usage as unknown as Parameters<typeof usageToTaskUpdate>[0];
  await prisma.$transaction([
    prisma.chapter.update({
      where: { id: input.chapterId },
      data: {
        content: input.content,
        wordCount: countChineseWords(input.content),
        status: "draft"
      }
    }),
    prisma.chapterVersion.create({
      data: {
        chapterId: input.chapterId,
        content: input.content,
        source: "ai_generate",
        model: input.model,
        promptSnapshot: input.promptSnapshot,
        requestSnapshot: input.requestSnapshot as object,
        responseSnapshot: input.responseSnapshot as object
      }
    }),
    prisma.generationTask.update({
      where: { id: input.taskId },
      data: {
        status: "success",
        responsePayload: input.responseSnapshot as object,
        finishReason: input.finishReason,
        ...usageToTaskUpdate(usage)
      }
    })
  ]);
}

async function markTaskFailed(taskId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "任务失败";
  await prisma.generationTask.update({
    where: { id: taskId },
    data: {
      status: "failed",
      errorMessage: message
    }
  });
}

async function createTaskForChapter(
  taskType: DeepSeekTaskType,
  chapterId: string,
  requestPayload: unknown,
  model: string
) {
  const { chapter, novel } = await requireChapter(chapterId);
  const user = await getOrCreateLocalUser();
  const task = await prisma.generationTask.create({
    data: {
      userId: user.id,
      novelId: novel.id,
      chapterId: chapter.id,
      taskType,
      status: "running",
      model,
      requestPayload: requestPayload as object
    }
  });
  return { task, chapter, novel };
}

export async function summarizeChapter(chapterId: string) {
  const { chapter, novel } = await requireChapter(chapterId);
  if (!chapter.content?.trim()) {
    throw new Error("章节正文为空，无法生成摘要。");
  }

  const prompt = buildChapterSummaryPrompt(chapter.content);
  const params = await buildDeepSeekRequestParams({
    taskType: "chapter_summary",
    messages: prompt.messages,
    responseFormat: "json_object"
  });
  const { task } = await createTaskForChapter(
    "chapter_summary",
    chapter.id,
    {
      params: params.params,
      promptSnapshot: prompt.promptSnapshot
    },
    String(params.profile.model)
  );
  const promptLog = await createAiPromptLog({
    generationTaskId: task.id,
    novelId: novel.id,
    chapterId: chapter.id,
    taskType: "chapter_summary",
    model: String(params.profile.model),
    baseUrlMode: "normal",
    messages: prompt.messages,
    contextSnapshot: prompt.contextSnapshot,
    requestParams: params.params
  });

  try {
    const result = await callDeepSeekJson({
      taskType: "chapter_summary",
      messages: prompt.messages
    });
    if (result.finishReason === "length") {
      throw new Error("输出被截断，请提高 max_tokens。");
    }
    const parsed = safeJsonParse<unknown>(result.content);
    if (!parsed.ok) {
      throw new Error(`模型返回的 JSON 无法解析：${parsed.error}。原始返回：${truncateForDisplay(result.content)}`);
    }
    const summary = summaryOutputSchema.parse(parsed.data);
    await prisma.$transaction([
      prisma.chapter.update({
        where: { id: chapter.id },
        data: {
          summaryShort: summary.short_summary,
          summaryLong: summary.long_summary
        }
      }),
      ...summary.key_events.map((event, index) =>
        prisma.timelineEvent.create({
          data: {
            novelId: novel.id,
            chapterId: chapter.id,
            eventOrder: index + 1,
            title: event.title,
            description: event.description,
            importance: event.importance
          }
        })
      ),
      prisma.generationTask.update({
        where: { id: task.id },
        data: {
          status: "success",
          responsePayload: summary,
          finishReason: result.finishReason,
          ...usageToTaskUpdate(result.usage)
        }
      })
    ]);
    await updateAiPromptLog(promptLog.id, {
      responsePreview: truncateForDisplay(result.content),
      finishReason: result.finishReason,
      usage: result.usage
    });
    return { taskId: task.id, summary };
  } catch (error) {
    await markTaskFailed(task.id, error);
    await updateAiPromptLog(promptLog.id, {
      errorMessage: error instanceof Error ? error.message : "摘要生成失败"
    });
    throw error;
  }
}

async function loadWholeKnowledge(novelId: string) {
  const [
    entries,
    characters,
    locations,
    factions,
    relationships,
    foreshadowings,
    items,
    timelineEvents
  ] = await Promise.all([
    prisma.knowledgeEntry.findMany({ where: { novelId }, orderBy: { priority: "asc" } }),
    prisma.character.findMany({ where: { novelId } }),
    prisma.location.findMany({ where: { novelId } }),
    prisma.faction.findMany({ where: { novelId } }),
    prisma.characterRelationship.findMany({ where: { novelId } }),
    prisma.foreshadowing.findMany({ where: { novelId } }),
    prisma.item.findMany({ where: { novelId } }),
    prisma.timelineEvent.findMany({ where: { novelId }, orderBy: { createdAt: "desc" } })
  ]);
  return {
    entries,
    characters,
    locations,
    factions,
    relationships,
    foreshadowings,
    items,
    timelineEvents
  };
}

export async function checkConsistency(chapterId: string) {
  const { chapter, novel } = await requireChapter(chapterId);
  if (!chapter.content?.trim()) {
    throw new Error("章节正文为空，无法进行一致性检查。");
  }
  const knowledge = await loadWholeKnowledge(novel.id);
  const knowledgeContext = buildKnowledgeContext(knowledge);
  const prompt = buildConsistencyCheckPrompt({
    chapterContent: chapter.content,
    knowledgeContext
  });
  const params = await buildDeepSeekRequestParams({
    taskType: "consistency_check",
    messages: prompt.messages,
    responseFormat: "json_object"
  });
  const { task } = await createTaskForChapter(
    "consistency_check",
    chapter.id,
    {
      params: params.params,
      promptSnapshot: prompt.promptSnapshot,
      contextSnapshot: prompt.contextSnapshot
    },
    String(params.profile.model)
  );
  const promptLog = await createAiPromptLog({
    generationTaskId: task.id,
    novelId: novel.id,
    chapterId: chapter.id,
    taskType: "consistency_check",
    model: String(params.profile.model),
    baseUrlMode: "normal",
    messages: prompt.messages,
    contextSnapshot: prompt.contextSnapshot,
    requestParams: params.params
  });

  try {
    const result = await callDeepSeekJson({
      taskType: "consistency_check",
      messages: prompt.messages
    });
    if (result.finishReason === "length") {
      throw new Error("输出被截断，请提高 max_tokens。");
    }
    const parsed = safeJsonParse<unknown>(result.content);
    if (!parsed.ok) {
      throw new Error(`模型返回的 JSON 无法解析：${parsed.error}。原始返回：${truncateForDisplay(result.content)}`);
    }
    const checked = consistencyOutputSchema.parse(parsed.data);
    await prisma.generationTask.update({
      where: { id: task.id },
      data: {
        status: "success",
        responsePayload: checked,
        finishReason: result.finishReason,
        ...usageToTaskUpdate(result.usage)
      }
    });
    await updateAiPromptLog(promptLog.id, {
      responsePreview: truncateForDisplay(result.content),
      finishReason: result.finishReason,
      usage: result.usage
    });
    return { taskId: task.id, ...checked };
  } catch (error) {
    await markTaskFailed(task.id, error);
    await updateAiPromptLog(promptLog.id, {
      errorMessage: error instanceof Error ? error.message : "一致性检查失败"
    });
    throw error;
  }
}

const toolArgumentSchemas = {
  propose_character_updates: z.object({ updates: z.array(z.unknown()) }),
  propose_location_updates: z.object({ updates: z.array(z.unknown()) }),
  propose_faction_updates: z.object({ updates: z.array(z.unknown()) }),
  propose_relationship_updates: z.object({ updates: z.array(z.unknown()) }),
  propose_foreshadowing_updates: z.object({ updates: z.array(z.unknown()) }),
  propose_item_updates: z.object({ updates: z.array(z.unknown()) }),
  propose_timeline_events: z.object({ events: z.array(z.unknown()) })
};

export async function extractKnowledge(chapterId: string) {
  const { chapter, novel } = await requireChapter(chapterId);
  if (!chapter.content?.trim()) {
    throw new Error("章节正文为空，无法抽取知识库更新建议。");
  }
  const knowledge = await loadWholeKnowledge(novel.id);
  const prompt = buildKnowledgeExtractionPrompt({
    ...knowledge,
    chapterSummary: chapter.summaryLong || chapter.summaryShort || chapter.outline || "",
    chapterContent: chapter.content
  });
  const params = await buildDeepSeekRequestParams({
    taskType: "knowledge_extraction",
    messages: prompt.messages,
    responseFormat: "text",
    tools: KNOWLEDGE_EXTRACTION_TOOLS,
    toolChoice: "required"
  });
  const { task } = await createTaskForChapter(
    "knowledge_extraction",
    chapter.id,
    {
      params: params.params,
      promptSnapshot: prompt.promptSnapshot,
      contextSnapshot: prompt.contextSnapshot
    },
    String(params.profile.model)
  );
  const promptLog = await createAiPromptLog({
    generationTaskId: task.id,
    novelId: novel.id,
    chapterId: chapter.id,
    taskType: "knowledge_extraction",
    model: String(params.profile.model),
    baseUrlMode: "beta",
    messages: prompt.messages,
    contextSnapshot: prompt.contextSnapshot,
    tools: KNOWLEDGE_EXTRACTION_TOOLS,
    toolChoice: "required",
    requestParams: params.params
  });

  try {
    const result = await callDeepSeekStrictTools({
      taskType: "knowledge_extraction",
      messages: prompt.messages,
      tools: KNOWLEDGE_EXTRACTION_TOOLS,
      toolChoice: "required"
    });
    if (result.finishReason === "length") {
      throw new Error("输出被截断，请提高 max_tokens。");
    }
    if (!result.toolCalls.length) {
      throw new Error("模型没有返回工具调用，请降低 temperature 或重试。");
    }

    const proposals = [];
    for (const call of result.toolCalls) {
      const parsed = safeJsonParse<unknown>(call.arguments);
      if (!parsed.ok) {
        throw new Error(`工具 ${call.name} 参数 JSON 无法解析：${parsed.error}`);
      }
      const schema = toolArgumentSchemas[call.name as keyof typeof toolArgumentSchemas];
      if (!schema) {
        throw new Error(`未知工具调用：${call.name}`);
      }
      const args = schema.parse(parsed.data);
      proposals.push(
        ...(await convertToolCallToProposals({
          novelId: novel.id,
          chapterId: chapter.id,
          taskId: task.id,
          toolName: call.name,
          args
        }))
      );
    }

    await prisma.generationTask.update({
      where: { id: task.id },
      data: {
        status: "success",
        responsePayload: { toolCalls: result.toolCalls },
        finishReason: result.finishReason,
        ...usageToTaskUpdate(result.usage)
      }
    });
    await updateAiPromptLog(promptLog.id, {
      responsePreview: truncateForDisplay(JSON.stringify(result.toolCalls)),
      finishReason: result.finishReason,
      usage: result.usage
    });
    return { taskId: task.id, proposals };
  } catch (error) {
    await markTaskFailed(task.id, error);
    await updateAiPromptLog(promptLog.id, {
      errorMessage: error instanceof Error ? error.message : "知识抽取失败"
    });
    throw error;
  }
}

async function snapshotEntity(targetTable: string, targetId: string | undefined | null) {
  if (!targetId) return null;
  const map: Record<string, keyof PrismaClient> = {
    Character: "character",
    Location: "location",
    Faction: "faction",
    CharacterRelationship: "characterRelationship",
    Foreshadowing: "foreshadowing",
    Item: "item",
    TimelineEvent: "timelineEvent"
  };
  const modelName = map[targetTable];
  if (!modelName) return null;
  return delegate(modelName).findUnique({ where: { id: targetId } });
}

async function createProposal(input: {
  novelId: string;
  chapterId: string;
  taskId: string;
  proposalType: string;
  action: string;
  targetTable: string;
  targetId?: string;
  title?: string;
  afterData: unknown;
  reason?: string;
  confidence?: number;
}) {
  const beforeData = await snapshotEntity(input.targetTable, input.targetId);
  return prisma.knowledgeUpdateProposal.create({
    data: {
      novelId: input.novelId,
      chapterId: input.chapterId,
      generationTaskId: input.taskId,
      proposalType: input.proposalType,
      action: input.action,
      targetTable: input.targetTable,
      targetId: input.targetId || null,
      title: input.title,
      beforeData: beforeData as object,
      afterData: input.afterData as object,
      reason: input.reason,
      confidence: input.confidence,
      status: "pending"
    }
  });
}

async function convertToolCallToProposals(input: {
  novelId: string;
  chapterId: string;
  taskId: string;
  toolName: string;
  args: { updates?: unknown[]; events?: unknown[] };
}) {
  const created = [];
  if (input.toolName === "propose_timeline_events") {
    for (const raw of input.args.events ?? []) {
      const item = asRecord(raw);
      created.push(
        await createProposal({
          novelId: input.novelId,
          chapterId: input.chapterId,
          taskId: input.taskId,
          proposalType: "timeline",
          action: "create",
          targetTable: "TimelineEvent",
          title: String(item.title ?? ""),
          afterData: { toolName: input.toolName, ...item },
          reason: String(item.reason ?? ""),
          confidence: typeof item.confidence === "number" ? item.confidence : undefined
        })
      );
    }
    return created;
  }

  const mapping: Record<
    string,
    {
      proposalType: string;
      targetTable: string;
      titleKey: string;
      targetKey: string;
      relationship?: boolean;
    }
  > = {
    propose_character_updates: {
      proposalType: "character",
      targetTable: "Character",
      titleKey: "character_name",
      targetKey: "target_character_id"
    },
    propose_location_updates: {
      proposalType: "location",
      targetTable: "Location",
      titleKey: "location_name",
      targetKey: "target_location_id"
    },
    propose_faction_updates: {
      proposalType: "faction",
      targetTable: "Faction",
      titleKey: "faction_name",
      targetKey: "target_faction_id"
    },
    propose_relationship_updates: {
      proposalType: "relationship",
      targetTable: "CharacterRelationship",
      titleKey: "character_a_name",
      targetKey: "target_relationship_id",
      relationship: true
    },
    propose_foreshadowing_updates: {
      proposalType: "foreshadowing",
      targetTable: "Foreshadowing",
      titleKey: "foreshadowing_title",
      targetKey: "target_foreshadowing_id"
    },
    propose_item_updates: {
      proposalType: "item",
      targetTable: "Item",
      titleKey: "item_name",
      targetKey: "target_item_id"
    }
  };

  const config = mapping[input.toolName];
  if (!config) return created;

  for (const raw of input.args.updates ?? []) {
    const item = asRecord(raw);
    const title = config.relationship
      ? `${String(item.character_a_name ?? "")} - ${String(item.character_b_name ?? "")}`
      : String(item[config.titleKey] ?? "");
    created.push(
      await createProposal({
        novelId: input.novelId,
        chapterId: input.chapterId,
        taskId: input.taskId,
        proposalType: config.proposalType,
        action: String(item.action ?? "noop"),
        targetTable: config.targetTable,
        targetId: String(item[config.targetKey] ?? "") || undefined,
        title,
        afterData: { toolName: input.toolName, ...item },
        reason: String(item.reason ?? ""),
        confidence: typeof item.confidence === "number" ? item.confidence : undefined
      })
    );
  }

  return created;
}

export async function listProposals(novelId: string, searchParams: URLSearchParams) {
  await requireNovel(novelId);
  const status = searchParams.get("status") || undefined;
  const proposalType = searchParams.get("proposalType") || undefined;
  const chapterId = searchParams.get("chapterId") || undefined;
  return prisma.knowledgeUpdateProposal.findMany({
    where: {
      novelId,
      ...(status ? { status } : {}),
      ...(proposalType ? { proposalType } : {}),
      ...(chapterId ? { chapterId } : {})
    },
    orderBy: { createdAt: "desc" }
  });
}

export async function listCurrentChapterProposals(chapterId: string) {
  const { chapter } = await requireChapter(chapterId);
  return prisma.knowledgeUpdateProposal.findMany({
    where: { novelId: chapter.novelId, chapterId, status: "pending" },
    orderBy: { createdAt: "desc" }
  });
}

async function findByName(delegateName: keyof PrismaClient, novelId: string, name: string) {
  if (!name.trim()) return null;
  return delegate(delegateName).findFirst({
    where: { novelId, name: name.trim() }
  });
}

async function acceptProposalCore(proposalId: string, statusAfterAccept: "accepted" | "edited") {
  const proposal = await prisma.knowledgeUpdateProposal.findUnique({
    where: { id: proposalId }
  });
  if (!proposal) throw new Error("更新建议不存在。");
  await requireNovel(proposal.novelId);
  if (proposal.status !== "pending") {
    throw new Error("只有 pending 状态的建议可以审核。");
  }
  const afterData = asRecord(proposal.afterData ?? {});
  const fields = asRecord(afterData.fields ?? {});

  if (proposal.action === "noop") {
    return prisma.knowledgeUpdateProposal.update({
      where: { id: proposal.id },
      data: { status: statusAfterAccept, reviewedAt: new Date() }
    });
  }

  let targetId = proposal.targetId ?? undefined;
  if (proposal.action === "update" && !targetId) {
    throw new Error("update 操作必须有 targetId，无法接受该建议。");
  }

  if (proposal.proposalType === "character") {
    targetId = await applyCharacterProposal(proposal.novelId, targetId, proposal.action, afterData, fields);
    if (proposal.action === "update") {
      await maybeCreateCharacterHistory(targetId, proposal.chapterId, fields);
    }
  } else if (proposal.proposalType === "location") {
    targetId = await applyLocationProposal(proposal.novelId, targetId, proposal.action, afterData, fields);
  } else if (proposal.proposalType === "faction") {
    targetId = await applyFactionProposal(proposal.novelId, targetId, proposal.action, afterData, fields);
  } else if (proposal.proposalType === "relationship") {
    targetId = await applyRelationshipProposal(proposal.novelId, targetId, proposal.action, afterData, fields);
    if (proposal.action === "update") {
      await maybeCreateRelationshipHistory(targetId, proposal.chapterId, fields, proposal.reason);
    }
  } else if (proposal.proposalType === "foreshadowing") {
    targetId = await applyForeshadowingProposal(proposal.novelId, targetId, proposal.action, afterData, fields);
  } else if (proposal.proposalType === "item") {
    targetId = await applyItemProposal(proposal.novelId, targetId, proposal.action, afterData, fields);
  } else if (proposal.proposalType === "timeline") {
    targetId = await applyTimelineProposal(proposal.novelId, proposal.chapterId, afterData);
  } else {
    throw new Error(`未知建议类型：${proposal.proposalType}`);
  }

  return prisma.knowledgeUpdateProposal.update({
    where: { id: proposal.id },
    data: {
      status: statusAfterAccept,
      targetId,
      reviewedAt: new Date()
    }
  });
}

async function applyCharacterProposal(
  novelId: string,
  targetId: string | undefined,
  action: string,
  afterData: Record<string, unknown>,
  fields: Record<string, unknown>
) {
  const faction = await findByName("faction", novelId, String(fields.faction_name ?? ""));
  const location = await findByName("location", novelId, String(fields.current_location_name ?? ""));
  const data = pickNonEmpty({
    name: afterData.character_name,
    alias: fields.alias,
    gender: fields.gender,
    age: fields.age,
    identity: fields.identity,
    personality: fields.personality,
    appearance: fields.appearance,
    motivation: fields.motivation,
    secret: fields.secret,
    factionId: faction ? String(asRecord(faction).id) : undefined,
    currentLocationId: location ? String(asRecord(location).id) : undefined,
    realmLevel: fields.realm_level,
    ability: fields.ability,
    status: fields.status
  });
  if (action === "create") {
    const created = await prisma.character.create({
      data: { ...data, novelId, name: String(data.name || "未命名角色") }
    });
    return created.id;
  }
  await prisma.character.update({ where: { id: targetId }, data });
  return targetId;
}

async function applyLocationProposal(
  novelId: string,
  targetId: string | undefined,
  action: string,
  afterData: Record<string, unknown>,
  fields: Record<string, unknown>
) {
  const parent = await findByName("location", novelId, String(fields.parent_location_name ?? ""));
  const data = pickNonEmpty({
    name: afterData.location_name,
    type: fields.type || "custom",
    parentId: parent ? String(asRecord(parent).id) : undefined,
    description: fields.description,
    climate: fields.climate,
    culture: fields.culture,
    dangerLevel: fields.danger_level,
    currentStatus: fields.current_status
  });
  if (action === "create") {
    const created = await prisma.location.create({
      data: { ...data, novelId, name: String(data.name || "未命名地点"), type: String(data.type || "custom") }
    });
    return created.id;
  }
  await prisma.location.update({ where: { id: targetId }, data });
  return targetId;
}

async function applyFactionProposal(
  novelId: string,
  targetId: string | undefined,
  action: string,
  afterData: Record<string, unknown>,
  fields: Record<string, unknown>
) {
  const leader = await findByName("character", novelId, String(fields.leader_character_name ?? ""));
  const territory = await findByName("location", novelId, String(fields.territory_location_name ?? ""));
  const data = pickNonEmpty({
    name: afterData.faction_name,
    type: fields.type || "custom",
    description: fields.description,
    leaderCharacterId: leader ? String(asRecord(leader).id) : undefined,
    territoryLocationId: territory ? String(asRecord(territory).id) : undefined,
    ideology: fields.ideology,
    strengthLevel: fields.strength_level,
    currentStatus: fields.current_status
  });
  if (action === "create") {
    const created = await prisma.faction.create({
      data: { ...data, novelId, name: String(data.name || "未命名势力"), type: String(data.type || "custom") }
    });
    return created.id;
  }
  await prisma.faction.update({ where: { id: targetId }, data });
  return targetId;
}

async function applyRelationshipProposal(
  novelId: string,
  targetId: string | undefined,
  action: string,
  afterData: Record<string, unknown>,
  fields: Record<string, unknown>
) {
  const characterA = await findByName("character", novelId, String(afterData.character_a_name ?? ""));
  const characterB = await findByName("character", novelId, String(afterData.character_b_name ?? ""));
  const data = pickNonEmpty({
    characterAId: characterA ? String(asRecord(characterA).id) : undefined,
    characterBId: characterB ? String(asRecord(characterB).id) : undefined,
    relationshipType: fields.relationship_type || "custom",
    relationshipStrength:
      typeof fields.relationship_strength === "number" ? fields.relationship_strength : undefined,
    description: fields.description,
    currentStatus: fields.current_status || fields.after_status
  });
  if (action === "create") {
    if (!data.characterAId || !data.characterBId) {
      throw new Error("创建人物关系时必须能匹配到两个角色。");
    }
    const created = await prisma.characterRelationship.create({
      data: {
        ...data,
        novelId,
        characterAId: String(data.characterAId),
        characterBId: String(data.characterBId),
        relationshipType: String(data.relationshipType || "custom")
      }
    });
    return created.id;
  }
  await prisma.characterRelationship.update({ where: { id: targetId }, data });
  return targetId;
}

async function applyForeshadowingProposal(
  novelId: string,
  targetId: string | undefined,
  action: string,
  afterData: Record<string, unknown>,
  fields: Record<string, unknown>
) {
  const data = pickNonEmpty({
    title: afterData.foreshadowing_title,
    description: fields.description,
    status: fields.status,
    importance: fields.importance
  });
  if (action === "create") {
    const created = await prisma.foreshadowing.create({
      data: {
        ...data,
        novelId,
        title: String(data.title || "未命名伏笔"),
        description: String(data.description || "待补充")
      }
    });
    return created.id;
  }
  await prisma.foreshadowing.update({ where: { id: targetId }, data });
  return targetId;
}

async function applyItemProposal(
  novelId: string,
  targetId: string | undefined,
  action: string,
  afterData: Record<string, unknown>,
  fields: Record<string, unknown>
) {
  const owner = await findByName("character", novelId, String(fields.owner_character_name ?? ""));
  const location = await findByName("location", novelId, String(fields.current_location_name ?? ""));
  const data = pickNonEmpty({
    name: afterData.item_name,
    type: fields.type,
    description: fields.description,
    ownerCharacterId: owner ? String(asRecord(owner).id) : undefined,
    currentLocationId: location ? String(asRecord(location).id) : undefined,
    ability: fields.ability,
    currentStatus: fields.current_status
  });
  if (action === "create") {
    const created = await prisma.item.create({
      data: { ...data, novelId, name: String(data.name || "未命名道具") }
    });
    return created.id;
  }
  await prisma.item.update({ where: { id: targetId }, data });
  return targetId;
}

async function applyTimelineProposal(
  novelId: string,
  chapterId: string | null,
  afterData: Record<string, unknown>
) {
  const created = await prisma.timelineEvent.create({
    data: {
      novelId,
      chapterId,
      title: String(afterData.title || "未命名事件"),
      description: String(afterData.description || ""),
      eventTimeText: String(afterData.event_time_text || ""),
      importance: String(afterData.importance || "normal")
    }
  });
  return created.id;
}

async function maybeCreateCharacterHistory(
  characterId: string | undefined,
  chapterId: string | null,
  fields: Record<string, unknown>
) {
  if (!characterId) return;
  const hasHistory =
    nonEmpty(fields.realm_level) ||
    nonEmpty(fields.current_location_name) ||
    nonEmpty(fields.physical_status) ||
    nonEmpty(fields.mental_status) ||
    nonEmpty(fields.important_action) ||
    nonEmpty(fields.change_summary);
  if (!hasHistory) return;
  const locationName = String(fields.current_location_name ?? "");
  const character = await prisma.character.findUnique({ where: { id: characterId } });
  const location =
    character && locationName
      ? await findByName("location", character.novelId, locationName)
      : null;
  await prisma.characterStateHistory.create({
    data: {
      characterId,
      chapterId,
      locationId: location ? String(asRecord(location).id) : undefined,
      realmLevel: String(fields.realm_level || ""),
      physicalStatus: String(fields.physical_status || ""),
      mentalStatus: String(fields.mental_status || ""),
      importantAction: String(fields.important_action || ""),
      changeSummary: String(fields.change_summary || "")
    }
  });
}

async function maybeCreateRelationshipHistory(
  relationshipId: string | undefined,
  chapterId: string | null,
  fields: Record<string, unknown>,
  reason?: string | null
) {
  if (!relationshipId) return;
  if (!nonEmpty(fields.before_status) && !nonEmpty(fields.after_status) && !nonEmpty(reason)) {
    return;
  }
  await prisma.relationshipHistory.create({
    data: {
      relationshipId,
      chapterId,
      beforeStatus: String(fields.before_status || ""),
      afterStatus: String(fields.after_status || ""),
      reason: String(reason || "")
    }
  });
}

export async function acceptProposal(proposalId: string) {
  return acceptProposalCore(proposalId, "accepted");
}

export async function rejectProposal(proposalId: string) {
  const proposal = await prisma.knowledgeUpdateProposal.findUnique({
    where: { id: proposalId }
  });
  if (!proposal) throw new Error("更新建议不存在。");
  await requireNovel(proposal.novelId);
  if (proposal.status !== "pending") {
    throw new Error("只有 pending 状态的建议可以拒绝。");
  }
  return prisma.knowledgeUpdateProposal.update({
    where: { id: proposalId },
    data: { status: "rejected", reviewedAt: new Date() }
  });
}

export async function editAndAcceptProposal(proposalId: string, body: unknown) {
  const input = editProposalSchema.parse(body);
  const proposal = await prisma.knowledgeUpdateProposal.findUnique({
    where: { id: proposalId }
  });
  if (!proposal) throw new Error("更新建议不存在。");
  await requireNovel(proposal.novelId);
  if (proposal.status !== "pending") {
    throw new Error("只有 pending 状态的建议可以编辑后接受。");
  }
  await prisma.knowledgeUpdateProposal.update({
    where: { id: proposalId },
    data: { afterData: input.afterData as object }
  });
  return acceptProposalCore(proposalId, "edited");
}

export async function getGenerationTask(taskId: string) {
  const task = await prisma.generationTask.findUnique({ where: { id: taskId } });
  if (!task) throw new Error("生成任务不存在。");
  await requireNovel(task.novelId);
  return task;
}

export async function listLogs(searchParams: URLSearchParams) {
  const level = searchParams.get("level") || undefined;
  const scope = searchParams.get("scope") || undefined;
  const novelId = searchParams.get("novelId") || undefined;
  const chapterId = searchParams.get("chapterId") || undefined;
  return prisma.appLog.findMany({
    where: {
      ...(level ? { level } : {}),
      ...(scope ? { scope } : {}),
      ...(novelId ? { novelId } : {}),
      ...(chapterId ? { chapterId } : {})
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });
}

export async function listAiPromptLogs(searchParams: URLSearchParams) {
  const taskType = searchParams.get("taskType") || undefined;
  const novelId = searchParams.get("novelId") || undefined;
  const chapterId = searchParams.get("chapterId") || undefined;
  return prisma.aiPromptLog.findMany({
    where: {
      ...(taskType ? { taskType } : {}),
      ...(novelId ? { novelId } : {}),
      ...(chapterId ? { chapterId } : {})
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });
}

export async function writeFrontendLog(body: unknown) {
  const input = frontendLogSchema.parse(body);
  await writeAppLog({
    level: input.level,
    scope: input.scope,
    message: input.message,
    details: input.details,
    error: input.stack ? new Error(input.stack) : undefined
  });
  return { saved: true };
}

export async function listChapterPromptLogs(chapterId: string) {
  const { chapter } = await requireChapter(chapterId);
  return prisma.aiPromptLog.findMany({
    where: { novelId: chapter.novelId, chapterId },
    orderBy: { createdAt: "desc" }
  });
}
