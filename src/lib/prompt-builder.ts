import type {
  Chapter,
  Character,
  CharacterRelationship,
  Faction,
  Foreshadowing,
  Item,
  KnowledgeEntry,
  Location,
  Novel,
  TimelineEvent,
  Volume
} from "@prisma/client";

export type PromptMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChapterGenerationInput = {
  novel: Novel;
  volume: Volume | null;
  chapter: Chapter;
  fixedKnowledgeEntries: KnowledgeEntry[];
  recentChapters: Chapter[];
  previousChapterContents: Chapter[];
  selectedCharacters: Character[];
  selectedLocations: Location[];
  selectedFactions: Faction[];
  selectedForeshadowings: Foreshadowing[];
  selectedItems: Item[];
  chapterGoal: string;
  targetWordCount: number;
  tone: string;
  constraints: string[];
};

export type PromptBuildResult = {
  messages: PromptMessage[];
  promptSnapshot: string;
  contextSnapshot: Record<string, unknown>;
};

function text(value: string | null | undefined) {
  return value?.trim() || "未填写";
}

function sectionList<T>(
  items: T[],
  render: (item: T, index: number) => string,
  empty = "无"
) {
  if (!items.length) return empty;
  return items.map(render).join("\n");
}

function asLines(items: string[]) {
  const filtered = items.map((item) => item.trim()).filter(Boolean);
  return filtered.length ? filtered.map((item) => `- ${item}`).join("\n") : "无";
}

export function buildChapterGenerationPrompt(
  input: ChapterGenerationInput
): PromptBuildResult {
  const system = [
    "你是一名职业长篇小说作者，擅长创作结构完整、人物稳定、节奏清晰的类型小说。",
    "你必须严格遵守用户提供的世界观、角色状态、地点关系、伏笔状态、时间线和章节目标。",
    "不得擅自修改核心设定。不得让角色做出明显违背当前状态的行为。",
    "不得让已死亡角色无解释复活。不得提前揭露未指定揭露的伏笔。",
    "不得输出解释、分析、提纲，只输出小说正文。"
  ].join("");

  const user = `【小说信息】
标题：${input.novel.title}
类型：${text(input.novel.genre)}
主题：${text(input.novel.theme)}
简介：${text(input.novel.description)}
写作风格：${text(input.novel.writingStyle)}
目标读者：${text(input.novel.targetReader)}

【固定世界观与规则】
${sectionList(input.fixedKnowledgeEntries, (entry) => `- ${entry.title}（${entry.type}）：${entry.content}`)}

【当前卷信息】
卷名：${text(input.volume?.title)}
卷摘要：${text(input.volume?.summary)}

【最近章节摘要】
${sectionList(
  input.recentChapters,
  (chapter) =>
    `- 第 ${chapter.chapterNo} 章《${chapter.title}》：${text(
      chapter.summaryShort || chapter.summaryLong || chapter.outline
    )}`
)}

【前两章正文（用于保持内容连贯）】
${input.previousChapterContents.length > 0
  ? input.previousChapterContents
      .map(
        (chapter) =>
          `【第 ${chapter.chapterNo} 章《${chapter.title}》正文】\n${text(chapter.content)}`
      )
      .join("\n\n")
  : "无前章正文"}

【当前章节】
章节名：${input.chapter.title}
章节序号：${input.chapter.chapterNo}
章节大纲：${text(input.chapter.outline)}

【本章目标】
${text(input.chapterGoal)}

【出场角色】
${sectionList(
  input.selectedCharacters,
  (character) =>
    `- ${character.name}：身份=${text(character.identity)}；状态=${character.status}；境界=${text(
      character.realmLevel
    )}；当前地点ID=${text(character.currentLocationId)}；动机=${text(character.motivation)}`
)}

【场景地点】
${sectionList(
  input.selectedLocations,
  (location) =>
    `- ${location.name}：类型=${location.type}；描述=${text(
      location.description
    )}；当前状态=${text(location.currentStatus)}`
)}

【相关势力】
${sectionList(
  input.selectedFactions,
  (faction) =>
    `- ${faction.name}：类型=${faction.type}；理念=${text(
      faction.ideology
    )}；实力=${text(faction.strengthLevel)}；当前状态=${text(faction.currentStatus)}`
)}

【相关伏笔】
${sectionList(
  input.selectedForeshadowings,
  (item) =>
    `- ${item.title}：状态=${item.status}；重要性=${item.importance}；说明=${item.description}`
)}

【相关道具】
${sectionList(
  input.selectedItems,
  (item) =>
    `- ${item.name}：类型=${text(item.type)}；能力=${text(item.ability)}；当前状态=${text(
      item.currentStatus
    )}`
)}

【强制约束】
${asLines(input.constraints)}

【生成要求】
目标字数：${input.targetWordCount}
氛围语气：${text(input.tone)}

请直接输出本章小说正文。不要输出标题。不要输出解释。不要输出 Markdown。不要输出提纲。`;

  const messages: PromptMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user }
  ];

  return {
    messages,
    promptSnapshot: messages.map((message) => `${message.role}:\n${message.content}`).join("\n\n"),
    contextSnapshot: {
      fixedKnowledgeEntryIds: input.fixedKnowledgeEntries.map((entry) => entry.id),
      recentChapterIds: input.recentChapters.map((chapter) => chapter.id),
      previousChapterContentIds: input.previousChapterContents.map((chapter) => chapter.id),
      characterIds: input.selectedCharacters.map((character) => character.id),
      locationIds: input.selectedLocations.map((location) => location.id),
      factionIds: input.selectedFactions.map((faction) => faction.id),
      foreshadowingIds: input.selectedForeshadowings.map((item) => item.id),
      itemIds: input.selectedItems.map((item) => item.id),
      chapterGoal: input.chapterGoal,
      targetWordCount: input.targetWordCount,
      tone: input.tone,
      constraints: input.constraints
    }
  };
}

