import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  FolderSearch,
  Grid2X2,
  HardDrive,
  ListTree,
  Search,
  Send,
  Sparkles,
  UserRound,
} from "lucide-react";
import { ActivityPanel } from "../components/cleanup/ActivityPanel";
import { CleanupEmptyState } from "../components/cleanup/CleanupEmptyState";
import {
  InlineMessage,
  PanelTitle,
  PageSurface,
  ResultPanel,
} from "../components/cleanup/PageChrome";
import { MetricCell } from "../components/cleanup/MetricCell";
import { SummaryMetricStrip } from "../components/cleanup/SummaryStrip";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { formatCount, formatSize } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { cn } from "../lib/utils";
import type {
  SpaceAiChatMessage,
  SpaceAiAnalysisRequest,
  SpaceAiAnalysisResult,
  SpaceAiReportItem,
  SpaceScanNode,
  SpaceScanResult,
} from "../types/cleanup";

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

type SpacePageChrome = {
  actions: ReactNode;
  sidebar: ReactNode;
  summary: ReactNode;
};

export function SpaceAnalysisPage({
  active,
  onChromeChange,
  onExitSpace,
}: {
  active: boolean;
  onChromeChange: (chrome: SpacePageChrome | null) => void;
  onExitSpace: () => void;
}) {
  const { locale, t } = useI18n();
  const [result, setResult] = useState<SpaceScanResult | null>(null);
  const [aiResult, setAiResult] = useState<SpaceAiAnalysisResult | null>(null);
  const [aiMessages, setAiMessages] = useState<SpaceAiChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aiScrollRef = useRef<HTMLDivElement | null>(null);

  const busy = scanning || analyzing;
  const canSendAiMessage = Boolean(result && chatInput.trim() && !busy);
  const topItems = useMemo(
    () => (result ? collectTopItems(result.root).slice(0, 8) : []),
    [result],
  );

  const scanPath = useCallback(
    async (path?: string) => {
      if (busy) {
        return;
      }

      setScanning(true);
      setError(null);
      setAiResult(null);
      setAiMessages([]);
      setChatInput("");
      try {
        await waitForNextFrame();
        const request = path
          ? { path, max_depth: 4, max_children: 56 }
          : { max_depth: 4, max_children: 56 };
        const scanResult = await invoke<SpaceScanResult>("scan_directory_space", {
          request,
        });
        setResult(scanResult);
      } catch (scanError) {
        setError(String(scanError));
      } finally {
        setScanning(false);
      }
    },
    [busy],
  );

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          return;
        }
        if (payload.type === "leave") {
          return;
        }
        if (payload.type === "drop") {
          const path = payload.paths[0];
          if (path) {
            void scanPath(path);
          }
        }
      })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [active, scanPath]);

  useEffect(() => {
    const node = aiScrollRef.current;
    if (!node) {
      return;
    }

    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [aiMessages, analyzing]);

  const chooseFolder = useCallback(async () => {
    if (busy) {
      return;
    }

    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: t("space.chooseDialog"),
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (typeof path === "string") {
        await scanPath(path);
      }
    } catch (chooseError) {
      setError(String(chooseError));
    }
  }, [busy, scanPath, t]);

  const sendAiMessage = useCallback(
    async (content: string, options?: { reset?: boolean }) => {
      const trimmed = content.trim();
      if (!result || busy || !trimmed) {
        return;
      }

      const userMessage: SpaceAiChatMessage = {
        role: "user",
        content: trimmed,
      };
      const nextMessages = options?.reset ? [userMessage] : [...aiMessages, userMessage];

      setAiMessages(nextMessages);
      setChatInput("");
      setAnalyzing(true);
      setError(null);
      try {
        await waitForNextFrame();
        const request = buildAiRequest(result, nextMessages);
        const analysis = await invoke<SpaceAiAnalysisResult>("analyze_directory_space", {
          request,
        });
        setAiResult(analysis);
        setAiMessages([
          ...nextMessages,
          {
            role: "assistant",
            content: analysis.content,
          },
        ]);
      } catch (analysisError) {
        setError(String(analysisError));
      } finally {
        setAnalyzing(false);
      }
    },
    [aiMessages, busy, result],
  );

  const analyzeWithAi = useCallback(async () => {
    if (!result || busy) {
      return;
    }

    await sendAiMessage(t("space.ai.initialPrompt"), { reset: true });
  }, [busy, result, sendAiMessage, t]);

  const handleAiSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void sendAiMessage(chatInput);
    },
    [chatInput, sendAiMessage],
  );

  const handleAiKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
        return;
      }

      event.preventDefault();
      void sendAiMessage(chatInput);
    },
    [chatInput, sendAiMessage],
  );

  const aiSubtitle = useMemo(() => {
    if (aiResult) {
      return `${aiResult.provider} · ${aiResult.model}`;
    }

    return result ? t("space.ai.ready") : t("space.ai.pending");
  }, [aiResult, result, t]);

  const toolbarActions = useMemo(
    () => (
      <>
        <Button disabled={busy} onClick={chooseFolder} variant="outline">
          <FolderOpen size={16} />
          {t("space.chooseFolder")}
        </Button>
        <Button disabled={busy} onClick={() => void scanPath()} variant="outline">
          <Search className={scanning ? "animate-spin" : undefined} size={16} />
          {result ? t("actions.rescan") : t("actions.startScan")}
        </Button>
        <Button disabled={!result || busy} onClick={() => void analyzeWithAi()}>
          <Sparkles className={analyzing ? "animate-spin" : undefined} size={16} />
          {analyzing ? t("space.ai.running") : t("space.ai.run")}
        </Button>
        <Button onClick={onExitSpace} variant="outline">
          <Grid2X2 size={16} />
          {t("mode.classic")}
        </Button>
      </>
    ),
    [analyzeWithAi, analyzing, busy, chooseFolder, onExitSpace, result, scanPath, scanning, t],
  );

  const chromeSummary = useMemo(
    () => (
      <SummaryMetricStrip>
        <MetricCell
          icon={HardDrive}
          label={t("space.stat.total")}
          value={formatSize(result?.total_size ?? 0)}
        />
        <MetricCell
          icon={FileText}
          label={t("space.stat.files")}
          value={formatCount(result?.total_files ?? 0, locale)}
        />
        <MetricCell
          icon={Folder}
          label={t("space.tree.items")}
          value={formatCount(result?.inspected_entries ?? 0, locale)}
        />
        <MetricCell
          icon={AlertTriangle}
          label={t("space.stat.unreadable")}
          value={formatCount(result?.unreadable_entries ?? 0, locale)}
        />
      </SummaryMetricStrip>
    ),
    [locale, result, t],
  );

  const sidebar = useMemo(
    () => <SpaceTreeSidebar result={result} scanning={scanning} />,
    [result, scanning],
  );

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    onChromeChange({ actions: toolbarActions, sidebar, summary: chromeSummary });
    return () => onChromeChange(null);
  }, [active, chromeSummary, onChromeChange, sidebar, toolbarActions]);

  return (
    <PageSurface className="flex h-full min-h-0 flex-col gap-3">
      {error ? <InlineMessage kind="error">{error}</InlineMessage> : null}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(300px,0.48fr)] gap-3 max-[1080px]:grid-cols-1">
        <ResultPanel className="flex min-h-0 flex-col overflow-hidden">
          <PanelTitle>
            <div>
              <strong>{t("space.ai.title")}</strong>
              <span>{aiSubtitle}</span>
            </div>
          </PanelTitle>
          <div className="flex min-h-0 flex-1 flex-col">
            <div ref={aiScrollRef} className="min-h-0 flex-1 overflow-auto px-4 py-3">
              {aiMessages.length > 0 ? (
                <div className="grid gap-3">
                  {aiMessages.map((message, index) => (
                    <AiChatBubble
                      key={`${message.role}-${index}-${message.content.length}`}
                      message={message}
                    />
                  ))}
                  {analyzing ? <AiTypingIndicator label={t("space.ai.running")} /> : null}
                </div>
              ) : analyzing ? (
                <ActivityPanel
                  caption={t("space.ai.activity")}
                  icon={Bot}
                  title={t("space.ai.running")}
                />
              ) : (
                <CleanupEmptyState
                  description={t("space.ai.emptyDescription")}
                  icon={Sparkles}
                  title={t("space.ai.emptyTitle")}
                />
              )}
            </div>
            <form
              className="grid grid-cols-[minmax(0,1fr)_36px] items-end gap-2 border-t border-black/5 bg-[#fbfbfa] p-3"
              onSubmit={handleAiSubmit}
            >
              <Textarea
                className="max-h-28 min-h-10 resize-none border-[#d9dedc] bg-white px-3 py-2 text-[13px] leading-relaxed shadow-none"
                disabled={!result || busy}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={handleAiKeyDown}
                placeholder={result ? t("space.ai.inputPlaceholder") : t("space.ai.inputDisabled")}
                rows={2}
                value={chatInput}
              />
              <Button
                aria-label={t("space.ai.send")}
                className="size-9 px-0"
                disabled={!canSendAiMessage}
                title={t("space.ai.send")}
                type="submit"
              >
                <Send size={16} />
              </Button>
            </form>
          </div>
        </ResultPanel>

        <ResultPanel className="flex min-h-0 flex-col overflow-hidden">
          <PanelTitle>
            <div>
              <strong>{t("space.top.title")}</strong>
              <span>{t("space.top.subtitle")}</span>
            </div>
          </PanelTitle>
          <div className="grid min-h-0 flex-1 content-start overflow-auto">
            {topItems.length > 0 ? (
              topItems.map((item) => (
                <div
                  className="grid min-h-[44px] grid-cols-[minmax(0,1fr)_78px] items-center gap-2 border-b border-[#eeeeee] px-4 py-2 last:border-b-0"
                  key={item.path}
                >
                  <div className="min-w-0">
                    <strong className="block overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-[680] text-[#151b22]">
                      {item.name}
                    </strong>
                    <code className="block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10px] text-[#777777]">
                      {item.path}
                    </code>
                  </div>
                  <span className="text-right text-[12px] font-[680] text-[#151b22]">
                    {formatSize(item.size)}
                  </span>
                </div>
              ))
            ) : (
              <div className="px-4 py-5 text-center text-xs text-[#7c8490]">
                {t("empty.scan.notScanned")}
              </div>
            )}
          </div>
        </ResultPanel>
      </div>
    </PageSurface>
  );
}

