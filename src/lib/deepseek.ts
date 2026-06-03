import OpenAI from "openai";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { getOrCreateLocalUser } from "@/lib/local-user";
import type { PromptMessage } from "@/lib/prompt-builder";
import { sanitizeForLog } from "@/lib/logging";

export type DeepSeekTaskType =
  | "chapter_generation"
  | "chapter_summary"
  | "knowledge_extraction"
  | "consistency_check";

export type DeepSeekOverrides = Partial<{
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
}>;

type ResponseFormat = "text" | "json_object";

type RequestBuildInput = {
  taskType: DeepSeekTaskType;
  messages: PromptMessage[];
  overrides?: DeepSeekOverrides;
  responseFormat?: ResponseFormat;
  tools?: unknown[];
  toolChoice?: unknown;
};

type UsageLike = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
};

export type DeepSeekUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
  reasoningTokens?: number;
  raw?: unknown;
};

export type DeepSeekResult = {
  content: string;
  finishReason?: string | null;
  usage?: DeepSeekUsage;
  raw?: unknown;
};

export type DeepSeekToolResult = {
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  finishReason?: string | null;
  usage?: DeepSeekUsage;
  raw?: unknown;
};

const DEFAULT_PROFILES: Record<DeepSeekTaskType, Omit<DeepSeekOverrides, "stopSequences"> & { stopSequences: string[] }> = {
  chapter_generation: {
    model: "deepseek-v4-pro",
    thinkingEnabled: true,
    reasoningEffort: "high",
    temperature: 0.75,
    topP: 1,
    maxTokens: 8000,
    stream: true,
    streamIncludeUsage: true,
    stopSequences: [],
    logprobs: false,
    topLogprobs: 0
  },
  chapter_summary: {
    model: "deepseek-v4-flash",
    thinkingEnabled: false,
    reasoningEffort: "high",
    temperature: 0.1,
    topP: 1,
    maxTokens: 2000,
    stream: false,
    streamIncludeUsage: false,
    stopSequences: [],
    logprobs: false,
    topLogprobs: 0
  },
  knowledge_extraction: {
    model: "deepseek-v4-pro",
    thinkingEnabled: true,
    reasoningEffort: "high",
    temperature: 0.1,
    topP: 1,
    maxTokens: 6000,
    stream: false,
    streamIncludeUsage: false,
    stopSequences: [],
    logprobs: false,
    topLogprobs: 0
  },
  consistency_check: {
    model: "deepseek-v4-pro",
    thinkingEnabled: true,
    reasoningEffort: "high",
    temperature: 0.2,
    topP: 1,
    maxTokens: 3000,
    stream: false,
    streamIncludeUsage: false,
    stopSequences: [],
    logprobs: false,
    topLogprobs: 0
  }
};

export async function getDeepSeekSettings() {
  const user = await getOrCreateLocalUser();
  let settings = await prisma.deepSeekSettings.findUnique({
    where: { userId: user.id },
    include: { profiles: true }
  });

  if (!settings) {
    settings = await prisma.deepSeekSettings.create({
      data: {
        userId: user.id,
        baseUrl: "https://api.deepseek.com",
        betaBaseUrl: "https://api.deepseek.com/beta",
        profiles: {
          create: Object.entries(DEFAULT_PROFILES).map(([taskType, profile]) => ({
            taskType,
            model: profile.model ?? "deepseek-v4-pro",
            thinkingEnabled: profile.thinkingEnabled ?? true,
            reasoningEffort: profile.reasoningEffort ?? "high",
            temperature: profile.temperature ?? 0.2,
            topP: profile.topP ?? 1,
            maxTokens: profile.maxTokens ?? 3000,
            stream: profile.stream ?? false,
            streamIncludeUsage: profile.streamIncludeUsage ?? false,
            stopSequences: profile.stopSequences,
            logprobs: profile.logprobs ?? false,
            topLogprobs: profile.topLogprobs ?? 0
          }))
        }
      },
      include: { profiles: true }
    });
  }

  const missingProfiles = Object.keys(DEFAULT_PROFILES).filter(
    (taskType) => !settings.profiles.some((profile) => profile.taskType === taskType)
  ) as DeepSeekTaskType[];

  for (const taskType of missingProfiles) {
    const profile = DEFAULT_PROFILES[taskType];
    await prisma.deepSeekTaskProfile.create({
      data: {
        settingsId: settings.id,
        taskType,
        model: profile.model ?? "deepseek-v4-pro",
        thinkingEnabled: profile.thinkingEnabled ?? true,
        reasoningEffort: profile.reasoningEffort ?? "high",
        temperature: profile.temperature ?? 0.2,
        topP: profile.topP ?? 1,
        maxTokens: profile.maxTokens ?? 3000,
        stream: profile.stream ?? false,
        streamIncludeUsage: profile.streamIncludeUsage ?? false,
        stopSequences: profile.stopSequences,
        logprobs: profile.logprobs ?? false,
        topLogprobs: profile.topLogprobs ?? 0
      }
    });
  }

  if (missingProfiles.length) {
    settings = await prisma.deepSeekSettings.findUniqueOrThrow({
      where: { userId: user.id },
      include: { profiles: true }
    });
  }

  return settings;
}

