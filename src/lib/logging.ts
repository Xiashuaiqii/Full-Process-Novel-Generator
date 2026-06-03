import { prisma } from "@/lib/prisma";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogInput = {
  level?: LogLevel;
  scope: string;
  message: string;
  details?: unknown;
  error?: unknown;
  requestPath?: string;
  method?: string;
  novelId?: string;
  chapterId?: string;
  generationTaskId?: string;
};

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (/api[-_]?key|authorization|password|secret|token/i.test(key)) {
        result[key] = "[已隐藏]";
      } else {
        result[key] = sanitize(item);
      }
    }
    return result;
  }

  return value;
}

function errorStack(error: unknown) {
  return error instanceof Error ? error.stack : undefined;
}

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    };
  }
  return error;
}

export async function writeAppLog(input: LogInput) {
  try {
    await prisma.appLog.create({
      data: {
        level: input.level ?? "info",
        scope: input.scope,
        message: input.message,
        details: sanitize(input.details ?? errorDetails(input.error)) as object,
        stack: errorStack(input.error),
        requestPath: input.requestPath,
        method: input.method,
        novelId: input.novelId,
        chapterId: input.chapterId,
        generationTaskId: input.generationTaskId
      }
    });
  } catch (logWriteError) {
    console.error("写入 AppLog 失败", logWriteError);
  }
}

export async function logError(input: Omit<LogInput, "level">) {
  await writeAppLog({ ...input, level: "error" });
}

export async function logInfo(input: Omit<LogInput, "level">) {
  await writeAppLog({ ...input, level: "info" });
}

export function sanitizeForLog(value: unknown) {
  return sanitize(value);
}
