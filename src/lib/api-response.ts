import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { logError } from "@/lib/logging";

export type ApiSuccess<T> = {
  ok: true;
  data: T;
};

export type ApiFailure = {
  ok: false;
  error: string;
};

export function ok<T>(data: T, status = 200) {
  return NextResponse.json<ApiSuccess<T>>({ ok: true, data }, { status });
}

export function fail(message: string, status = 400) {
  return NextResponse.json<ApiFailure>({ ok: false, error: message }, { status });
}

function formatZodError(error: ZodError) {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
    .join("；");
}

export async function withApiHandler(
  request: Request,
  scope: string,
  handler: () => Promise<Response>
) {
  try {
    return await handler();
  } catch (error) {
    const message =
      error instanceof ZodError
        ? `请求参数无效：${formatZodError(error)}`
        : error instanceof Error
          ? error.message
          : "未知错误";

    await logError({
      scope,
      message,
      error,
      requestPath: new URL(request.url).pathname,
      method: request.method
    });

    return fail(message, error instanceof ZodError ? 422 : 500);
  }
}