export async function getDeepSeekClient(mode: "normal" | "beta") {
  const settings = await getDeepSeekSettings();
  if (!settings.apiKeyEncrypted) {
    throw new Error("DeepSeek API Key 未配置，请先进入设置页配置。");
  }

  const apiKey = decryptSecret(settings.apiKeyEncrypted);
  return new OpenAI({
    apiKey,
    baseURL: mode === "beta" ? settings.betaBaseUrl : settings.baseUrl
  });
}

function normalizeStopSequences(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function pickProfile(
  taskType: DeepSeekTaskType,
  settings: Awaited<ReturnType<typeof getDeepSeekSettings>>,
  overrides?: DeepSeekOverrides
) {
  const profile = settings.profiles.find((item) => item.taskType === taskType);
  const defaults = DEFAULT_PROFILES[taskType];
  return {
    model: overrides?.model ?? profile?.model ?? defaults.model,
    thinkingEnabled:
      overrides?.thinkingEnabled ?? profile?.thinkingEnabled ?? defaults.thinkingEnabled,
    reasoningEffort:
      overrides?.reasoningEffort ?? profile?.reasoningEffort ?? defaults.reasoningEffort,
    temperature: overrides?.temperature ?? profile?.temperature ?? defaults.temperature,
    topP: overrides?.topP ?? profile?.topP ?? defaults.topP,
    maxTokens: overrides?.maxTokens ?? profile?.maxTokens ?? defaults.maxTokens,
    stream: overrides?.stream ?? profile?.stream ?? defaults.stream,
    streamIncludeUsage:
      overrides?.streamIncludeUsage ?? profile?.streamIncludeUsage ?? defaults.streamIncludeUsage,
    stopSequences:
      overrides?.stopSequences ??
      normalizeStopSequences(profile?.stopSequences) ??
      defaults.stopSequences,
    logprobs: overrides?.logprobs ?? profile?.logprobs ?? defaults.logprobs,
    topLogprobs: overrides?.topLogprobs ?? profile?.topLogprobs ?? defaults.topLogprobs
  };
}

export async function buildDeepSeekRequestParams(input: RequestBuildInput) {
  const settings = await getDeepSeekSettings();
  const profile = pickProfile(input.taskType, settings, input.overrides);
  const params: Record<string, unknown> = {
    model: profile.model,
    messages: input.messages,
    temperature: profile.temperature,
    top_p: profile.topP,
    max_tokens: profile.maxTokens,
    stream: profile.stream,
    response_format: { type: input.responseFormat ?? "text" },
    thinking: profile.thinkingEnabled
      ? { type: "enabled", reasoning_effort: profile.reasoningEffort }
      : { type: "disabled" },
    user_id: "local-user"
  };

  const stop = normalizeStopSequences(profile.stopSequences);
  if (stop.length) {
    params.stop = stop;
  }

  if (profile.stream && profile.streamIncludeUsage) {
    params.stream_options = { include_usage: true };
  }

  if (profile.logprobs) {
    params.logprobs = true;
    if (profile.topLogprobs > 0) {
      params.top_logprobs = profile.topLogprobs;
    }
  }

  if (input.tools) {
    params.tools = input.tools;
  }

  if (input.toolChoice) {
    params.tool_choice = input.toolChoice;
  }

  return { params, profile, settings };
}

export function extractUsage(usage: unknown): DeepSeekUsage | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const value = usage as UsageLike;
  return {
    promptTokens: value.prompt_tokens,
    completionTokens: value.completion_tokens,
    totalTokens: value.total_tokens,
    promptCacheHitTokens: value.prompt_cache_hit_tokens ?? value.prompt_tokens_details?.cached_tokens,
    promptCacheMissTokens: value.prompt_cache_miss_tokens,
    reasoningTokens: value.completion_tokens_details?.reasoning_tokens,
    raw: usage
  };
}

