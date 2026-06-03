"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Edit, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { JsonView } from "@/components/ui/json-view";
import { useToast } from "@/components/ui/toast";
import { apiFetch, reportFrontendError } from "@/services/api";

type Chapter = {
  id: string;
  title: string;
  chapterNo: number;
};

type Proposal = {
  id: string;
  novelId: string;
  chapterId?: string | null;
  proposalType: string;
  action: string;
  targetTable: string;
  targetId?: string | null;
  title?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  reason?: string | null;
  confidence?: number | null;
  status: string;
  createdAt: string;
};

export function ProposalsPage({ novelId }: { novelId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState("pending");
  const [proposalType, setProposalType] = useState("");
  const [chapterId, setChapterId] = useState("");

  const query = useQuery({
    queryKey: ["proposals", novelId, status, proposalType, chapterId],
    queryFn: () => apiFetch<Proposal[]>(`/api/novels/${novelId}/proposals?${params({ status, proposalType, chapterId })}`)
  });

  const chapters = useQuery({
    queryKey: ["chapters", novelId],
    queryFn: () => apiFetch<Chapter[]>(`/api/novels/${novelId}/chapters`)
  });

  const chapterMap = useMemo(() => new Map((chapters.data ?? []).map((chapter) => [chapter.id, chapter])), [chapters.data]);

  const action = useMutation({
    mutationFn: ({ id, type, afterData }: { id: string; type: "accept" | "reject" | "edit-and-accept"; afterData?: unknown }) =>
      apiFetch(`/api/proposals/${id}/${type}`, {
        method: "POST",
        body: type === "edit-and-accept" ? JSON.stringify({ afterData }) : "{}"
      }),
    onSuccess: () => {
      toast({ title: "建议已处理" });
      void queryClient.invalidateQueries({ queryKey: ["proposals", novelId] });
    },
    onError: (error) => {
      reportFrontendError(error, "proposal_review");
      toast({ title: "处理失败", description: error.message, variant: "destructive" });
    }
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">知识库更新审核</h1>
          <p className="mt-1 text-sm text-muted-foreground">AI 只提出建议，正式知识库必须由你审核后写入。</p>
        </div>
        <Link className="inline-flex h-9 items-center rounded-md border bg-white px-3 text-sm hover:bg-muted" href={`/novels/${novelId}`}>返回工作台</Link>
      </div>

      <div className="grid gap-3 rounded-md border bg-white p-3 md:grid-cols-3">
        <select className="h-9 rounded-md border bg-white px-3 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">全部状态</option>
          <option value="pending">pending</option>
          <option value="accepted">accepted</option>
          <option value="rejected">rejected</option>
          <option value="edited">edited</option>
        </select>
        <select className="h-9 rounded-md border bg-white px-3 text-sm" value={proposalType} onChange={(event) => setProposalType(event.target.value)}>
          <option value="">全部类型</option>
          <option value="character">character</option>
          <option value="location">location</option>
          <option value="faction">faction</option>
          <option value="relationship">relationship</option>
          <option value="foreshadowing">foreshadowing</option>
          <option value="item">item</option>
          <option value="timeline">timeline</option>
        </select>
        <select className="h-9 rounded-md border bg-white px-3 text-sm" value={chapterId} onChange={(event) => setChapterId(event.target.value)}>
          <option value="">全部章节</option>
          {chapters.data?.map((chapter) => (
            <option key={chapter.id} value={chapter.id}>第 {chapter.chapterNo} 章 {chapter.title}</option>
          ))}
        </select>
      </div>

      <div className="space-y-3">
        {query.data?.map((proposal) => (
          <ProposalCard
            key={proposal.id}
            proposal={proposal}
            chapterTitle={proposal.chapterId ? chapterMap.get(proposal.chapterId)?.title : undefined}
            loading={action.isPending}
            onAccept={() => action.mutate({ id: proposal.id, type: "accept" })}
            onReject={() => action.mutate({ id: proposal.id, type: "reject" })}
            onEditAccept={(afterData) => action.mutate({ id: proposal.id, type: "edit-and-accept", afterData })}
          />
        ))}
        {query.data?.length === 0 ? <div className="rounded-md border bg-white p-8 text-center text-sm text-muted-foreground">暂无符合条件的建议。</div> : null}
      </div>
    </div>
  );
}

function ProposalCard({
  proposal,
  chapterTitle,
  loading,
  onAccept,
  onReject,
  onEditAccept
}: {
  proposal: Proposal;
  chapterTitle?: string;
  loading: boolean;
  onAccept: () => void;
  onReject: () => void;
  onEditAccept: (afterData: unknown) => void;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{proposal.title || "未命名建议"}</CardTitle>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge>{proposal.proposalType}</Badge>
              <Badge>{proposal.action}</Badge>
              <Badge>{proposal.targetTable}</Badge>
              <Badge>{proposal.status}</Badge>
              {chapterTitle ? <Badge>{chapterTitle}</Badge> : null}
              {proposal.confidence !== null && proposal.confidence !== undefined ? <Badge>置信度 {proposal.confidence}</Badge> : null}
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "收起" : "展开"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{proposal.reason || "无理由"}</p>
        {expanded ? (
          <div className="grid gap-3 xl:grid-cols-2">
            <div>
              <div className="mb-2 text-sm font-medium">beforeData</div>
              <JsonView value={proposal.beforeData} />
            </div>
            <div>
              <div className="mb-2 text-sm font-medium">afterData</div>
              <JsonView value={proposal.afterData} />
            </div>
          </div>
        ) : null}
        {proposal.status === "pending" ? (
          <div className="flex flex-wrap gap-2">
            <Button disabled={loading} size="sm" onClick={onAccept}>
              <Check className="h-4 w-4" />
              接受
            </Button>
            <Button disabled={loading} size="sm" variant="destructive" onClick={onReject}>
              <X className="h-4 w-4" />
              拒绝
            </Button>
            <Button
              disabled={loading}
              size="sm"
              variant="secondary"
              onClick={() => {
                const text = window.prompt("编辑 afterData JSON 后接受", JSON.stringify(proposal.afterData, null, 2));
                if (!text) return;
                try {
                  onEditAccept(JSON.parse(text) as unknown);
                } catch {
                  toast({ title: "JSON 无法解析", variant: "destructive" });
                }
              }}
            >
              <Edit className="h-4 w-4" />
              编辑后接受
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function params(input: Record<string, string>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value) search.set(key, value);
  }
  return search.toString();
}
