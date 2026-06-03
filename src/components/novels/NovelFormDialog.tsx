"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export type NovelFormValue = {
  title: string;
  genre?: string | null;
  theme?: string | null;
  description?: string | null;
  writingStyle?: string | null;
  targetReader?: string | null;
  status: "active" | "archived";
};

const emptyNovel: NovelFormValue = {
  title: "",
  genre: "",
  theme: "",
  description: "",
  writingStyle: "",
  targetReader: "",
  status: "active"
};

export function NovelFormDialog({
  open,
  initialValue,
  onClose,
  onSubmit,
  loading
}: {
  open: boolean;
  initialValue?: NovelFormValue | null;
  onClose: () => void;
  onSubmit: (value: NovelFormValue) => void;
  loading?: boolean;
}) {
  const [form, setForm] = useState<NovelFormValue>(emptyNovel);

  useEffect(() => {
    setForm(initialValue ?? emptyNovel);
  }, [initialValue, open]);

  const update = (key: keyof NovelFormValue, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  return (
    <Dialog open={open} title={initialValue ? "编辑小说" : "新建小说"} onClose={onClose}>
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label>标题</Label>
          <Input value={form.title} onChange={(event) => update("title", event.target.value)} />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="grid gap-2">
            <Label>类型</Label>
            <Input value={form.genre ?? ""} onChange={(event) => update("genre", event.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>主题</Label>
            <Input value={form.theme ?? ""} onChange={(event) => update("theme", event.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>状态</Label>
            <select
              className="h-9 rounded-md border bg-white px-3 text-sm"
              value={form.status}
              onChange={(event) => update("status", event.target.value)}
            >
              <option value="active">连载中</option>
              <option value="archived">已归档</option>
            </select>
          </div>
        </div>
        <div className="grid gap-2">
          <Label>简介</Label>
          <Textarea rows={4} value={form.description ?? ""} onChange={(event) => update("description", event.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label>写作风格</Label>
          <Textarea rows={3} value={form.writingStyle ?? ""} onChange={(event) => update("writingStyle", event.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label>目标读者</Label>
          <Input value={form.targetReader ?? ""} onChange={(event) => update("targetReader", event.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button disabled={loading || !form.title.trim()} onClick={() => onSubmit(form)}>
            {loading ? "保存中" : "保存"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