export function usageToTaskUpdate(usage?: DeepSeekUsage) {
  return {
    promptTokens: usage?.promptTokens,
    completionTokens: usage?.completionTokens,
    totalTokens: usage?.totalTokens,
    promptCacheHitTokens: usage?.promptCacheHitTokens,
    promptCacheMissTokens: usage?.promptCacheMissTokens,
    reasoningTokens: usage?.reasoningTokens
  };
}

export async function createAiPromptLog(input: {
  generationTaskId?: string;
  novelId?: string;
  chapterId?: string;
  taskType: DeepSeekTaskType;
  model: string;
  baseUrlMode: "normal" | "beta";
  messages: PromptMessage[];
  contextSnapshot?: unknown;
  tools?: unknown;
  toolChoice?: unknown;
  requestParams?: unknown;
}) {
  return prisma.aiPromptLog.create({
    data: {
      generationTaskId: input.generationTaskId,
      novelId: input.novelId,
      chapterId: input.chapterId,
      taskType: input.taskType,
      model: input.model,
      baseUrlMode: input.baseUrlMode,
      messages: sanitizeForLog(input.messages) as object,
      contextSnapshot: sanitizeForLog(input.contextSnapshot) as object,
      tools: sanitizeForLog(input.tools) as object,
      toolChoice: sanitizeForLog(input.toolChoice) as object,
      requestParams: sanitizeForLog(input.requestParams) as object
    }
  });
}

export async function updateAiPromptLog(
  id: string,
  input: {
    responsePreview?: string;
    finishReason?: string | null;
    usage?: DeepSeekUsage;
    errorMessage?: string;
  }
) {
  await prisma.aiPromptLog.update({
    where: { id },
    data: {
      responsePreview: input.responsePreview,
      finishReason: input.finishReason ?? undefined,
      usage: input.usage ? (sanitizeForLog(input.usage.raw ?? input.usage) as object) : undefined,
      errorMessage: input.errorMessage
    }
  });
}

export async function callDeepSeekText(input: {
  taskType: DeepSeekTaskType;
  messages: PromptMessage[];
  overrides?: DeepSeekOverrides;
}) {
  const { params } = await buildDeepSeekRequestParams({
    taskType: input.taskType,
    messages: input.messages,
    overrides: { ...input.overrides, stream: false },
    responseFormat: "text"
  });
  const client = await getDeepSeekClient("normal");
  const response = await client.chat.completions.create(
    params as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
  );
  const choice = response.choices[0];
  return {
    content: choice?.message?.content ?? "",
    finishReason: choice?.finish_reason,
    usage: extractUsage(response.usage),
    raw: response
  } satisfies DeepSeekResult;
}

export async function callDeepSeekTextStream(input: {
  taskType: DeepSeekTaskType;
  messages: PromptMessage[];
  overrides?: DeepSeekOverrides;
  onToken: (token: string) => Promise<void> | void;
  onUsage?: (usage: DeepSeekUsage) => Promise<void> | void;
}) {
  const { params } = await buildDeepSeekRequestParams({
    taskType: input.taskType,
    messages: input.messages,
    overrides: { ...input.overrides, stream: true },
    responseFormat: "text"
  });
  const client = await getDeepSeekClient("normal");
  const stream = await client.chat.completions.create(
    params as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
  );
  let content = "";
  let finishReason: string | null | undefined;
  let usage: DeepSeekUsage | undefined;

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    const token = choice?.delta?.content ?? "";
    if (token) {
      content += token;
      await input.onToken(token);
    }
    if (choice?.finish_reason) {
      finishReason = choice.finish_reason;
    }
    const chunkUsage = extractUsage((chunk as unknown as { usage?: unknown }).usage);
    if (chunkUsage) {
      usage = chunkUsage;
      await input.onUsage?.(chunkUsage);
    }
  }

  return { content, finishReason, usage } satisfies DeepSeekResult;
}

export async function callDeepSeekJson<T>(input: {
  taskType: DeepSeekTaskType;
  messages: PromptMessage[];
  overrides?: DeepSeekOverrides;
}) {
  const { params } = await buildDeepSeekRequestParams({
    taskType: input.taskType,
    messages: input.messages,
    overrides: { ...input.overrides, stream: false },
    responseFormat: "json_object"
  });
  const client = await getDeepSeekClient("normal");
  const response = await client.chat.completions.create(
    params as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
  );
  const choice = response.choices[0];
  return {
    content: choice?.message?.content ?? "",
    finishReason: choice?.finish_reason,
    usage: extractUsage(response.usage),
    raw: response
  } satisfies DeepSeekResult & { parsed?: T };
}

