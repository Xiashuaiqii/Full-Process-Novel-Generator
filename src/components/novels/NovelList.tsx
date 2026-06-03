"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { apiFetch, reportFrontendError } from "@/services/api";
import { NovelFormDialog, type NovelFormValue } from "@/components/novels/NovelFormDialog";

type Novel = NovelFormValue & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export function NovelList() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Novel | null>(null);

  const novels = useQuery({
    queryKey: ["novels"],
    queryFn: () => apiFetch<Novel[]>("/api/novels")
  });

  const saveMutation = useMutation({
    mutationFn: (value: NovelFormValue) => {
      if (editing) {
        return apiFetch<Novel>(`/api/novels/${editing.id}`, {
          method: "PUT",
          body: JSON.stringify(value)
        });
      }
      return apiFetch<Novel>("/api/novels", {
        method: "POST",
        body: JSON.stringify(value)
      });
    },
    onSuccess: () => {
      toast({ title: "小说已保存" });
      setDialogOpen(false);
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["novels"] });
    },
    onError: (error) => {
      reportFrontendError(error, "novel_save");
      toast({ title: "保存失败", description: error.message, variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/novels/${id}`, {
        method: "DELETE"
      }),
    onSuccess: () => {
      toast({ title: "小说已删除" });
      void queryClient.invalidateQueries({ queryKey: ["novels"] });
    },
    onError: (error) => {
      reportFrontendError(error, "novel_delete");
      toast({ title: "删除失败", description: error.message, variant: "destructive" });
    }
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">小说列表</h1>
          <p className="mt-1 text-sm text-muted-foreground">管理本地小说项目、卷、章节和结构化知识库。</p>
        </div>
        <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4" />
          新建小说
        </Button>
      </div>

      {novels.isLoading ? <div className="text-sm text-muted-foreground">正在加载小说...</div> : null}
      {novels.error ? <div className="text-sm text-red-600">加载失败：{novels.error.message}</div> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {novels.data?.map((novel) => (
          <Card key={novel.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{novel.title}</CardTitle>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge>{novel.genre || "未分类"}</Badge>
                    <Badge>{novel.status === "archived" ? "已归档" : "连载中"}</Badge>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => { setEditing(novel); setDialogOpen(true); }} title="编辑小说">
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="删除小说"
                    onClick={() => {
                      if (confirm(`确认删除《${novel.title}》？该小说下的卷、章节、知识库和日志都会删除。`)) {
                        deleteMutation.mutate(novel.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="line-clamp-3 min-h-[3.75rem] text-sm text-muted-foreground">
                {novel.description || "暂无简介。"}
              </p>
              <div className="mt-4 flex justify-end">
                <Link className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90" href={`/novels/${novel.id}`}>
                  进入工作台
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {novels.data?.length === 0 ? (
        <div className="rounded-md border bg-white p-8 text-center text-sm text-muted-foreground">
          还没有小说，先创建一本。
        </div>
      ) : null}

      <NovelFormDialog
        open={dialogOpen}
        initialValue={editing}
        loading={saveMutation.isPending}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        onSubmit={(value) => saveMutation.mutate(value)}
      />
    </div>
  );
}
