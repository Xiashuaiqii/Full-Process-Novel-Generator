"use client";

import { cn } from "@/lib/utils";

export type TabItem = {
  value: string;
  label: string;
};

export function TabList({
  tabs,
  value,
  onChange,
  className
}: {
  tabs: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1 rounded-md bg-muted p-1", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={cn(
            "rounded px-3 py-1.5 text-sm transition",
            value === tab.value ? "bg-white font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