function AiChatBubble({ message }: { message: SpaceAiChatMessage }) {
  const isUser = message.role === "user";
  const Icon = isUser ? UserRound : Bot;

  return (
    <div
      className={cn(
        "grid items-start gap-2",
        isUser ? "grid-cols-[minmax(0,1fr)_28px]" : "grid-cols-[28px_minmax(0,1fr)]",
      )}
    >
      {!isUser ? (
        <span className="grid size-7 place-items-center rounded-md bg-[#edf1ef] text-[#145c53]">
          <Icon size={15} />
        </span>
      ) : null}
      <div
        className={cn(
          "min-w-0 rounded-lg px-3 py-2 text-[13px] leading-relaxed shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
          isUser
            ? "justify-self-end bg-[#145c53] text-white"
            : "border border-black/5 bg-[#f6f7f6] text-[#2e3640]",
        )}
      >
        <MarkdownMessage content={message.content} inverted={isUser} />
      </div>
      {isUser ? (
        <span className="grid size-7 place-items-center rounded-md bg-[#145c53] text-white">
          <Icon size={15} />
        </span>
      ) : null}
    </div>
  );
}

function MarkdownMessage({
  content,
  inverted = false,
}: {
  content: string;
  inverted?: boolean;
}) {
  return (
    <div className={cn("skiff-markdown", inverted && "skiff-markdown-inverted")}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {content}
      </ReactMarkdown>
    </div>
  );
}

