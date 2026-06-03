import { prettyJson } from "@/lib/json";

export function JsonView({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-relaxed text-slate-100">
      {prettyJson(value)}
    </pre>
  );
}