export async function callDeepSeekStrictTools(input: {
  taskType: "knowledge_extraction";
  messages: PromptMessage[];
  overrides?: DeepSeekOverrides;
  tools: unknown[];
  toolChoice?: unknown;
}) {
  const { params } = await buildDeepSeekRequestParams({
    taskType: input.taskType,
    messages: input.messages,
    overrides: { ...input.overrides, stream: false },
    responseFormat: "text",
    tools: input.tools,
    toolChoice: input.toolChoice ?? "required"
  });
  const client = await getDeepSeekClient("beta");
  const response = await client.chat.completions.create(
    params as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
  );
  const choice = response.choices[0];
  const toolCalls =
    choice?.message?.tool_calls?.map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments
    })) ?? [];

  return {
    toolCalls,
    finishReason: choice?.finish_reason,
    usage: extractUsage(response.usage),
    raw: response
  } satisfies DeepSeekToolResult;
}

function objectSchema(properties: Record<string, unknown>, required: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required
  };
}

function arraySchema(items: unknown) {
  return {
    type: "array",
    items
  };
}

const actionEnum = ["create", "update", "noop"];

export const KNOWLEDGE_EXTRACTION_TOOLS = [
  {
    type: "function",
    function: {
      name: "propose_character_updates",
      description: "提出角色新增或更新建议。",
      strict: true,
      parameters: objectSchema(
        {
          updates: arraySchema(
            objectSchema(
              {
                action: { type: "string", enum: actionEnum },
                character_name: { type: "string" },
                target_character_id: { type: "string" },
                fields: objectSchema(
                  {
                    alias: { type: "string" },
                    gender: { type: "string" },
                    age: { type: "string" },
                    identity: { type: "string" },
                    personality: { type: "string" },
                    appearance: { type: "string" },
                    motivation: { type: "string" },
                    secret: { type: "string" },
                    faction_name: { type: "string" },
                    current_location_name: { type: "string" },
                    realm_level: { type: "string" },
                    ability: { type: "string" },
                    physical_status: { type: "string" },
                    mental_status: { type: "string" },
                    status: {
                      type: "string",
                      enum: ["active", "dead", "missing", "hidden", "retired", "unknown"]
                    },
                    important_action: { type: "string" },
                    change_summary: { type: "string" }
                  },
                  [
                    "alias",
                    "gender",
                    "age",
                    "identity",
                    "personality",
                    "appearance",
                    "motivation",
                    "secret",
                    "faction_name",
                    "current_location_name",
                    "realm_level",
                    "ability",
                    "physical_status",
                    "mental_status",
                    "status",
                    "important_action",
                    "change_summary"
                  ]
                ),
                reason: { type: "string" },
                confidence: { type: "number" }
              },
              ["action", "character_name", "target_character_id", "fields", "reason", "confidence"]
            )
          )
        },
        ["updates"]
      )
    }
  },
  {
    type: "function",
    function: {
      name: "propose_location_updates",
      description: "提出地点新增或更新建议。",
      strict: true,
      parameters: objectSchema(
        {
          updates: arraySchema(
            objectSchema(
              {
                action: { type: "string", enum: actionEnum },
                location_name: { type: "string" },
                target_location_id: { type: "string" },
                fields: objectSchema(
                  {
                    type: { type: "string" },
                    parent_location_name: { type: "string" },
                    description: { type: "string" },
                    climate: { type: "string" },
                    culture: { type: "string" },
                    danger_level: { type: "string" },
                    current_status: { type: "string" }
                  },
                  [
                    "type",
                    "parent_location_name",
                    "description",
                    "climate",
                    "culture",
                    "danger_level",
                    "current_status"
                  ]
                ),
                reason: { type: "string" },
                confidence: { type: "number" }
              },
              ["action", "location_name", "target_location_id", "fields", "reason", "confidence"]
            )
          )
        },
        ["updates"]
      )
    }
  },
  {
    type: "function",
    function: {
      name: "propose_faction_updates",
      description: "提出势力新增或更新建议。",
      strict: true,
      parameters: objectSchema(
        {
          updates: arraySchema(
            objectSchema(
              {
                action: { type: "string", enum: actionEnum },
                faction_name: { type: "string" },
                target_faction_id: { type: "string" },
                fields: objectSchema(
                  {
                    type: { type: "string" },
                    description: { type: "string" },
                    leader_character_name: { type: "string" },
                    territory_location_name: { type: "string" },
                    ideology: { type: "string" },
                    strength_level: { type: "string" },
                    current_status: { type: "string" }
                  },
                  [
                    "type",
                    "description",
                    "leader_character_name",
                    "territory_location_name",
                    "ideology",
                    "strength_level",
                    "current_status"
                  ]
                ),
                reason: { type: "string" },
                confidence: { type: "number" }
              },
              ["action", "faction_name", "target_faction_id", "fields", "reason", "confidence"]
            )
          )
        },
        ["updates"]
      )
    }
  },
  {
    type: "function",
    function: {
      name: "propose_relationship_updates",
      description: "提出人物关系新增或更新建议。",
      strict: true,
      parameters: objectSchema(
        {
          updates: arraySchema(
            objectSchema(
              {
                action: { type: "string", enum: actionEnum },
                target_relationship_id: { type: "string" },
                character_a_name: { type: "string" },
                character_b_name: { type: "string" },
                fields: objectSchema(
                  {
                    relationship_type: { type: "string" },
                    relationship_strength: { type: "number" },
                    description: { type: "string" },
                    current_status: { type: "string" },
                    before_status: { type: "string" },
                    after_status: { type: "string" }
                  },
                  [
                    "relationship_type",
                    "relationship_strength",
                    "description",
                    "current_status",
                    "before_status",
                    "after_status"
                  ]
                ),
                reason: { type: "string" },
                confidence: { type: "number" }
              },
              [
                "action",
                "target_relationship_id",
                "character_a_name",
                "character_b_name",
                "fields",
                "reason",
                "confidence"
              ]
            )
          )
        },
        ["updates"]
      )
    }
  },
  {
    type: "function",
    function: {
      name: "propose_foreshadowing_updates",
      description: "提出伏笔新增或更新建议。",
      strict: true,
      parameters: objectSchema(
        {
          updates: arraySchema(
            objectSchema(
              {
                action: { type: "string", enum: actionEnum },
                foreshadowing_title: { type: "string" },
                target_foreshadowing_id: { type: "string" },
                fields: objectSchema(
                  {
                    description: { type: "string" },
                    status: {
                      type: "string",
                      enum: ["planted", "developing", "revealed", "abandoned", "unknown"]
                    },
                    importance: {
                      type: "string",
                      enum: ["low", "normal", "high", "critical", "unknown"]
                    },
                    related_character_names: { type: "string" },
                    related_location_names: { type: "string" },
                    related_item_names: { type: "string" }
                  },
                  [
                    "description",
                    "status",
                    "importance",
                    "related_character_names",
                    "related_location_names",
                    "related_item_names"
                  ]
                ),
                reason: { type: "string" },
                confidence: { type: "number" }
              },
              [
                "action",
                "foreshadowing_title",
                "target_foreshadowing_id",
                "fields",
                "reason",
                "confidence"
              ]
            )
          )
        },
        ["updates"]
      )
    }
  },
  {
    type: "function",
    function: {
      name: "propose_item_updates",
      description: "提出道具新增或更新建议。",
      strict: true,
      parameters: objectSchema(
        {
          updates: arraySchema(
            objectSchema(
              {
                action: { type: "string", enum: actionEnum },
                item_name: { type: "string" },
                target_item_id: { type: "string" },
                fields: objectSchema(
                  {
                    type: { type: "string" },
                    description: { type: "string" },
                    owner_character_name: { type: "string" },
                    current_location_name: { type: "string" },
                    ability: { type: "string" },
                    current_status: { type: "string" }
                  },
                  [
                    "type",
                    "description",
                    "owner_character_name",
                    "current_location_name",
                    "ability",
                    "current_status"
                  ]
                ),
                reason: { type: "string" },
                confidence: { type: "number" }
              },
              ["action", "item_name", "target_item_id", "fields", "reason", "confidence"]
            )
          )
        },
        ["updates"]
      )
    }
  },
  {
    type: "function",
    function: {
      name: "propose_timeline_events",
      description: "提出重要时间线事件。",
      strict: true,
      parameters: objectSchema(
        {
          events: arraySchema(
            objectSchema(
              {
                title: { type: "string" },
                description: { type: "string" },
                event_time_text: { type: "string" },
                importance: {
                  type: "string",
                  enum: ["low", "normal", "high", "critical"]
                },
                involved_character_names: { type: "string" },
                involved_location_names: { type: "string" },
                reason: { type: "string" },
                confidence: { type: "number" }
              },
              [
                "title",
                "description",
                "event_time_text",
                "importance",
                "involved_character_names",
                "involved_location_names",
                "reason",
                "confidence"
              ]
            )
          )
        },
        ["events"]
      )
    }
  }
];