export function buildChapterSummaryPrompt(chapterContent: string): PromptBuildResult {
  const system =
    "你是小说章节摘要与事件抽取专家。你必须只输出合法 json，不要输出 Markdown，不要输出解释。";
  const user = `请阅读下面的小说章节正文，并输出 json 格式的章节摘要。
输出 JSON 必须严格符合以下结构：
{
  "short_summary": "100字以内短摘要",
  "long_summary": "500字以内长摘要",
  "key_events": [
    {
      "title": "事件标题",
      "description": "事件说明",
      "importance": "low | normal | high | critical"
    }
  ],
  "characters": ["角色名"],
  "locations": ["地点名"],
  "foreshadowing_updates": ["伏笔变化说明"]
}

要求：
1. 只输出 JSON。
2. 不要输出 Markdown。
3. 不要编造章节中没有的信息。
4. key_events 按章节发生顺序排列。

章节正文：
${chapterContent}`;

  const messages: PromptMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
  return {
    messages,
    promptSnapshot: messages.map((message) => `${message.role}:\n${message.content}`).join("\n\n"),
    contextSnapshot: { contentLength: chapterContent.length }
  };
}

export function buildConsistencyCheckPrompt(input: {
  chapterContent: string;
  knowledgeContext: string;
}): PromptBuildResult {
  const system =
    "你是长篇小说设定一致性审校专家。你必须只输出合法 json，不要输出 Markdown，不要输出解释。";
  const user = `请根据【当前章节正文】和【已有知识库】检查是否存在设定冲突。
输出 JSON 必须严格符合以下结构：
{
  "issues": [
    {
      "type": "character_status_conflict | location_conflict | timeline_conflict | foreshadowing_conflict | worldview_conflict | relationship_conflict | item_conflict",
      "severity": "low | medium | high",
      "title": "问题标题",
      "description": "问题描述",
      "related_entity": "相关实体",
      "suggestion": "修改建议"
    }
  ]
}

如果没有问题，输出：
{
  "issues": []
}

检查重点：
1. 角色是否出现在不合理地点。
2. 已死亡、失踪、受伤角色是否行为异常。
3. 境界、能力、道具使用是否违反设定。
4. 伏笔是否被提前揭露。
5. 时间线是否前后矛盾。
6. 人物关系是否突然变化但缺少原因。
7. 世界观规则是否被违反。

【已有知识库】
${input.knowledgeContext}

【当前章节正文】
${input.chapterContent}`;

  const messages: PromptMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
  return {
    messages,
    promptSnapshot: messages.map((message) => `${message.role}:\n${message.content}`).join("\n\n"),
    contextSnapshot: {
      knowledgeLength: input.knowledgeContext.length,
      contentLength: input.chapterContent.length
    }
  };
}

