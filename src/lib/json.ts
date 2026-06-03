export function safeJsonParse<T>(
  value: string
): { ok: true; data: T } | { ok: false; error: string } {
  try {
    return { ok: true, data: JSON.parse(value) as T };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "JSON 解析失败"
    };
  }
}

export function truncateForDisplay(value: string, maxLength = 1000) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

export function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}
