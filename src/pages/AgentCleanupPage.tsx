import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bot, Clock3, Database, Search, ShieldAlert, Trash2, X } from "lucide-react";
import { ActivityPanel } from "../components/cleanup/ActivityPanel";
import { CleanupEmptyState } from "../components/cleanup/CleanupEmptyState";
import { MetricCell } from "../components/cleanup/MetricCell";
import {
  InlineMessage,
  PanelTitle,
  PageSurface,
  ResultPanel,
} from "../components/cleanup/PageChrome";
import { SummaryMetricStrip } from "../components/cleanup/SummaryStrip";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../components/ui/input-group";
import { formatCount, formatSize } from "../lib/format";
import { useI18n } from "../lib/i18n";
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

function formatDateTime(value: number, locale: "zh-CN" | "en-US", emptyLabel: string) {
  if (!value) {
    return emptyLabel;
  }

  return new Date(value).toLocaleString(locale, {
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
  onChromeChange,
  onCleanupComplete,
  onScanComplete,
}: {
  initialScanResult: AgentThreadScanResult | null;
  onChromeChange: (chrome: { actions: ReactNode; summary: ReactNode } | null) => void;
  onCleanupComplete: (result: AgentCleanupResult) => void;
  onScanComplete: (result: AgentThreadScanResult) => void;
}) {
  const { locale, t } = useI18n();
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
        setError(t("agent.failed"));
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

  const toolbarActions = useMemo(
    () =>
      confirming ? (
        <>
          <Button
            className="h-9 gap-1.5 px-3.5 text-[13px]"
            disabled={cleaning}
            onClick={() => setConfirming(false)}
            variant="outline"
          >
            <X size={16} />
            {t("actions.cancel")}
          </Button>
          <Button
            className="h-9 gap-1.5 px-3.5 text-[13px]"
            disabled={cleaning || selectedIds.length === 0}
            onClick={cleanSelected}
            variant="default"
          >
            <Trash2 className={cleaning ? "animate-spin" : undefined} size={16} />
            {cleaning ? t("common.cleaning") : t("actions.confirmClean")}
          </Button>
        </>
      ) : (
        <>
          <Button
            className="h-9 gap-1.5 px-3.5 text-[13px]"
            disabled={busy}
            onClick={() => void scanThreads()}
            variant="outline"
          >
            <Search className={scanning ? "animate-spin" : undefined} size={16} />
            {threads.length > 0 ? t("actions.rescan") : t("actions.scanAgent")}
          </Button>
          <Button
            className="h-9 gap-1.5 px-3.5 text-[13px]"
            disabled={selectedIds.length === 0 || busy}
            onClick={() => setConfirming(true)}
            variant="default"
          >
            <Trash2 size={16} />
            {t("actions.cleanSelected")}
          </Button>
        </>
      ),
    [busy, cleaning, confirming, scanning, selectedIds, t, threads.length],
  );

  const chromeSummary = useMemo(
    () => (
      <SummaryMetricStrip>
        <MetricCell icon={Bot} label={t("agent.table.session")} value={formatCount(threads.length, locale)} />
        <MetricCell icon={Database} label="Agent" value={formatCount(availableAgents, locale)} />
        <MetricCell icon={Trash2} label={t("summary.selected")} value={formatSize(selectedSize)} />
      </SummaryMetricStrip>
    ),
    [availableAgents, locale, selectedSize, t, threads.length],
  );

  useEffect(() => {
    onChromeChange({ actions: toolbarActions, summary: chromeSummary });
  }, [chromeSummary, onChromeChange, toolbarActions]);

  useEffect(() => () => onChromeChange(null), [onChromeChange]);

  return (
    <PageSurface className="flex h-full min-h-0 flex-col max-[720px]:h-auto">
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
          {t("agent.filter.all")}
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
            placeholder={t("agent.searchPlaceholder")}
            type="search"
            value={query}
          />
        </InputGroup>
      </div>

      {error ? <InlineMessage kind="error">{error}</InlineMessage> : null}

      <ResultPanel className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PanelTitle>
          <div>
            <strong>{t("agent.title")}</strong>
            <span>
              {busy
                ? scanning
                  ? t("common.scanning")
                  : t("common.cleaning")
                : `${formatCount(filteredThreads.length, locale)} ${t("common.items")} · ${formatSize(filteredSize)}`}
            </span>
          </div>
        </PanelTitle>

        {confirming ? (
          <div className="flex min-h-[38px] items-center gap-2 border-b border-[#f1d4b8] bg-[#fff9f2] px-5 text-[13px] text-[#8a4b12]">
            <ShieldAlert size={16} />
            <span>{t("agent.confirm")}</span>
          </div>
        ) : null}

        {busy ? (
          <ActivityPanel
            caption={
              scanning
                ? t("agent.activity.scanning")
                : t("agent.activity.cleaning", {
                    count: formatCount(selectedIds.length, locale),
                  })
            }
            icon={scanning ? Search : Trash2}
            title={scanning ? t("agent.activity.scanningTitle") : t("agent.activity.cleaningTitle")}
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
  const { locale, t } = useI18n();
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
        description={t("agent.empty.description")}
        icon={Bot}
        title={t("agent.empty.title")}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" role="table" aria-label={t("agent.title")}>
      <div
        className={cn(
          pageTableGridClass,
          "min-h-8 border-b border-[#e7e7e7] bg-[#fafafa] px-5 text-[11px] font-bold text-[#6f6f6f]",
          "max-[720px]:[&_span:nth-child(1)]:hidden max-[720px]:[&_span:nth-child(3)]:hidden max-[720px]:[&_span:nth-child(4)]:hidden max-[720px]:[&_span:nth-child(5)]:hidden",
        )}
        role="row"
      >
        <span role="columnheader">{t("agent.table.agent")}</span>
        <span role="columnheader">{t("agent.table.session")}</span>
        <span role="columnheader">{t("agent.table.updated")}</span>
        <span className="text-right" role="columnheader">{t("agent.table.logs")}</span>
        <span className="text-right" role="columnheader">{t("agent.table.size")}</span>
        <span className="flex justify-end" role="columnheader">
          <Checkbox
            aria-label={t("format.selectedItems", { count: t("common.all") })}
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
                  {thread.archived ? t("appData.source.archived") : `${sourceLabel} · ${thread.source}${thread.model ? ` · ${thread.model}` : ""}`}
                </em>
              </span>
              <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap text-xs text-[#555555] max-[720px]:hidden" role="cell">
                <Clock3 size={14} />
                {formatDateTime(thread.updated_at_ms, locale, t("common.unknownTime"))}
              </span>
              <span className="whitespace-nowrap text-right text-xs font-bold text-[#111111] max-[720px]:hidden" role="cell">
                {formatCount(thread.log_count, locale)}
              </span>
              <span className="whitespace-nowrap text-right text-xs font-bold text-[#111111] max-[720px]:hidden" role="cell">
                {formatSize(thread.size)}
              </span>
              <span className="flex justify-end" role="cell">
                <Checkbox
                  aria-label={t("file.select", { name: thread.title })}
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
