import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TASK_PROFILES = [
  {
    taskType: "chapter_generation",
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
  {
    taskType: "chapter_summary",
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
  {
    taskType: "knowledge_extraction",
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
  {
    taskType: "consistency_check",
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
] as const;

async function main() {
  const user = await prisma.localUser.upsert({
    where: { id: "local-user" },
    update: {},
    create: { id: "local-user", name: "Local User" }
  });

  const settings = await prisma.deepSeekSettings.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      baseUrl: "https://api.deepseek.com",
      betaBaseUrl: "https://api.deepseek.com/beta"
    }
  });

  for (const profile of TASK_PROFILES) {
    await prisma.deepSeekTaskProfile.upsert({
      where: {
        settingsId_taskType: {
          settingsId: settings.id,
          taskType: profile.taskType
        }
      },
      update: {},
      create: {
        settingsId: settings.id,
        ...profile
      }
    });
  }

  const existingNovel = await prisma.novel.findFirst({
    where: { userId: user.id, title: "玄天纪" }
  });

  if (existingNovel) {
    console.log("示例小说已存在，跳过 seed 数据创建。");
    return;
  }

  const novel = await prisma.novel.create({
    data: {
      userId: user.id,
      title: "玄天纪",
      genre: "玄幻",
      theme: "少年在宗门试炼与隐秘血脉中寻找自身命运",
      description:
        "边陲少年林寒在雨夜被带入青云宗，卷入黑色玉佩、血魔教旧案与宗门暗流。",
      writingStyle: "节奏清晰，悬念递进，战斗描写克制但有画面感。",
      targetReader: "喜欢传统玄幻成长线和宗门悬疑的读者",
      status: "active"
    }
  });

  const volume = await prisma.volume.create({
    data: {
      novelId: novel.id,
      title: "青云初起",
      summary: "林寒进入青云宗，从试炼开始接触宗门暗流。",
      sortOrder: 1
    }
  });

  const chapters = await Promise.all([
    prisma.chapter.create({
      data: {
        novelId: novel.id,
        volumeId: volume.id,
        title: "雨夜入山",
        chapterNo: 1,
        outline: "林寒在雨夜被白长老带入青云山，黑色玉佩首次产生异动。",
        content: "雨落青云山。林寒攥紧怀里的黑色玉佩，跟着白长老踏入山门。",
        summaryShort: "林寒雨夜入青云宗，黑色玉佩出现异动。",
        summaryLong:
          "林寒在雨夜被白长老带入青云宗。山门阵法开启时，他怀中的黑色玉佩微微发热，似乎与青云山深处产生呼应。",
        wordCount: 34
      }
    }),
    prisma.chapter.create({
      data: {
        novelId: novel.id,
        volumeId: volume.id,
        title: "青云试炼",
        chapterNo: 2,
        outline: "林寒参加入门试炼，与苏瑶结伴，赵无极暗中观察。",
        content: "试炼谷雾气沉沉。苏瑶递来一枚解毒丹，赵无极的目光从远处掠过。",
        summaryShort: "林寒参加试炼，与苏瑶结伴，赵无极暗中观察。",
        summaryLong:
          "林寒进入试炼谷参加青云宗入门试炼，途中与苏瑶互相照应。赵无极在暗处留意林寒和黑色玉佩。",
        wordCount: 35
      }
    }),
    prisma.chapter.create({
      data: {
        novelId: novel.id,
        volumeId: volume.id,
        title: "血色玉佩",
        chapterNo: 3,
        outline: "黑色玉佩染血后显露血纹，林寒意识到它与血魔教有关。",
        content: "",
        wordCount: 0
      }
    })
  ]);

  await prisma.knowledgeEntry.createMany({
    data: [
      {
        novelId: novel.id,
        title: "玄天大陆基础设定",
        type: "worldview",
        content:
          "玄天大陆以宗门、王朝与世家并立。灵脉决定地域强弱，灵气浓郁处多被宗门占据。",
        isFixedContext: true,
        priority: 10
      },
      {
        novelId: novel.id,
        title: "修炼体系",
        type: "cultivation",
        content:
          "修炼境界依次为炼气、筑基、凝元、玄丹、化神。跨境战斗极少发生，必须有明确代价或特殊条件。",
        isFixedContext: true,
        priority: 20
      },
      {
        novelId: novel.id,
        title: "宗门等级",
        type: "rule",
        content:
          "宗门分九品到一品，青云宗为七品宗门，掌控青云山周边三百里。",
        isFixedContext: true,
        priority: 30
      },
      {
        novelId: novel.id,
        title: "写作风格要求",
        type: "style",
        content:
          "正文避免解释式旁白，优先通过行动、对话和场景推进信息。每章结尾保留轻微悬念。",
        isFixedContext: true,
        priority: 40
      }
    ]
  });

  const [xuantiandalu, qingyunshan, qingyunzong, shiliangu] = await Promise.all([
    prisma.location.create({
      data: {
        novelId: novel.id,
        name: "玄天大陆",
        type: "world",
        description: "故事发生的主大陆，宗门林立，灵脉纵横。",
        currentStatus: "整体局势平静，暗处有魔教余孽活动。"
      }
    }),
    prisma.location.create({
      data: {
        novelId: novel.id,
        name: "青云山",
        type: "mountain",
        description: "青云宗所在山脉，云雾终年不散。",
        dangerLevel: "normal"
      }
    }),
    prisma.location.create({
      data: {
        novelId: novel.id,
        name: "青云宗",
        type: "sect",
        description: "七品宗门，重视试炼与门规。",
        currentStatus: "正在举行入门试炼。"
      }
    }),
    prisma.location.create({
      data: {
        novelId: novel.id,
        name: "试炼谷",
        type: "secret_realm",
        description: "青云宗弟子试炼之地，谷中阵法会压制外来灵力。",
        dangerLevel: "medium"
      }
    })
  ]);

  await prisma.location.update({
    where: { id: qingyunshan.id },
    data: { parentId: xuantiandalu.id }
  });
  await prisma.location.update({
    where: { id: qingyunzong.id },
    data: { parentId: qingyunshan.id }
  });
  await prisma.location.update({
    where: { id: shiliangu.id },
    data: { parentId: qingyunzong.id }
  });

  const [qingyunFaction, xuemoFaction] = await Promise.all([
    prisma.faction.create({
      data: {
        novelId: novel.id,
        name: "青云宗",
        type: "sect",
        description: "七品正道宗门，掌控青云山。",
        territoryLocationId: qingyunzong.id,
        ideology: "守山门，护凡境，重门规。",
        strengthLevel: "七品宗门",
        currentStatus: "内部平稳，但长老之间有路线分歧。"
      }
    }),
    prisma.faction.create({
      data: {
        novelId: novel.id,
        name: "血魔教",
        type: "secret_org",
        description: "二十年前被围剿的魔教残部，擅长血纹秘术。",
        ideology: "以血炼魂，复兴旧教。",
        strengthLevel: "残部不明",
        currentStatus: "疑似在青云山附近重新活动。"
      }
    })
  ]);

  const [linhan, suyao, zhaowuji, bailaolao] = await Promise.all([
    prisma.character.create({
      data: {
        novelId: novel.id,
        name: "林寒",
        gender: "男",
        age: "16",
        identity: "边陲少年，青云宗新入门弟子",
        personality: "谨慎、坚韧、重承诺",
        appearance: "身形清瘦，眼神沉静",
        motivation: "查清黑色玉佩与身世的关系",
        secret: "黑色玉佩会回应血纹秘术",
        factionId: qingyunFaction.id,
        currentLocationId: qingyunzong.id,
        realmLevel: "炼气初期",
        ability: "感知灵气波动",
        firstAppearanceChapterId: chapters[0].id,
        lastAppearanceChapterId: chapters[2].id
      }
    }),
    prisma.character.create({
      data: {
        novelId: novel.id,
        name: "苏瑶",
        gender: "女",
        age: "16",
        identity: "青云宗外门弟子",
        personality: "冷静、细致、外冷内热",
        appearance: "白衣短剑，眉眼清亮",
        motivation: "通过试炼进入内门",
        factionId: qingyunFaction.id,
        currentLocationId: shiliangu.id,
        realmLevel: "炼气中期",
        ability: "基础剑诀与药理",
        firstAppearanceChapterId: chapters[1].id,
        lastAppearanceChapterId: chapters[2].id
      }
    }),
    prisma.character.create({
      data: {
        novelId: novel.id,
        name: "赵无极",
        gender: "男",
        age: "17",
        identity: "青云宗外门弟子",
        personality: "骄傲、敏锐、善于隐藏真实意图",
        appearance: "锦衣长剑，神色倨傲",
        motivation: "夺得试炼第一并调查林寒玉佩",
        secret: "与血魔教旧案有隐秘联系",
        factionId: qingyunFaction.id,
        currentLocationId: shiliangu.id,
        realmLevel: "炼气后期",
        ability: "快剑",
        firstAppearanceChapterId: chapters[1].id,
        lastAppearanceChapterId: chapters[2].id
      }
    }),
    prisma.character.create({
      data: {
        novelId: novel.id,
        name: "白长老",
        gender: "男",
        age: "不详",
        identity: "青云宗长老",
        personality: "沉稳、寡言、护短",
        appearance: "白发青袍，袖中常藏一枚木令",
        motivation: "守住青云宗旧案真相",
        factionId: qingyunFaction.id,
        currentLocationId: qingyunzong.id,
        realmLevel: "凝元后期",
        ability: "阵法与青云剑气",
        firstAppearanceChapterId: chapters[0].id,
        lastAppearanceChapterId: chapters[2].id
      }
    })
  ]);

  await prisma.faction.update({
    where: { id: qingyunFaction.id },
    data: { leaderCharacterId: bailaolao.id }
  });

  await Promise.all([
    prisma.foreshadowing.create({
      data: {
        novelId: novel.id,
        title: "黑色玉佩的来历",
        description: "林寒随身黑色玉佩会在青云山阵法与血纹气息附近发热。",
        plantedChapterId: chapters[0].id,
        status: "developing",
        importance: "critical"
      }
    }),
    prisma.foreshadowing.create({
      data: {
        novelId: novel.id,
        title: "赵无极的异常行踪",
        description: "赵无极在试炼开始前后多次避开巡山弟子，似乎另有目的。",
        plantedChapterId: chapters[1].id,
        status: "planted",
        importance: "high"
      }
    })
  ]);

  await prisma.item.create({
    data: {
      novelId: novel.id,
      name: "黑色玉佩",
      type: "玉佩",
      description: "林寒自幼携带的黑色玉佩，表面有几乎不可见的血色纹路。",
      ownerCharacterId: linhan.id,
      currentLocationId: qingyunzong.id,
      ability: "会对青云山阵法和血纹气息产生微弱反应",
      currentStatus: "随林寒携带"
    }
  });

  await Promise.all([
    prisma.characterRelationship.create({
      data: {
        novelId: novel.id,
        characterAId: linhan.id,
        characterBId: suyao.id,
        relationshipType: "friend",
        relationshipStrength: 25,
        description: "试炼中互相照应的同伴",
        currentStatus: "初步信任"
      }
    }),
    prisma.characterRelationship.create({
      data: {
        novelId: novel.id,
        characterAId: linhan.id,
        characterBId: zhaowuji.id,
        relationshipType: "suspicion",
        relationshipStrength: -30,
        description: "赵无极暗中观察林寒，林寒有所警觉",
        currentStatus: "互相试探"
      }
    }),
    prisma.characterRelationship.create({
      data: {
        novelId: novel.id,
        characterAId: linhan.id,
        characterBId: bailaolao.id,
        relationshipType: "master_disciple",
        relationshipStrength: 40,
        description: "白长老引林寒入山，对其有所庇护",
        currentStatus: "未正式拜师，但已有师徒之实"
      }
    })
  ]);

  await prisma.appLog.create({
    data: {
      level: "info",
      scope: "seed",
      message: "示例数据初始化完成",
      details: { novelTitle: novel.title }
    }
  });

  console.log("Seed 完成。");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
