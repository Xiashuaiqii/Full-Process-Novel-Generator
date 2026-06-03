import { ok, withApiHandler } from "@/lib/api-response";
import { getOrCreateLocalUser } from "@/lib/local-user";
import {
  acceptProposal,
  checkConsistency,
  createChapter,
  createEntity,
  createNovel,
  createVolume,
  deleteChapter,
  deleteEntity,
  deleteNovel,
  deleteVolume,
  editAndAcceptProposal,
  extractKnowledge,
  generateChapter,
  getChapter,
  getChapterVersions,
  getGenerationTask,
  getNovel,
  getSettingsPayload,
  listAiPromptLogs,
  listChapterPromptLogs,
  listChapters,
  listCurrentChapterProposals,
  listEntity,
  listLogs,
  listNovels,
  listProposals,
  listVolumes,
  previewChapterPrompt,
  rejectProposal,
  summarizeChapter,
  testDeepSeekConnection,
  updateChapter,
  updateDeepSeekSettings,
  updateEntity,
  updateNovel,
  updateVolume,
  writeFrontendLog
} from "@/services/server";

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

async function jsonBody(request: Request) {
  const text = await request.text();
  if (!text) return {};
  return JSON.parse(text) as unknown;
}

function urlSearch(request: Request) {
  return new URL(request.url).searchParams;
}

function isEntityList(segment: string) {
  return [
    "knowledge-entries",
    "characters",
    "locations",
    "factions",
    "relationships",
    "foreshadowings",
    "items",
    "timeline-events"
  ].includes(segment);
}

export async function GET(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  return withApiHandler(request, `GET /api/${path.join("/")}`, async () => {
    if (path[0] === "local-user" && path.length === 1) {
      return ok(await getOrCreateLocalUser());
    }

    if (path[0] === "settings" && path[1] === "deepseek" && path.length === 2) {
      return ok(await getSettingsPayload());
    }

    if (path[0] === "novels" && path.length === 1) {
      return ok(await listNovels());
    }

    if (path[0] === "novels" && path[1] && path.length === 2) {
      return ok(await getNovel(path[1]));
    }

    if (path[0] === "novels" && path[1] && path[2] === "volumes") {
      return ok(await listVolumes(path[1]));
    }

    if (path[0] === "novels" && path[1] && path[2] === "chapters") {
      return ok(await listChapters(path[1]));
    }

    if (path[0] === "novels" && path[1] && path[2] && isEntityList(path[2])) {
      return ok(await listEntity(path[1], path[2]));
    }

    if (path[0] === "novels" && path[1] && path[2] === "proposals") {
      return ok(await listProposals(path[1], urlSearch(request)));
    }

    if (path[0] === "chapters" && path[1] && path.length === 2) {
      return ok(await getChapter(path[1]));
    }

    if (path[0] === "chapters" && path[1] && path[2] === "versions") {
      return ok(await getChapterVersions(path[1]));
    }

    if (path[0] === "chapters" && path[1] && path[2] === "prompt-logs") {
      return ok(await listChapterPromptLogs(path[1]));
    }

    if (path[0] === "chapters" && path[1] && path[2] === "proposals") {
      return ok(await listCurrentChapterProposals(path[1]));
    }

    if (path[0] === "generation-tasks" && path[1]) {
      return ok(await getGenerationTask(path[1]));
    }

    if (path[0] === "logs" && path.length === 1) {
      return ok(await listLogs(urlSearch(request)));
    }

    if (path[0] === "logs" && path[1] === "ai") {
      return ok(await listAiPromptLogs(urlSearch(request)));
    }

    throw new Error(`未找到 API：GET /api/${path.join("/")}`);
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  return withApiHandler(request, `POST /api/${path.join("/")}`, async () => {
    if (path[0] === "settings" && path[1] === "deepseek" && path[2] === "test") {
      return ok(await testDeepSeekConnection());
    }

    if (path[0] === "novels" && path.length === 1) {
      return ok(await createNovel(await jsonBody(request)));
    }

    if (path[0] === "novels" && path[1] && path[2] === "volumes") {
      return ok(await createVolume(path[1], await jsonBody(request)));
    }

    if (path[0] === "novels" && path[1] && path[2] === "chapters") {
      return ok(await createChapter(path[1], await jsonBody(request)));
    }

    if (path[0] === "novels" && path[1] && path[2] && isEntityList(path[2])) {
      return ok(await createEntity(path[1], path[2], await jsonBody(request)));
    }

    if (path[0] === "chapters" && path[1] && path[2] === "generate") {
      const result = await generateChapter(path[1], await jsonBody(request));
      return result instanceof Response ? result : ok(result);
    }

    if (path[0] === "chapters" && path[1] && path[2] === "summarize") {
      return ok(await summarizeChapter(path[1]));
    }

    if (path[0] === "chapters" && path[1] && path[2] === "extract-knowledge") {
      return ok(await extractKnowledge(path[1]));
    }

    if (path[0] === "chapters" && path[1] && path[2] === "check-consistency") {
      return ok(await checkConsistency(path[1]));
    }

    if (path[0] === "chapters" && path[1] && path[2] === "prompt-preview") {
      return ok(await previewChapterPrompt(path[1], await jsonBody(request)));
    }

    if (path[0] === "proposals" && path[1] && path[2] === "accept") {
      return ok(await acceptProposal(path[1]));
    }

    if (path[0] === "proposals" && path[1] && path[2] === "reject") {
      return ok(await rejectProposal(path[1]));
    }

    if (path[0] === "proposals" && path[1] && path[2] === "edit-and-accept") {
      return ok(await editAndAcceptProposal(path[1], await jsonBody(request)));
    }

    if (path[0] === "logs" && path[1] === "frontend") {
      return ok(await writeFrontendLog(await jsonBody(request)));
    }

    throw new Error(`未找到 API：POST /api/${path.join("/")}`);
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  return withApiHandler(request, `PUT /api/${path.join("/")}`, async () => {
    if (path[0] === "settings" && path[1] === "deepseek" && path.length === 2) {
      return ok(await updateDeepSeekSettings(await jsonBody(request)));
    }

    if (path[0] === "novels" && path[1] && path.length === 2) {
      return ok(await updateNovel(path[1], await jsonBody(request)));
    }

    if (path[0] === "volumes" && path[1]) {
      return ok(await updateVolume(path[1], await jsonBody(request)));
    }

    if (path[0] === "chapters" && path[1]) {
      return ok(await updateChapter(path[1], await jsonBody(request)));
    }

    if (path[0] && path[1] && isEntityList(path[0])) {
      return ok(await updateEntity(path[0], path[1], await jsonBody(request)));
    }

    throw new Error(`未找到 API：PUT /api/${path.join("/")}`);
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  return withApiHandler(request, `DELETE /api/${path.join("/")}`, async () => {
    if (path[0] === "novels" && path[1] && path.length === 2) {
      return ok(await deleteNovel(path[1]));
    }

    if (path[0] === "volumes" && path[1]) {
      return ok(await deleteVolume(path[1]));
    }

    if (path[0] === "chapters" && path[1]) {
      return ok(await deleteChapter(path[1]));
    }

    if (path[0] && path[1] && isEntityList(path[0])) {
      return ok(await deleteEntity(path[0], path[1]));
    }

    throw new Error(`未找到 API：DELETE /api/${path.join("/")}`);
  });
}
