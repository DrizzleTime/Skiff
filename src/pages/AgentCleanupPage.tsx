import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bot, Clock3, Database, Search, ShieldAlert, Trash2 } from "lucide-react";
import { ActivityPanel } from "../components/cleanup/ActivityPanel";
import { CleanupEmptyState } from "../components/cleanup/CleanupEmptyState";
import {
  InlineMessage,
  PanelTitle,
  PageSurface,
  ResultPanel,
  StatGrid,
  ToolStrip,
} from "../components/cleanup/PageChrome";
import { StatCard } from "../components/cleanup/StatCard";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../components/ui/input-group";
import { formatCount, formatSize } from "../lib/format";
import { cn } from "../lib/utils";
import type {
  AgentCleanupResult,
  AgentProviderStatus,
  AgentThread,
  AgentThreadScanResult,
} from "../types/cleanup";

const agentFallbackLabels: Record<string, string> = {
  codex: "Codex",
};

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function formatDateTime(value: number) {
  if (!value) {
    return "未知时间";
  }

  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const searchGroupClass =
  "h-10 gap-2.5 rounded-lg border-[#dddddd] bg-white px-3 shadow-none";
const pageTableGridClass =
  "grid grid-cols-[88px_minmax(220px,1fr)_148px_78px_86px_34px] items-center gap-3 max-[720px]:grid-cols-[minmax(0,1fr)_32px]";

function agentLabel(agent: string, labels: Record<string, string>) {
  return labels[agent] ?? agentFallbackLabels[agent] ?? agent;
}

export function AgentCleanupPage({
  initialScanResult,
  onCleanupComplete,
  onScanComplete,
}: {
  initialScanResult: AgentThreadScanResult | null;
  onCleanupComplete: (result: AgentCleanupResult) => void;
  onScanComplete: (result: AgentThreadScanResult) => void;
}) {
  const [threads, setThreads] = useState<AgentThread[]>(
    () => initialScanResult?.threads ?? [],
  );
  const [agents, setAgents] = useState<AgentProviderStatus[]>(
    () => initialScanResult?.agents ?? [],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [agentFilter, setAgentFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agentLabels = useMemo(
    () => Object.fromEntries(agents.map((agent) => [agent.id, agent.name])),
    [agents],
  );

  const filteredThreads = useMemo(() => {
    const keyword = query.trim().toLowerCase();

    return threads.filter((thread) => {
      const matchesAgent = agentFilter === "all" || thread.agent === agentFilter;
      const matchesQuery =
        keyword.length === 0 ||
        thread.title.toLowerCase().includes(keyword) ||
        thread.cwd.toLowerCase().includes(keyword) ||
        thread.id.toLowerCase().includes(keyword) ||
        thread.source.toLowerCase().includes(keyword) ||
        agentLabel(thread.agent, agentLabels).toLowerCase().includes(keyword);

      return matchesAgent && matchesQuery;
    });
  }, [agentFilter, agentLabels, query, threads]);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedSize = useMemo(
    () =>
      threads.reduce(
        (sum, thread) => sum + (selectedIdSet.has(thread.id) ? thread.size : 0),
        0,
      ),
    [selectedIdSet, threads],
  );
  const filteredSize = useMemo(
    () => filteredThreads.reduce((sum, thread) => sum + thread.size, 0),
    [filteredThreads],
  );
  const totalLogs = useMemo(
    () => threads.reduce((sum, thread) => sum + thread.log_count, 0),
    [threads],
  );
  const availableAgents = useMemo(
    () => agents.filter((agent) => agent.available).length,
    [agents],
  );
  const busy = scanning || cleaning;

  async function scanThreads() {
    if (busy) {
      return;
    }

    setScanning(true);
    setConfirming(false);
    setError(null);

    try {
      await waitForNextFrame();
      const result = await invoke<AgentThreadScanResult>("scan_agent_threads");
      setThreads(result.threads);
      setAgents(result.agents);
      setSelectedIds([]);
      onScanComplete(result);
    } catch (scanError) {
      setError(String(scanError));
    } finally {
      setScanning(false);
    }
  }

  async function cleanSelected() {
    if (selectedIds.length === 0 || busy) {
      return;
    }

    setCleaning(true);
    setError(null);

    try {
      await waitForNextFrame();
      const result = await invoke<AgentCleanupResult>("clean_agent_threads", {
        request: { ids: selectedIds },
      });
      const removed = new Set(
        result.items.filter((item) => item.success).map((item) => item.id),
      );
      setThreads((current) => current.filter((thread) => !removed.has(thread.id)));
      setSelectedIds([]);
      setConfirming(false);
      onCleanupComplete(result);

      if (result.failed_count > 0) {
        setError("部分 Agent 会话清理失败。");
      }
    } catch (cleanError) {
      setError(String(cleanError));
    } finally {
      setCleaning(false);
    }
  }

  function toggleThread(id: string) {
    if (busy) {
      return;
    }

    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
    setConfirming(false);
  }

  function toggleFilteredThreads(checked: boolean) {
    if (busy) {
      return;
    }

    if (checked) {
      setSelectedIds((current) => {
        const next = new Set(current);
        filteredThreads.forEach((thread) => next.add(thread.id));
        return Array.from(next);
      });
    } else {
      const filteredIds = new Set(filteredThreads.map((thread) => thread.id));
      setSelectedIds((current) => current.filter((id) => !filteredIds.has(id)));
    }

    setConfirming(false);
  }

  return (
    <PageSurface className="flex h-full min-h-0 flex-col max-[720px]:h-auto">
      <ToolStrip className="mb-3 min-h-9">
        <p>扫描本地 Agent 会话，按来源筛选并精确删除会话记录、日志和索引。</p>
        <Button disabled={busy} onClick={() => void scanThreads()} variant="outline">
          <Search className={scanning ? "animate-spin" : undefined} size={16} />
          {threads.length > 0 ? "重新扫描" : "扫描 Agent"}
        </Button>
      </ToolStrip>

      <StatGrid className="mb-3">
        <StatCard icon={Bot} label="会话" value={formatCount(threads.length)} caption={`${formatCount(totalLogs)} 条日志`} />
        <StatCard icon={Database} label="Agent" value={formatCount(availableAgents)} caption="当前可扫描" />
        <StatCard icon={Trash2} label="已选择" value={formatSize(selectedSize)} caption={`${formatCount(selectedIds.length)} 个会话`} />
      </StatGrid>

      <div className="mb-2.5 flex flex-wrap items-center gap-2 max-[720px]:items-start">
        <button
          className={cn(
            "min-h-[30px] rounded-full border px-3.5 text-xs font-semibold",
            agentFilter === "all"
              ? "border-[#111111] bg-[#111111] text-white"
              : "border-[#dedede] bg-white text-[#333333]",
            "disabled:text-[#9a9a9a] disabled:opacity-60",
          )}
          disabled={busy}
          onClick={() => setAgentFilter("all")}
          type="button"
        >
          全部
        </button>
        {agents.map((agent) => (
          <button
            className={cn(
              "min-h-[30px] rounded-full border px-3.5 text-xs font-semibold",
              agentFilter === agent.id
                ? "border-[#111111] bg-[#111111] text-white"
                : "border-[#dedede] bg-white text-[#333333]",
              "disabled:text-[#9a9a9a] disabled:opacity-60",
            )}
            disabled={!agent.available || busy}
            key={agent.id}
            onClick={() => setAgentFilter(agent.id)}
            type="button"
          >
            {agent.name}
          </button>
        ))}
      </div>

      <div className="mb-3">
        <InputGroup className={searchGroupClass}>
          <InputGroupAddon>
            <Search size={16} />
          </InputGroupAddon>
          <InputGroupInput
            className="h-10 px-0 text-[13px]"
            disabled={busy}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索来源、标题、目录或会话 ID"
            type="search"
            value={query}
          />
        </InputGroup>
      </div>

      {error ? <InlineMessage kind="error">{error}</InlineMessage> : null}

      <ResultPanel className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PanelTitle
          actions={
            confirming ? (
              <div className="flex gap-2">
                <Button
                  className="h-8 px-3 text-[13px]"
                  disabled={cleaning}
                  onClick={() => setConfirming(false)}
                  variant="outline"
                >
                  取消
                </Button>
                <Button
                  className="h-8 gap-1.5 px-3 text-[13px]"
                  disabled={cleaning}
                  onClick={cleanSelected}
                  variant="destructive"
                >
                  <Trash2 className={cleaning ? "animate-spin" : undefined} size={16} />
                  {cleaning ? "清理中" : "确认清理"}
                </Button>
              </div>
            ) : (
              <Button
                className="h-8 gap-1.5 rounded-md px-3 text-[13px]"
                disabled={selectedIds.length === 0 || busy}
                onClick={() => setConfirming(true)}
                variant="default"
              >
                <Trash2 size={16} />
                清理所选
              </Button>
            )
          }
        >
          <div>
            <strong>Agent 会话</strong>
            <span>
              {busy ? (scanning ? "扫描中" : "清理中") : `${filteredThreads.length} 项 · ${formatSize(filteredSize)}`}
            </span>
          </div>
        </PanelTitle>

        {confirming ? (
          <div className="flex min-h-[38px] items-center gap-2 border-b border-[#f1d4b8] bg-[#fff9f2] px-5 text-[13px] text-[#8a4b12]">
            <ShieldAlert size={16} />
            <span>将删除所选 Agent 会话正文、线程记录、日志、目标记录和索引行。</span>
          </div>
        ) : null}

        {busy ? (
          <ActivityPanel
            caption={
              scanning
                ? "正在读取本地 Agent 会话索引"
                : `正在清理 ${selectedIds.length} 个已确认会话`
            }
            icon={scanning ? Search : Trash2}
            title={scanning ? "正在扫描 Agent 会话" : "正在清理 Agent 会话"}
          />
        ) : (
          <AgentThreadRows
            agentLabels={agentLabels}
            onToggleAll={toggleFilteredThreads}
            onToggleThread={toggleThread}
            selectedIdSet={selectedIdSet}
            threads={filteredThreads}
          />
        )}
      </ResultPanel>
    </PageSurface>
  );
}

function AgentThreadRows({
  agentLabels,
  onToggleAll,
  onToggleThread,
  selectedIdSet,
  threads,
}: {
  agentLabels: Record<string, string>;
  onToggleAll: (checked: boolean) => void;
  onToggleThread: (id: string) => void;
  selectedIdSet: Set<string>;
  threads: AgentThread[];
}) {
  const selectAllRef = useRef<HTMLInputElement>(null);
  const selectedVisibleCount = threads.filter((thread) =>
    selectedIdSet.has(thread.id),
  ).length;
  const allVisibleSelected =
    threads.length > 0 && selectedVisibleCount === threads.length;
  const partiallyVisibleSelected =
    selectedVisibleCount > 0 && !allVisibleSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = partiallyVisibleSelected;
    }
  }, [partiallyVisibleSelected]);

  if (threads.length === 0) {
    return (
      <CleanupEmptyState
        description="扫描后会显示本机 Agent 保存的会话记录。"
        icon={Bot}
        title="暂无 Agent 会话"
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" role="table" aria-label="Agent 会话">
      <div
        className={cn(
          pageTableGridClass,
          "min-h-8 border-b border-[#e7e7e7] bg-[#fafafa] px-5 text-[11px] font-bold text-[#6f6f6f]",
          "max-[720px]:[&_span:nth-child(1)]:hidden max-[720px]:[&_span:nth-child(3)]:hidden max-[720px]:[&_span:nth-child(4)]:hidden max-[720px]:[&_span:nth-child(5)]:hidden",
        )}
        role="row"
      >
        <span role="columnheader">来源</span>
        <span role="columnheader">会话</span>
        <span role="columnheader">更新时间</span>
        <span className="text-right" role="columnheader">日志</span>
        <span className="text-right" role="columnheader">大小</span>
        <span className="flex justify-end" role="columnheader">
          <Checkbox
            aria-label="选择当前列表全部 Agent 会话"
            checked={allVisibleSelected}
            onChange={(event) => onToggleAll(event.target.checked)}
            ref={selectAllRef}
          />
        </span>
      </div>

      <div className="min-h-0 overflow-auto">
        {threads.map((thread) => {
          const checked = selectedIdSet.has(thread.id);
          const sourceLabel = agentLabel(thread.agent, agentLabels);

          return (
            <label
              aria-selected={checked}
              className={cn(
                pageTableGridClass,
                "min-h-[64px] w-full cursor-pointer border-0 border-b border-[#eeeeee] bg-white px-5 py-2 text-left [content-visibility:auto] [contain-intrinsic-size:64px] hover:bg-[#fafafa]",
                checked && "bg-[#f7f7f7] shadow-[inset_3px_0_0_#181818]",
              )}
              key={thread.id}
              role="row"
            >
              <span className="inline-flex min-h-[22px] w-fit min-w-[52px] items-center justify-center rounded-full bg-[#f0f0f0] text-[11px] font-bold text-[#222222] max-[720px]:hidden" role="cell">
                {sourceLabel}
              </span>
              <span className="grid min-w-0 gap-1" role="cell">
                <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-[720] text-[#111111]">
                  {thread.title}
                </strong>
                <code className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] text-[#707070]">
                  {thread.cwd}
                </code>
                <em className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] not-italic text-[#777777]">
                  {thread.archived ? "已归档" : `${sourceLabel} · ${thread.source}${thread.model ? ` · ${thread.model}` : ""}`}
                </em>
              </span>
              <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap text-xs text-[#555555] max-[720px]:hidden" role="cell">
                <Clock3 size={14} />
                {formatDateTime(thread.updated_at_ms)}
              </span>
              <span className="whitespace-nowrap text-right text-xs font-bold text-[#111111] max-[720px]:hidden" role="cell">
                {formatCount(thread.log_count)}
              </span>
              <span className="whitespace-nowrap text-right text-xs font-bold text-[#111111] max-[720px]:hidden" role="cell">
                {formatSize(thread.size)}
              </span>
              <span className="flex justify-end" role="cell">
                <Checkbox
                  aria-label={`选择${thread.title}`}
                  checked={checked}
                  onChange={() => onToggleThread(thread.id)}
                />
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