export function buildKnowledgeExtractionPrompt(input: {
  characters: Character[];
  locations: Location[];
  factions: Faction[];
  relationships: CharacterRelationship[];
  foreshadowings: Foreshadowing[];
  items: Item[];
  timelineEvents: TimelineEvent[];
  chapterSummary: string;
  chapterContent: string;
}): PromptBuildResult {
  const system =
    "你是小说知识库结构化抽取专家。你只能通过工具调用输出结构化结果，不要输出普通文本。请根据当前章节正文和已有知识库提出知识库更新建议。不要编造章节中没有出现或没有明确暗示的信息。不要直接覆盖已有知识库。轻微描写不构成设定变化时，不要提出更新。所有更新只是建议，最终由用户审核。";
  const user = `请分析当前章节，抽取以下变化：
1. 新角色。
2. 角色状态变化。
3. 角色境界或能力变化。
4. 角色当前地点变化。
5. 新地点。
6. 地点状态变化。
7. 新势力或势力状态变化。
8. 人物关系变化。
9. 新伏笔、伏笔推进、伏笔回收。
10. 道具归属变化。
11. 重要时间线事件。

如果某类没有变化，返回空数组。
update 操作必须尽量匹配已有实体 id。
如果无法确定已有 id，target_id 使用空字符串。
无变化字段使用空字符串。
不要输出普通文本，只调用工具。

【已有角色】
${sectionList(input.characters, (item) => `- id=${item.id}；${item.name}；状态=${item.status}；地点ID=${text(item.currentLocationId)}；境界=${text(item.realmLevel)}`)}

【已有地点】
${sectionList(input.locations, (item) => `- id=${item.id}；${item.name}；类型=${item.type}；状态=${text(item.currentStatus)}`)}

【已有势力】
${sectionList(input.factions, (item) => `- id=${item.id}；${item.name}；类型=${item.type}；状态=${text(item.currentStatus)}`)}

【已有人物关系】
${sectionList(input.relationships, (item) => `- id=${item.id}；角色A=${item.characterAId}；角色B=${item.characterBId}；类型=${item.relationshipType}；状态=${text(item.currentStatus)}`)}

【已有伏笔】
${sectionList(input.foreshadowings, (item) => `- id=${item.id}；${item.title}；状态=${item.status}；重要性=${item.importance}`)}

【已有道具】
${sectionList(input.items, (item) => `- id=${item.id}；${item.name}；持有者ID=${text(item.ownerCharacterId)}；位置ID=${text(item.currentLocationId)}；状态=${text(item.currentStatus)}`)}

【已有时间线】
${sectionList(input.timelineEvents, (item) => `- id=${item.id}；${item.title}；${item.description}`)}

【当前章节摘要】
${text(input.chapterSummary)}

【当前章节正文】
${input.chapterContent}`;

  const messages: PromptMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
  return {
    messages,
    promptSnapshot: messages.map((message) => `${message.role}:\n${message.content}`).join("\n\n"),
    contextSnapshot: {
      characterIds: input.characters.map((item) => item.id),
      locationIds: input.locations.map((item) => item.id),
      factionIds: input.factions.map((item) => item.id),
      relationshipIds: input.relationships.map((item) => item.id),
      foreshadowingIds: input.foreshadowings.map((item) => item.id),
      itemIds: input.items.map((item) => item.id),
      timelineEventIds: input.timelineEvents.map((item) => item.id)
    }
  };
}

export function buildKnowledgeContext(input: {
  entries: KnowledgeEntry[];
  characters: Character[];
  locations: Location[];
  factions: Faction[];
  relationships: CharacterRelationship[];
  foreshadowings: Foreshadowing[];
  items: Item[];
  timelineEvents: TimelineEvent[];
}) {
  return [
    "【世界观】",
    sectionList(input.entries, (item) => `- ${item.title}（${item.type}）：${item.content}`),
    "【角色】",
    sectionList(input.characters, (item) => `- ${item.name}：状态=${item.status}；境界=${text(item.realmLevel)}；地点ID=${text(item.currentLocationId)}；说明=${text(item.identity)}`),
    "【地点】",
    sectionList(input.locations, (item) => `- ${item.name}：类型=${item.type}；状态=${text(item.currentStatus)}；描述=${text(item.description)}`),
    "【势力】",
    sectionList(input.factions, (item) => `- ${item.name}：类型=${item.type}；状态=${text(item.currentStatus)}；描述=${text(item.description)}`),
    "【人物关系】",
    sectionList(input.relationships, (item) => `- ${item.characterAId} / ${item.characterBId}：${item.relationshipType}；强度=${item.relationshipStrength}；状态=${text(item.currentStatus)}`),
    "【伏笔】",
    sectionList(input.foreshadowings, (item) => `- ${item.title}：状态=${item.status}；重要性=${item.importance}；${item.description}`),
    "【道具】",
    sectionList(input.items, (item) => `- ${item.name}：能力=${text(item.ability)}；状态=${text(item.currentStatus)}`),
    "【时间线】",
    sectionList(input.timelineEvents, (item) => `- ${text(item.eventTimeText)} ${item.title}：${item.description}`)
  ].join("\n");
}