function AiTypingIndicator({ label }: { label: string }) {
  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-2">
      <span className="grid size-7 place-items-center rounded-md bg-[#edf1ef] text-[#145c53]">
        <Bot className="animate-spin" size={15} />
      </span>
      <div className="min-w-0 rounded-lg border border-black/5 bg-[#f6f7f6] px-3 py-2 text-[13px] font-[680] leading-relaxed text-[#69727d]">
        {label}
      </div>
    </div>
  );
}

function SpaceTreeSidebar({
  result,
  scanning,
}: {
  result: SpaceScanResult | null;
  scanning: boolean;
}) {
  const { locale, t } = useI18n();
  const subtitle = scanning
    ? t("common.scanning")
    : result
      ? t("space.tree.summary", {
          count: formatCount(result.inspected_entries, locale),
        })
      : t("empty.scan.notScanned");

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-[#f3f5f7]">
      <div className="flex min-h-[76px] min-w-0 items-center justify-between gap-3 border-b border-black/5 px-4">
        <div className="min-w-0">
          <strong className="block overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-[720] leading-tight text-[#101419]">
            {t("space.tree.title")}
          </strong>
          <span className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-tight text-[#69727d]">
            {subtitle}
          </span>
          <code className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10px] leading-tight text-[#7c8490]">
            {result?.root.path ?? t("space.drop.description")}
          </code>
        </div>
        {result ? (
          <strong className="shrink-0 rounded-md border border-black/5 bg-white px-2 py-1 text-[11px] font-[720] leading-none text-[#151b22]">
            {formatSize(result.total_size)}
          </strong>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-white">
        {scanning ? (
          <ActivityPanel
            caption={t("space.activity.scanning")}
            icon={FolderSearch}
            title={t("space.activity.scanTitle")}
          />
        ) : result ? (
          <SpaceTree root={result.root} totalSize={result.total_size} />
        ) : (
          <CleanupEmptyState
            description={t("space.empty.description")}
            icon={ListTree}
            title={t("space.empty.title")}
          />
        )}
      </div>
    </div>
  );
}

type SpaceTreeRow = {
  node: SpaceScanNode;
  parentSize: number;
};

function SpaceTree({
  root,
  totalSize,
}: {
  root: SpaceScanNode;
  totalSize: number;
}) {
  const { locale, t } = useI18n();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set([root.id]));

  useEffect(() => {
    const next = new Set<string>([root.id]);
    for (const child of root.children.slice(0, 3)) {
      if (child.kind === "directory") {
        next.add(child.id);
      }
    }
    setExpandedIds(next);
  }, [root]);

  const rows = useMemo(() => {
    const next: SpaceTreeRow[] = [];
    collectVisibleNodes(root, expandedIds, next, totalSize || root.size);
    return next;
  }, [expandedIds, root, totalSize]);

  function toggleNode(node: SpaceScanNode) {
    if (node.children.length === 0) {
      return;
    }

    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(node.id)) {
        next.delete(node.id);
      } else {
        next.add(node.id);
      }
      return next;
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid min-h-8 grid-cols-[minmax(120px,1fr)_58px_76px_52px] items-center gap-2 border-b border-[#eeeeee] bg-[#fbfbfa] px-3 text-[11px] font-[680] text-[#7c8490]">
        <span>{t("table.name")}</span>
        <span className="text-right">{t("space.tree.parentPercent")}</span>
        <span className="text-right">{t("inspector.size")}</span>
        <span className="text-right">{t("space.tree.items")}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.map(({ node, parentSize }) => {
          const expanded = expandedIds.has(node.id);
          const percent = parentSize > 0 ? (node.size / parentSize) * 100 : 0;
          const Icon = node.kind === "directory" ? (expanded ? FolderOpen : Folder) : FileText;
          const ToggleIcon = expanded ? ChevronDown : ChevronRight;

          return (
            <button
              className="grid min-h-[38px] grid-cols-[minmax(120px,1fr)_58px_76px_52px] items-center gap-2 border-0 border-b border-[#eeeeee] bg-white px-3 py-1.5 text-left hover:bg-[#fafafa]"
              key={node.id}
              onClick={() => toggleNode(node)}
              type="button"
            >
              <span
                className="grid min-w-0 grid-cols-[16px_22px_minmax(0,1fr)] items-center gap-1.5"
                style={{ paddingLeft: `${Math.min(node.depth, 8) * 14}px` }}
              >
                {node.children.length > 0 ? (
                  <ToggleIcon size={13} strokeWidth={2.1} />
                ) : (
                  <span />
                )}
                <span className="grid size-[22px] place-items-center rounded-md bg-[#f2f5f4] text-[#145c53]">
                  <Icon size={14} strokeWidth={1.9} />
                </span>
                <span className="min-w-0">
                  <strong className="block overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-[680] leading-tight text-[#151b22]">
                    {node.name}
                  </strong>
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-[#eef0ef]">
                    <span
                      className="block h-full rounded-full bg-[#145c53]"
                      style={{ width: `${Math.min(100, Math.max(node.size > 0 ? 2 : 0, percent))}%` }}
                    />
                  </span>
                </span>
              </span>
              <span className="text-right text-[11px] font-[680] text-[#69727d]">
                {formatPercent(percent)}
              </span>
              <span className="text-right text-[12px] font-[700] text-[#151b22]">
                {formatSize(node.size)}
              </span>
              <span className="text-right text-[11px] text-[#69727d]">
                {formatCount(node.kind === "directory" ? node.files + node.dirs : 1, locale)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function collectVisibleNodes(
  node: SpaceScanNode,
  expandedIds: Set<string>,
  rows: SpaceTreeRow[],
  parentSize: number,
) {
  rows.push({ node, parentSize });
  if (!expandedIds.has(node.id)) {
    return;
  }

  for (const child of node.children) {
    collectVisibleNodes(child, expandedIds, rows, node.size);
  }
}

function formatPercent(percent: number) {
  return `${percent.toFixed(1)}%`;
}

function collectTopItems(root: SpaceScanNode): SpaceAiReportItem[] {
  const items = flattenSpaceNodes(root).filter((node) => node.id !== root.id);
  items.sort((left, right) => right.size - left.size);
  return items.map(toAiReportItem);
}

function buildAiRequest(
  result: SpaceScanResult,
  messages: SpaceAiChatMessage[],
): SpaceAiAnalysisRequest {
  return {
    path: result.root.path,
    total_size: result.total_size,
    total_files: result.total_files,
    total_dirs: result.total_dirs,
    unreadable_entries: result.unreadable_entries,
    top_items: collectTopItems(result.root).slice(0, 40),
    messages,
  };
}

function flattenSpaceNodes(root: SpaceScanNode) {
  const nodes: SpaceScanNode[] = [root];
  for (const child of root.children) {
    nodes.push(...flattenSpaceNodes(child));
  }
  return nodes;
}

function toAiReportItem(node: SpaceScanNode): SpaceAiReportItem {
  return {
    name: node.name,
    path: node.path,
    kind: node.kind,
    size: node.size,
    files: node.files,
    dirs: node.dirs,
    depth: node.depth,
  };
}
