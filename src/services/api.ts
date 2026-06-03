"use client";

export type ApiSuccess<T> = {
  ok: true;
  data: T;
};

export type ApiFailure = {
  ok: false;
  error: string;
};

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const json = (await response.json()) as ApiSuccess<T> | ApiFailure;
  if (!json.ok) {
    throw new Error(json.error);
  }
  return json.data;
}

export function reportFrontendError(error: unknown, scope = "frontend") {
  const message = error instanceof Error ? error.message : String(error);
  void fetch("/api/logs/frontend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      level: "error",
      scope,
      message,
      details: error instanceof Error ? { stack: error.stack, name: error.name } : error
    })
  }).catch(() => undefined);
}
