import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  FolderSearch,
  Grid2X2,
  HardDrive,
  Info,
  ListTree,
  Loader2,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  UserRound,
  XCircle,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { formatCount, formatSize } from "../lib/format";
import { useI18n, type Locale } from "../lib/i18n";
import { cn } from "../lib/utils";
import type {
  SpaceAiChatMessage,
  SpaceAiAnalysisRequest,
  SpaceAiAnalysisResult,
  SpaceAiPathInfoResult,
  SpaceAiReportItem,
  SpaceAiStreamEvent,
  SpaceAiToolCall,
  SpaceDirectoryDeleteMode,
  SpaceDirectoryDeleteResult,
  SpaceScanNode,
  SpaceScanResult,
} from "../types/cleanup";

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

const SPACE_AI_STREAM_EVENT = "space-ai-stream";
const SPACE_TREE_REFERENCE_MIME = "application/x-skiff-space-tree-reference";
const MAX_AI_CONTEXT_ITEMS = 1200;

type SpacePageChrome = {
  actions: ReactNode;
  sidebar: ReactNode;
  summary: ReactNode;
};

type PendingDirectoryAction = {
  item: SpaceAiReportItem;
  mode: SpaceDirectoryDeleteMode;
};

type SpaceDeleteToolStatus = "pending" | "running" | "done" | "cancelled" | "error";

type SpaceDeleteToolMessage = {
  id: string;
  assistantIndex: number;
  item: SpaceAiReportItem | null;
  path: string;
  mode: SpaceDirectoryDeleteMode;
  reason: string;
  status: SpaceDeleteToolStatus;
  error: string | null;
  result: SpaceDirectoryDeleteResult | null;
  confirmationInput: string;
};

type SpaceReadToolMessage = {
  id: string;
  assistantIndex: number;
  path: string;
  reason: string;
  status: "done" | "error";
  result: SpaceAiPathInfoResult | null;
};

type SpaceAiChatRenderItem =
  | {
      type: "message";
      key: string;
      message: SpaceAiChatMessage;
    }
  | {
      type: "deleteTool";
      key: string;
      tool: SpaceDeleteToolMessage;
    }
  | {
      type: "deleteToolGroup";
      key: string;
      tools: SpaceDeleteToolMessage[];
    }
  | {
      type: "readToolGroup";
      key: string;
      tools: SpaceReadToolMessage[];
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
  const [deleteToolMessages, setDeleteToolMessages] = useState<SpaceDeleteToolMessage[]>([]);
  const [readToolMessages, setReadToolMessages] = useState<SpaceReadToolMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [aiReferencedPaths, setAiReferencedPaths] = useState<string[]>([]);
  const [aiInputDragActive, setAiInputDragActive] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [deletingDirectory, setDeletingDirectory] = useState(false);
  const [pendingDirectoryAction, setPendingDirectoryAction] =
    useState<PendingDirectoryAction | null>(null);
  const [directoryConfirmInput, setDirectoryConfirmInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const aiScrollRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);

  const busy = scanning || analyzing;
  const pageBusy = busy || deletingDirectory;
  const canSendAiMessage = Boolean(result && chatInput.trim() && !pageBusy);
  const topItems = useMemo(
    () => (result ? collectTopItems(result.root).slice(0, 8) : []),
    [result],
  );
  const visibleAiChatItems = useMemo(
    () => buildAiChatRenderItems(aiMessages, deleteToolMessages, readToolMessages),
    [aiMessages, deleteToolMessages, readToolMessages],
  );
  const currentAssistantMessage = [...aiMessages]
    .reverse()
    .find((message) => message.role === "assistant");
  const hasStreamingAssistantContent =
    analyzing && Boolean(currentAssistantMessage?.content.trim());

  const scanPath = useCallback(
    async (path?: string, options?: { force?: boolean; preserveAi?: boolean }) => {
      if (pageBusy && !options?.force) {
        return;
      }

      setScanning(true);
      setError(null);
      if (!options?.preserveAi) {
        setAiResult(null);
        setAiMessages([]);
        setDeleteToolMessages([]);
        setReadToolMessages([]);
        setChatInput("");
        setAiReferencedPaths([]);
      }
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
    [pageBusy],
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
  }, [aiMessages, deleteToolMessages, readToolMessages, analyzing]);

  const chooseFolder = useCallback(async () => {
    if (pageBusy) {
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
  }, [pageBusy, scanPath, t]);

  const appendAgentDeleteToolCall = useCallback(
    (toolCall: SpaceAiToolCall, scanResult: SpaceScanResult, assistantIndex: number) => {
      if (toolCall.name !== "delete_path") {
        return false;
      }

      const item = findScannedItem(scanResult.root, toolCall.arguments.path);
      setDeleteToolMessages((current) => [
        ...current,
        {
          id: createToolMessageId(toolCall),
          assistantIndex,
          item,
          path: toolCall.arguments.path,
          mode: toolCall.arguments.mode === "permanent" ? "permanent" : "trash",
          reason: toolCall.arguments.reason,
          status: item ? "pending" : "error",
          error: item
            ? null
            : t("space.toolDelete.notInScan", { path: toolCall.arguments.path }),
          result: null,
          confirmationInput: "",
        },
      ]);
      return Boolean(item);
    },
    [t],
  );

  const appendAgentReadToolCall = useCallback(
    (toolCall: SpaceAiToolCall, assistantIndex: number) => {
      if (toolCall.name !== "read_path_info") {
        return false;
      }

      const toolResult = toolCall.result;
      setReadToolMessages((current) => [
        ...current,
        {
          id: createToolMessageId(toolCall),
          assistantIndex,
          path: toolCall.arguments.path,
          reason: toolCall.arguments.reason,
          status: toolResult?.error ? "error" : "done",
          result: toolResult,
        },
      ]);
      return true;
    },
    [],
  );

  const sendAiMessage = useCallback(
    async (content: string, options?: { reset?: boolean }) => {
      const trimmed = content.trim();
      if (!result || pageBusy || !trimmed) {
        return;
      }

      const userMessage: SpaceAiChatMessage = {
        role: "user",
        content: trimmed,
      };
      const nextMessages = options?.reset ? [userMessage] : [...aiMessages, userMessage];

      if (options?.reset) {
        setDeleteToolMessages([]);
        setReadToolMessages([]);
        setAiReferencedPaths([]);
      }
      setAiMessages(nextMessages);
      setChatInput("");
      setAnalyzing(true);
      setError(null);
      try {
        await waitForNextFrame();
        const requestReferencedPaths = options?.reset ? [] : aiReferencedPaths;
        const request = buildAiRequest(result, nextMessages, requestReferencedPaths, locale);
        const requestId = createAiStreamRequestId();
        const firstAssistantIndex = nextMessages.length;
        let activeAssistantIndex = firstAssistantIndex;
        let assistantSegmentCount = 0;
        let receivedAnyDelta = false;
        const streamedToolCallKeys = new Set<string>();
        setAiMessages([
          ...nextMessages,
          {
            role: "assistant",
            content: "",
          },
        ]);
        const analysis = await streamAiAnalysis(requestId, request, (event) => {
          if (event.kind === "delta") {
            receivedAnyDelta = true;
            setAiMessages((current) =>
              updateAssistantMessage(
                ensureAssistantMessage(current, activeAssistantIndex),
                activeAssistantIndex,
                (content) => content + event.delta,
              ),
            );
            return;
          }

          if (event.kind === "tool") {
            for (const toolCall of event.tool_calls) {
              streamedToolCallKeys.add(getToolCallKey(toolCall));
              if (toolCall.name === "delete_path") {
                appendAgentDeleteToolCall(toolCall, result, activeAssistantIndex);
              } else if (toolCall.name === "read_path_info") {
                appendAgentReadToolCall(toolCall, activeAssistantIndex);
              }
            }

            assistantSegmentCount += 1;
            activeAssistantIndex = firstAssistantIndex + assistantSegmentCount;
            setAiMessages((current) => ensureAssistantMessage(current, activeAssistantIndex));
            return;
          }

          if (event.kind === "done" && event.result) {
            const pendingToolCalls = event.result.tool_calls.filter(
              (toolCall) => !streamedToolCallKeys.has(getToolCallKey(toolCall)),
            );
            const hasDeleteToolCall = pendingToolCalls.some(
              (toolCall) => toolCall.name === "delete_path",
            );
            const hasReadToolCall = pendingToolCalls.some(
              (toolCall) => toolCall.name === "read_path_info",
            );
            const finalContent =
              event.result.content.trim() ||
              (hasDeleteToolCall
                ? t("space.toolDelete.agentRequested")
                : hasReadToolCall
                  ? t("space.toolRead.agentUsed")
                  : t("space.ai.emptyResponse"));
            setAiResult(event.result);
            if (!receivedAnyDelta) {
              setAiMessages((current) =>
                updateAssistantMessage(
                  ensureAssistantMessage(current, activeAssistantIndex),
                  activeAssistantIndex,
                  () => finalContent,
                ),
              );
            }
            for (const toolCall of pendingToolCalls) {
              if (toolCall.name === "delete_path") {
                appendAgentDeleteToolCall(toolCall, result, activeAssistantIndex);
              } else if (toolCall.name === "read_path_info") {
                appendAgentReadToolCall(toolCall, activeAssistantIndex);
              }
            }
          }
        });
        if (!analysis) {
          setAiMessages((current) =>
            updateAssistantMessage(
              ensureAssistantMessage(current, activeAssistantIndex),
              activeAssistantIndex,
              () => t("space.ai.emptyResponse"),
            ),
          );
        }
      } catch (analysisError) {
        setError(String(analysisError));
      } finally {
        setAnalyzing(false);
      }
    },
    [
      aiMessages,
      aiReferencedPaths,
      appendAgentDeleteToolCall,
      appendAgentReadToolCall,
      pageBusy,
      result,
      locale,
      t,
    ],
  );

  const analyzeWithAi = useCallback(async () => {
    if (!result || pageBusy) {
      return;
    }

    await sendAiMessage(t("space.ai.initialPrompt"), { reset: true });
  }, [pageBusy, result, sendAiMessage, t]);

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

  const handleAiReferenceDragOver = useCallback((event: DragEvent<HTMLTextAreaElement>) => {
    if (!hasSpaceReferenceDragData(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setAiInputDragActive(true);
  }, []);

  const handleAiReferenceDrop = useCallback(
    (event: DragEvent<HTMLTextAreaElement>) => {
      const reference = getSpaceReferenceFromDragEvent(event);
      setAiInputDragActive(false);
      if (!reference) {
        return;
      }

      event.preventDefault();
      setChatInput((current) => appendSpaceReferenceText(current, reference, locale, t));
      setAiReferencedPaths((current) => addUniquePath(current, reference.path));
      requestAnimationFrame(() => chatInputRef.current?.focus());
    },
    [locale, t],
  );

  const openDirectoryAction = useCallback(
    (item: SpaceAiReportItem, mode: SpaceDirectoryDeleteMode) => {
      if (pageBusy) {
        return;
      }

      setDirectoryConfirmInput("");
      setPendingDirectoryAction({ item, mode });
    },
    [pageBusy],
  );

  const closeDirectoryAction = useCallback(() => {
    if (deletingDirectory) {
      return;
    }

    setPendingDirectoryAction(null);
    setDirectoryConfirmInput("");
  }, [deletingDirectory]);

  const confirmDirectoryAction = useCallback(async () => {
    if (!pendingDirectoryAction || !result || deletingDirectory) {
      return;
    }

    const confirmation =
      pendingDirectoryAction.mode === "permanent" ? directoryConfirmInput : null;
    if (
      pendingDirectoryAction.mode === "permanent" &&
      confirmation !== permanentDeleteConfirmation(pendingDirectoryAction.item.path)
    ) {
      return;
    }

    setDeletingDirectory(true);
    setError(null);
    try {
      await waitForNextFrame();
      await invoke<SpaceDirectoryDeleteResult>("delete_space_directory", {
        request: {
          path: pendingDirectoryAction.item.path,
          mode: pendingDirectoryAction.mode,
          confirmation,
        },
      });
      setPendingDirectoryAction(null);
      setDirectoryConfirmInput("");
      await scanPath(result.root.path, { force: true });
    } catch (deleteError) {
      setError(String(deleteError));
    } finally {
      setDeletingDirectory(false);
    }
  }, [
    deletingDirectory,
    directoryConfirmInput,
    pendingDirectoryAction,
    result,
    scanPath,
  ]);

  const updateDeleteToolConfirmation = useCallback((id: string, value: string) => {
    setDeleteToolMessages((current) =>
      current.map((tool) => (tool.id === id ? { ...tool, confirmationInput: value } : tool)),
    );
  }, []);

  const cancelDeleteToolMessage = useCallback((id: string) => {
    setDeleteToolMessages((current) =>
      current.map((tool) =>
        tool.id === id && tool.status === "pending"
          ? { ...tool, status: "cancelled", error: null }
          : tool,
      ),
    );
  }, []);

  const confirmDeleteToolMessage = useCallback(
    async (id: string) => {
      if (!result || deletingDirectory) {
        return;
      }

      const tool = deleteToolMessages.find((message) => message.id === id);
      if (!tool || !tool.item || tool.status !== "pending") {
        return;
      }

      const confirmation =
        tool.mode === "permanent" ? tool.confirmationInput : null;
      if (
        tool.mode === "permanent" &&
        confirmation !== permanentDeleteConfirmation(tool.item.path)
      ) {
        return;
      }

      setDeletingDirectory(true);
      setError(null);
      setDeleteToolMessages((current) =>
        current.map((message) =>
          message.id === id
            ? { ...message, status: "running", error: null, result: null }
            : message,
        ),
      );
      try {
        await waitForNextFrame();
        const deleteResult = await invoke<SpaceDirectoryDeleteResult>("delete_space_directory", {
          request: {
            path: tool.item.path,
            mode: tool.mode,
            confirmation,
          },
        });
        setDeleteToolMessages((current) =>
          current.map((message) =>
            message.id === id
              ? { ...message, status: "done", result: deleteResult, error: null }
              : message,
          ),
        );
        await scanPath(result.root.path, { force: true, preserveAi: true });
      } catch (deleteError) {
        setDeleteToolMessages((current) =>
          current.map((message) =>
            message.id === id
              ? { ...message, status: "error", error: String(deleteError), result: null }
              : message,
          ),
        );
      } finally {
        setDeletingDirectory(false);
      }
    },
    [deleteToolMessages, deletingDirectory, result, scanPath],
  );

  const directoryActionIsPermanent = pendingDirectoryAction?.mode === "permanent";
  const pendingDeleteIsFile = pendingDirectoryAction?.item.kind === "file";
  const directoryConfirmationPhrase = pendingDirectoryAction
    ? permanentDeleteConfirmation(pendingDirectoryAction.item.path)
    : "";
  const canConfirmDirectoryAction =
    Boolean(pendingDirectoryAction) &&
    !deletingDirectory &&
    (!directoryActionIsPermanent || directoryConfirmInput === directoryConfirmationPhrase);

  const aiSubtitle = useMemo(() => {
    if (aiResult) {
      return `${aiResult.provider} · ${aiResult.model}`;
    }

    return result ? t("space.ai.ready") : t("space.ai.pending");
  }, [aiResult, result, t]);

  const toolbarActions = useMemo(
    () => (
      <>
        <Button disabled={pageBusy} onClick={chooseFolder} variant="outline">
          <FolderOpen size={16} />
          {t("space.chooseFolder")}
        </Button>
        <Button disabled={pageBusy} onClick={() => void scanPath()} variant="outline">
          <Search className={scanning ? "animate-spin" : undefined} size={16} />
          {result ? t("actions.rescan") : t("actions.startScan")}
        </Button>
        <Button disabled={!result || pageBusy} onClick={() => void analyzeWithAi()}>
          <Sparkles className={analyzing ? "animate-spin" : undefined} size={16} />
          {analyzing ? t("space.ai.running") : t("space.ai.run")}
        </Button>
        <Button onClick={onExitSpace} variant="outline">
          <Grid2X2 size={16} />
          {t("mode.classic")}
        </Button>
      </>
    ),
    [analyzeWithAi, analyzing, chooseFolder, onExitSpace, pageBusy, result, scanPath, scanning, t],
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
              {visibleAiChatItems.length > 0 ? (
                <div className="grid gap-3">
                  {visibleAiChatItems.map((item) =>
                    item.type === "message" ? (
                      <AiChatBubble key={item.key} message={item.message} />
                    ) : item.type === "readToolGroup" ? (
                      <AiReadToolGroup key={item.key} tools={item.tools} />
                    ) : item.type === "deleteToolGroup" ? (
                      <AiDeleteToolGroup
                        deleting={deletingDirectory}
                        key={item.key}
                        onCancel={cancelDeleteToolMessage}
                        onConfirm={confirmDeleteToolMessage}
                        onConfirmationChange={updateDeleteToolConfirmation}
                        tools={item.tools}
                      />
                    ) : (
                      <AiDeleteToolCard
                        deleting={deletingDirectory}
                        key={item.key}
                        onCancel={cancelDeleteToolMessage}
                        onConfirm={confirmDeleteToolMessage}
                        onConfirmationChange={updateDeleteToolConfirmation}
                        tool={item.tool}
                      />
                    ),
                  )}
                  {analyzing && !hasStreamingAssistantContent ? (
                    <AiTypingIndicator label={t("space.ai.running")} />
                  ) : null}
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
              className="grid shrink-0 grid-cols-[minmax(0,1fr)_36px] items-end gap-2 border-t border-black/5 bg-[#fbfbfa] p-3"
              onSubmit={handleAiSubmit}
            >
              <Textarea
                className={cn(
                  "max-h-28 min-h-10 resize-none border-[#d9dedc] bg-white px-3 py-2 text-[13px] leading-relaxed shadow-none",
                  aiInputDragActive && "border-[#145c53] bg-[#f5fbf8]",
                )}
                disabled={!result || pageBusy}
                onChange={(event) => setChatInput(event.target.value)}
                onDragLeave={() => setAiInputDragActive(false)}
                onDragOver={handleAiReferenceDragOver}
                onDrop={handleAiReferenceDrop}
                onKeyDown={handleAiKeyDown}
                placeholder={result ? t("space.ai.inputPlaceholder") : t("space.ai.inputDisabled")}
                ref={chatInputRef}
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
                  className="grid min-h-[44px] grid-cols-[minmax(0,1fr)_78px_68px] items-center gap-2 border-b border-[#eeeeee] px-4 py-2 last:border-b-0"
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
                  <span className="flex justify-end gap-1">
                    <Button
                      aria-label={t("space.directoryAction.trash")}
                      className="size-7 px-0"
                      disabled={pageBusy}
                      onClick={() => openDirectoryAction(item, "trash")}
                      title={t("space.directoryAction.trash")}
                      variant="outline"
                    >
                      <Trash2 size={13} />
                    </Button>
                    <Button
                      aria-label={t("space.directoryAction.permanent")}
                      className="size-7 px-0"
                      disabled={pageBusy}
                      onClick={() => openDirectoryAction(item, "permanent")}
                      title={t("space.directoryAction.permanent")}
                      variant="destructive"
                    >
                      <ShieldAlert size={13} />
                    </Button>
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

      <Dialog
        open={Boolean(pendingDirectoryAction)}
        onOpenChange={(open) => {
          if (!open) {
            closeDirectoryAction();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {directoryActionIsPermanent
                ? pendingDeleteIsFile
                  ? t("space.pathDelete.permanentFileTitle")
                  : t("space.directoryDelete.permanentTitle")
                : pendingDeleteIsFile
                  ? t("space.pathDelete.trashFileTitle")
                  : t("space.directoryDelete.trashTitle")}
            </DialogTitle>
            <DialogDescription>
              {pendingDirectoryAction
                ? directoryActionIsPermanent
                  ? pendingDeleteIsFile
                    ? t("space.pathDelete.permanentFileDescription", {
                        name: pendingDirectoryAction.item.name,
                        size: formatSize(pendingDirectoryAction.item.size),
                      })
                    : t("space.directoryDelete.permanentDescription", {
                        name: pendingDirectoryAction.item.name,
                        size: formatSize(pendingDirectoryAction.item.size),
                      })
                  : pendingDeleteIsFile
                    ? t("space.pathDelete.trashFileDescription", {
                        name: pendingDirectoryAction.item.name,
                        size: formatSize(pendingDirectoryAction.item.size),
                      })
                    : t("space.directoryDelete.trashDescription", {
                        name: pendingDirectoryAction.item.name,
                        size: formatSize(pendingDirectoryAction.item.size),
                      })
                : ""}
            </DialogDescription>
          </DialogHeader>

          {pendingDirectoryAction ? (
            <div className="grid gap-3">
              <div className="grid gap-1.5 rounded-lg border border-[#efd6b7] bg-[#fffaf2] p-3 text-xs text-[#755118]">
                <div className="flex items-center gap-2 font-semibold">
                  <ShieldAlert size={15} />
                  <span>
                    {directoryActionIsPermanent
                      ? t("space.directoryDelete.permanentWarning")
                      : t("space.directoryDelete.trashWarning")}
                  </span>
                </div>
                <span>
                  {pendingDeleteIsFile
                    ? t("space.pathDelete.fileScope")
                    : t("space.directoryDelete.scope", {
                        files: formatCount(pendingDirectoryAction.item.files, locale),
                        dirs: formatCount(pendingDirectoryAction.item.dirs + 1, locale),
                      })}
                </span>
                <code className="break-all rounded-md bg-white/75 px-2 py-1 font-mono text-[11px]">
                  {pendingDirectoryAction.item.path}
                </code>
              </div>

              {directoryActionIsPermanent ? (
                <div className="grid gap-2">
                  <span className="text-xs font-semibold text-[#3b3f45]">
                    {t("space.directoryDelete.typePhrase")}
                  </span>
                  <code className="break-all rounded-md border border-[#e5e5e5] bg-[#f7f7f7] px-2 py-1 font-mono text-[11px] text-[#111111]">
                    {directoryConfirmationPhrase}
                  </code>
                  <Input
                    aria-label={t("space.directoryDelete.confirmationInput")}
                    disabled={deletingDirectory}
                    onChange={(event) => setDirectoryConfirmInput(event.target.value)}
                    placeholder={t("space.directoryDelete.confirmationInput")}
                    value={directoryConfirmInput}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button disabled={deletingDirectory} onClick={closeDirectoryAction} variant="outline">
              {t("actions.cancel")}
            </Button>
            <Button
              disabled={!canConfirmDirectoryAction}
              onClick={() => void confirmDirectoryAction()}
              variant={directoryActionIsPermanent ? "destructive" : "default"}
            >
              {directoryActionIsPermanent ? (
                <ShieldAlert className={deletingDirectory ? "animate-spin" : undefined} size={15} />
              ) : (
                <Trash2 className={deletingDirectory ? "animate-spin" : undefined} size={15} />
              )}
              {deletingDirectory
                ? directoryActionIsPermanent
                  ? t("common.deleting")
                  : t("common.movingToTrash")
                : directoryActionIsPermanent
                  ? t("space.directoryAction.permanent")
                  : t("space.directoryAction.trash")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageSurface>
  );
}

function AiDeleteToolGroup({
  deleting,
  onCancel,
  onConfirm,
  onConfirmationChange,
  tools,
}: {
  deleting: boolean;
  onCancel: (id: string) => void;
  onConfirm: (id: string) => void;
  onConfirmationChange: (id: string, value: string) => void;
  tools: SpaceDeleteToolMessage[];
}) {
  const { locale, t } = useI18n();
  const [expanded, setExpanded] = useState(true);
  const pendingCount = tools.filter((tool) => tool.status === "pending").length;
  const hasError = tools.some((tool) => tool.status === "error");
  const hasRunning = tools.some((tool) => tool.status === "running");
  const totalSize = tools.reduce((sum, tool) => sum + (tool.item?.size ?? 0), 0);
  const countText = formatCount(tools.length, locale);
  const pendingText = formatCount(pendingCount, locale);
  const groupStatusLabel = getDeleteToolGroupStatusLabel(tools, t);
  const GroupStatusIcon = getDeleteToolGroupStatusIcon(tools);

  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-2">
      <span className="grid size-7 place-items-center rounded-md bg-[#edf1ef] text-[#145c53]">
        <Bot size={15} />
      </span>
      <details
        className="group min-w-0 overflow-hidden rounded-lg border border-[#dfe6e2] bg-[#fbfbfa] text-[13px] text-[#2e3640] shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
        onToggle={(event) => setExpanded(event.currentTarget.open)}
        open={expanded}
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
          <span
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-md",
              hasError ? "bg-[#fff5f3] text-[#b42318]" : "bg-[#edf1ef] text-[#145c53]",
            )}
          >
            {hasError ? <AlertTriangle size={15} /> : <Trash2 size={15} />}
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-[720] leading-tight text-[#151b22]">
              {t("space.toolDelete.groupTitle", { count: countText })}
            </strong>
            <span className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-tight text-[#69727d]">
              {t("space.toolDelete.groupMeta", {
                pending: pendingText,
                size: formatSize(totalSize),
              })}
            </span>
          </span>
          <span
            className={cn(
              "inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] font-[680]",
              hasError
                ? "border-[#f2c9c3] bg-[#fff5f3] text-[#b42318]"
                : "border-[#d9dedc] bg-white text-[#69727d]",
            )}
          >
            <GroupStatusIcon
              className={hasRunning ? "animate-spin" : undefined}
              size={13}
            />
            {groupStatusLabel}
          </span>
          <ChevronDown
            className="shrink-0 text-[#69727d] transition-transform group-open:rotate-180"
            size={15}
          />
        </summary>

        <div className="max-h-[460px] overflow-auto border-t border-[#e7ece9] bg-white">
          {tools.map((tool) => (
            <AiDeleteToolRow
              deleting={deleting}
              key={tool.id}
              onCancel={onCancel}
              onConfirm={onConfirm}
              onConfirmationChange={onConfirmationChange}
              tool={tool}
            />
          ))}
        </div>
      </details>
    </div>
  );
}

function AiDeleteToolRow({
  deleting,
  onCancel,
  onConfirm,
  onConfirmationChange,
  tool,
}: {
  deleting: boolean;
  onCancel: (id: string) => void;
  onConfirm: (id: string) => void;
  onConfirmationChange: (id: string, value: string) => void;
  tool: SpaceDeleteToolMessage;
}) {
  const { locale, t } = useI18n();
  const isPermanent = tool.mode === "permanent";
  const isFile = tool.item?.kind === "file";
  const confirmationPhrase = permanentDeleteConfirmation(tool.path);
  const canConfirm =
    Boolean(tool.item) &&
    tool.status === "pending" &&
    !deleting &&
    (!isPermanent || tool.confirmationInput === confirmationPhrase);
  const actionLabel = isPermanent
    ? t("space.directoryAction.permanent")
    : t("space.directoryAction.trash");
  const statusLabel = getDeleteToolStatusLabel(tool.status, t);
  const StatusIcon = getDeleteToolStatusIcon(tool.status);

  return (
    <div className="grid gap-2 border-t border-[#eef1ef] px-3 py-2.5 text-xs leading-relaxed text-[#4f5965] first:border-t-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 max-[720px]:grid-cols-1">
        <div className="grid min-w-0 gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5 font-[680] text-[#151b22]">
              {isPermanent ? (
                <ShieldAlert className="text-[#b42318]" size={13} />
              ) : (
                <Trash2 className="text-[#145c53]" size={13} />
              )}
              {actionLabel}
            </span>
            {tool.item ? (
              <span className="font-[680] text-[#151b22]">{formatSize(tool.item.size)}</span>
            ) : null}
            {tool.item ? (
              <span>
                {isFile
                  ? t("space.pathDelete.fileScope")
                  : t("space.directoryDelete.scope", {
                      files: formatCount(tool.item.files, locale),
                      dirs: formatCount(tool.item.dirs + 1, locale),
                    })}
              </span>
            ) : null}
            <span
              className={cn(
                "inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[10px] font-[680]",
                tool.status === "pending" && "border-[#d9dedc] bg-[#fbfbfa] text-[#69727d]",
                tool.status === "running" && "border-[#cde5dc] bg-[#eef8f4] text-[#145c53]",
                tool.status === "done" && "border-[#cde5dc] bg-[#eef8f4] text-[#145c53]",
                tool.status === "cancelled" && "border-[#e2e5e9] bg-[#f6f7f8] text-[#69727d]",
                tool.status === "error" && "border-[#f2c9c3] bg-[#fff5f3] text-[#b42318]",
              )}
            >
              <StatusIcon
                className={tool.status === "running" ? "animate-spin" : undefined}
                size={11}
              />
              {statusLabel}
            </span>
          </div>

          {tool.reason ? (
            <span>
              {t("space.toolDelete.agentReason", {
                reason: tool.reason,
              })}
            </span>
          ) : null}
          <code className="break-all rounded-md border border-[#ecefed] bg-[#fbfbfa] px-2 py-1 font-mono text-[11px] text-[#151b22]">
            {tool.path}
          </code>

          {tool.result ? (
            <span className="font-[680] text-[#145c53]">
              {t("space.toolDelete.result", {
                size: formatSize(tool.result.released_size),
              })}
            </span>
          ) : null}
          {tool.error ? (
            <span className="font-[680] text-[#b42318]">{tool.error}</span>
          ) : null}

          {isPermanent && tool.status === "pending" && tool.item ? (
            <div className="grid gap-2">
              <span className="text-xs font-semibold text-[#3b3f45]">
                {t("space.toolDelete.permanentNeedsPhrase")}
              </span>
              <code className="break-all rounded-md border border-[#e5e5e5] bg-[#f7f7f7] px-2 py-1 font-mono text-[11px] text-[#111111]">
                {confirmationPhrase}
              </code>
              <Input
                aria-label={t("space.directoryDelete.confirmationInput")}
                className="h-8 bg-white text-xs"
                disabled={deleting}
                onChange={(event) => onConfirmationChange(tool.id, event.target.value)}
                placeholder={t("space.directoryDelete.confirmationInput")}
                value={tool.confirmationInput}
              />
            </div>
          ) : null}
        </div>

        {tool.status === "pending" ? (
          <div className="flex shrink-0 justify-end gap-2">
            <Button
              className="h-8 px-2 text-xs"
              disabled={deleting}
              onClick={() => onCancel(tool.id)}
              variant="outline"
            >
              <XCircle size={13} />
              {t("space.toolDelete.cancel")}
            </Button>
            <Button
              className="h-8 px-2 text-xs"
              disabled={!canConfirm}
              onClick={() => onConfirm(tool.id)}
              variant={isPermanent ? "destructive" : "default"}
            >
              {isPermanent ? <ShieldAlert size={13} /> : <Trash2 size={13} />}
              {t("space.toolDelete.confirm")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AiDeleteToolCard({
  deleting,
  onCancel,
  onConfirm,
  onConfirmationChange,
  tool,
}: {
  deleting: boolean;
  onCancel: (id: string) => void;
  onConfirm: (id: string) => void;
  onConfirmationChange: (id: string, value: string) => void;
  tool: SpaceDeleteToolMessage;
}) {
  const { locale, t } = useI18n();
  const isPermanent = tool.mode === "permanent";
  const isFile = tool.item?.kind === "file";
  const confirmationPhrase = permanentDeleteConfirmation(tool.path);
  const canConfirm =
    Boolean(tool.item) &&
    tool.status === "pending" &&
    !deleting &&
    (!isPermanent || tool.confirmationInput === confirmationPhrase);
  const actionLabel = isPermanent
    ? t("space.directoryAction.permanent")
    : t("space.directoryAction.trash");
  const statusLabel = getDeleteToolStatusLabel(tool.status, t);
  const StatusIcon = getDeleteToolStatusIcon(tool.status);

  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-2">
      <span className="grid size-7 place-items-center rounded-md bg-[#edf1ef] text-[#145c53]">
        <Bot size={15} />
      </span>
      <div className="min-w-0 rounded-lg border border-[#dfe6e2] bg-white px-3 py-3 text-[13px] text-[#2e3640] shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-md",
                isPermanent
                  ? "bg-[#fff1f0] text-[#b42318]"
                  : "bg-[#edf1ef] text-[#145c53]",
              )}
            >
              {isPermanent ? <ShieldAlert size={15} /> : <Trash2 size={15} />}
            </span>
            <div className="min-w-0">
              <strong className="block text-[13px] font-[720] leading-tight text-[#151b22]">
                {t("space.toolDelete.title")}
              </strong>
              <span className="mt-1 block text-xs leading-tight text-[#69727d]">
                {t("space.toolDelete.deletePath")} · {actionLabel}
              </span>
            </div>
          </div>

          <span
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] font-[680]",
              tool.status === "pending" && "border-[#d9dedc] bg-[#fbfbfa] text-[#69727d]",
              tool.status === "running" && "border-[#cde5dc] bg-[#eef8f4] text-[#145c53]",
              tool.status === "done" && "border-[#cde5dc] bg-[#eef8f4] text-[#145c53]",
              tool.status === "cancelled" && "border-[#e2e5e9] bg-[#f6f7f8] text-[#69727d]",
              tool.status === "error" && "border-[#f2c9c3] bg-[#fff5f3] text-[#b42318]",
            )}
          >
            <StatusIcon
              className={tool.status === "running" ? "animate-spin" : undefined}
              size={13}
            />
            {statusLabel}
          </span>
        </div>

        <div className="mt-3 grid gap-2 text-xs leading-relaxed text-[#4f5965]">
          <span>
            {t("space.toolDelete.agentReason", {
              reason: tool.reason || t("common.none"),
            })}
          </span>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-[680] text-[#151b22]">{actionLabel}</span>
            {tool.item ? (
              <span className="font-[680] text-[#151b22]">{formatSize(tool.item.size)}</span>
            ) : null}
            {tool.item ? (
              <span>
                {isFile
                  ? t("space.pathDelete.fileScope")
                  : t("space.directoryDelete.scope", {
                      files: formatCount(tool.item.files, locale),
                      dirs: formatCount(tool.item.dirs + 1, locale),
                    })}
              </span>
            ) : null}
          </div>
          <code className="break-all rounded-md border border-[#ecefed] bg-[#fbfbfa] px-2 py-1 font-mono text-[11px] text-[#151b22]">
            {tool.path}
          </code>
          {tool.result ? (
            <span className="font-[680] text-[#145c53]">
              {t("space.toolDelete.result", {
                size: formatSize(tool.result.released_size),
              })}
            </span>
          ) : null}
          {tool.error ? (
            <span className="font-[680] text-[#b42318]">{tool.error}</span>
          ) : null}
        </div>

        {isPermanent && tool.status === "pending" && tool.item ? (
          <div className="mt-3 grid gap-2">
            <span className="text-xs font-semibold text-[#3b3f45]">
              {t("space.toolDelete.permanentNeedsPhrase")}
            </span>
            <code className="break-all rounded-md border border-[#e5e5e5] bg-[#f7f7f7] px-2 py-1 font-mono text-[11px] text-[#111111]">
              {confirmationPhrase}
            </code>
            <Input
              aria-label={t("space.directoryDelete.confirmationInput")}
              className="h-8 bg-white text-xs"
              disabled={deleting}
              onChange={(event) => onConfirmationChange(tool.id, event.target.value)}
              placeholder={t("space.directoryDelete.confirmationInput")}
              value={tool.confirmationInput}
            />
          </div>
        ) : null}

        {tool.status === "pending" ? (
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button
              className="h-8 px-2 text-xs"
              disabled={deleting}
              onClick={() => onCancel(tool.id)}
              variant="outline"
            >
              <XCircle size={13} />
              {t("space.toolDelete.cancel")}
            </Button>
            <Button
              className="h-8 px-2 text-xs"
              disabled={!canConfirm}
              onClick={() => onConfirm(tool.id)}
              variant={isPermanent ? "destructive" : "default"}
            >
              {isPermanent ? <ShieldAlert size={13} /> : <Trash2 size={13} />}
              {t("space.toolDelete.confirm")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AiReadToolGroup({ tools }: { tools: SpaceReadToolMessage[] }) {
  const { locale, t } = useI18n();
  const failedCount = tools.filter(hasReadToolError).length;
  const countText = formatCount(tools.length, locale);
  const failedText = formatCount(failedCount, locale);
  const hasError = failedCount > 0;
  const [expanded, setExpanded] = useState(hasError);

  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-2">
      <span className="grid size-7 place-items-center rounded-md bg-[#edf1ef] text-[#145c53]">
        <Bot size={15} />
      </span>
      <details
        className="group min-w-0 overflow-hidden rounded-lg border border-[#dfe6e2] bg-[#fbfbfa] text-[13px] text-[#2e3640] shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
        onToggle={(event) => setExpanded(event.currentTarget.open)}
        open={expanded}
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
          <span
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-md",
              hasError ? "bg-[#fff5f3] text-[#b42318]" : "bg-[#edf1ef] text-[#145c53]",
            )}
          >
            {hasError ? <AlertTriangle size={15} /> : <Info size={15} />}
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-[720] leading-tight text-[#151b22]">
              {hasError
                ? t("space.toolRead.groupTitleWithErrors", {
                    count: countText,
                    errors: failedText,
                  })
                : t("space.toolRead.groupTitle", { count: countText })}
            </strong>
            <span className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-tight text-[#69727d]">
              {t("space.toolRead.groupDescription")}
            </span>
          </span>
          <span
            className={cn(
              "inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] font-[680]",
              hasError
                ? "border-[#f2c9c3] bg-[#fff5f3] text-[#b42318]"
                : "border-[#cde5dc] bg-[#eef8f4] text-[#145c53]",
            )}
          >
            {hasError ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
            {hasError ? t("space.toolRead.statusError") : t("space.toolRead.statusDone")}
          </span>
          <ChevronDown
            className="shrink-0 text-[#69727d] transition-transform group-open:rotate-180"
            size={15}
          />
        </summary>

        <div className="max-h-[360px] overflow-auto border-t border-[#e7ece9] bg-white">
          {tools.map((tool) => (
            <AiReadToolDetail key={tool.id} tool={tool} />
          ))}
        </div>
      </details>
    </div>
  );
}

function AiReadToolDetail({ tool }: { tool: SpaceReadToolMessage }) {
  const { locale, t } = useI18n();
  const item = tool.result?.item ?? null;
  const children = tool.result?.children ?? [];
  const hasError = hasReadToolError(tool);
  const ItemIcon = item?.kind === "directory" ? Folder : FileText;

  return (
    <div className="grid gap-2 border-t border-[#eef1ef] px-3 py-2.5 text-xs leading-relaxed text-[#4f5965] first:border-t-0">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          {hasError ? (
            <AlertTriangle className="shrink-0 text-[#b42318]" size={13} />
          ) : (
            <CheckCircle2 className="shrink-0 text-[#145c53]" size={13} />
          )}
          <span className="overflow-hidden text-ellipsis whitespace-nowrap font-[680] text-[#151b22]">
            {item?.name ?? t("space.toolRead.readPathInfo")}
          </span>
        </span>
        {item ? (
          <span className="shrink-0 font-[680] text-[#151b22]">{formatSize(item.size)}</span>
        ) : null}
      </div>

      <div className="grid gap-2">
        {tool.reason ? (
          <span>
            {t("space.toolRead.agentReason", {
              reason: tool.reason,
            })}
          </span>
        ) : null}
        <code className="break-all rounded-md border border-[#ecefed] bg-[#fbfbfa] px-2 py-1 font-mono text-[11px] text-[#151b22]">
          {tool.path}
        </code>

        {item ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1 font-[680] text-[#151b22]">
              <ItemIcon size={13} />
              {item.name}
            </span>
            <span>
              {item.kind === "file"
                ? t("space.pathDelete.fileScope")
                : t("space.directoryDelete.scope", {
                    files: formatCount(item.files, locale),
                    dirs: formatCount(item.dirs + 1, locale),
                  })}
            </span>
          </div>
        ) : null}

        {children.length > 0 ? (
          <div className="grid gap-1">
            <span className="font-[680] text-[#151b22]">
              {t("space.toolRead.children", {
                count: formatCount(children.length, locale),
              })}
            </span>
            <div className="grid gap-1">
              {children.slice(0, 4).map((child) => {
                const ChildIcon = child.kind === "directory" ? Folder : FileText;
                return (
                  <div
                    className="grid grid-cols-[minmax(0,1fr)_72px] items-center gap-2"
                    key={child.path}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <ChildIcon className="shrink-0 text-[#69727d]" size={13} />
                      <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                        {child.name}
                      </span>
                    </span>
                    <span className="text-right font-[680] text-[#151b22]">
                      {formatSize(child.size)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {tool.result?.error ? (
          <span className="font-[680] text-[#b42318]">{tool.result.error}</span>
        ) : null}
      </div>
    </div>
  );
}

function hasReadToolError(tool: SpaceReadToolMessage) {
  return tool.status === "error" || Boolean(tool.result?.error);
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

function getDeleteToolStatusLabel(
  status: SpaceDeleteToolStatus,
  t: ReturnType<typeof useI18n>["t"],
) {
  switch (status) {
    case "pending":
      return t("space.toolDelete.statusPending");
    case "running":
      return t("space.toolDelete.statusRunning");
    case "done":
      return t("space.toolDelete.statusDone");
    case "cancelled":
      return t("space.toolDelete.statusCancelled");
    case "error":
      return t("space.toolDelete.statusError");
  }
}

function getDeleteToolStatusIcon(status: SpaceDeleteToolStatus) {
  switch (status) {
    case "running":
      return Loader2;
    case "done":
      return CheckCircle2;
    case "cancelled":
      return XCircle;
    case "error":
      return AlertTriangle;
    case "pending":
      return ShieldAlert;
  }
}

function getDeleteToolGroupStatusLabel(
  tools: SpaceDeleteToolMessage[],
  t: ReturnType<typeof useI18n>["t"],
) {
  if (tools.some((tool) => tool.status === "error")) {
    return t("space.toolDelete.statusError");
  }
  if (tools.some((tool) => tool.status === "running")) {
    return t("space.toolDelete.statusRunning");
  }
  if (tools.some((tool) => tool.status === "pending")) {
    return t("space.toolDelete.statusPending");
  }
  if (tools.every((tool) => tool.status === "cancelled")) {
    return t("space.toolDelete.statusCancelled");
  }
  return t("space.toolDelete.statusDone");
}

function getDeleteToolGroupStatusIcon(tools: SpaceDeleteToolMessage[]) {
  if (tools.some((tool) => tool.status === "error")) {
    return AlertTriangle;
  }
  if (tools.some((tool) => tool.status === "running")) {
    return Loader2;
  }
  if (tools.some((tool) => tool.status === "pending")) {
    return ShieldAlert;
  }
  if (tools.every((tool) => tool.status === "cancelled")) {
    return XCircle;
  }
  return CheckCircle2;
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
      <div className="grid min-h-8 w-full grid-cols-[minmax(220px,1fr)_70px_90px_64px] items-center gap-2 border-b border-[#eeeeee] bg-[#fbfbfa] px-3 text-[11px] font-[680] text-[#7c8490] [font-variant-numeric:tabular-nums]">
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
              className="grid min-h-[38px] w-full grid-cols-[minmax(220px,1fr)_70px_90px_64px] items-center gap-2 border-0 border-b border-[#eeeeee] bg-white px-3 py-1.5 text-left hover:bg-[#fafafa] [font-variant-numeric:tabular-nums]"
              draggable
              key={node.id}
              onDragStart={(event) => handleSpaceTreeNodeDragStart(event, node)}
              onClick={() => toggleNode(node)}
              type="button"
            >
              <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                <span
                  className="shrink-0"
                  style={{ width: `${Math.min(node.depth, 8) * 14}px` }}
                />
                {node.children.length > 0 ? (
                  <ToggleIcon className="shrink-0" size={13} strokeWidth={2.1} />
                ) : (
                  <span className="size-[13px] shrink-0" />
                )}
                <span className="grid size-[22px] shrink-0 place-items-center rounded-md bg-[#f2f5f4] text-[#145c53]">
                  <Icon size={14} strokeWidth={1.9} />
                </span>
                <span className="min-w-0 flex-1">
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

function handleSpaceTreeNodeDragStart(
  event: DragEvent<HTMLButtonElement>,
  node: SpaceScanNode,
) {
  const item = toAiReportItem(node);
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData(SPACE_TREE_REFERENCE_MIME, JSON.stringify(item));
  event.dataTransfer.setData("text/plain", item.path);
}

function hasSpaceReferenceDragData(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes(SPACE_TREE_REFERENCE_MIME);
}

function getSpaceReferenceFromDragEvent(
  event: DragEvent<HTMLElement>,
): SpaceAiReportItem | null {
  const raw = event.dataTransfer.getData(SPACE_TREE_REFERENCE_MIME);
  if (!raw) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return isSpaceAiReportItem(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isSpaceAiReportItem(value: unknown): value is SpaceAiReportItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Partial<SpaceAiReportItem>;
  return (
    typeof item.name === "string" &&
    typeof item.path === "string" &&
    (item.kind === "directory" || item.kind === "file") &&
    typeof item.size === "number" &&
    typeof item.files === "number" &&
    typeof item.dirs === "number" &&
    typeof item.depth === "number"
  );
}

function appendSpaceReferenceText(
  current: string,
  item: SpaceAiReportItem,
  locale: ReturnType<typeof useI18n>["locale"],
  t: ReturnType<typeof useI18n>["t"],
) {
  const referenceText = buildSpaceReferenceText(item, locale, t);
  const base = current.trimEnd();
  return base ? `${base}\n${referenceText}` : referenceText;
}

function buildSpaceReferenceText(
  item: SpaceAiReportItem,
  locale: ReturnType<typeof useI18n>["locale"],
  t: ReturnType<typeof useI18n>["t"],
) {
  if (item.kind === "file") {
    return t("space.ai.referenceFile", {
      name: item.name,
      size: formatSize(item.size),
      path: item.path,
    });
  }

  return t("space.ai.referenceDirectory", {
    name: item.name,
    size: formatSize(item.size),
    files: formatCount(item.files, locale),
    dirs: formatCount(item.dirs + 1, locale),
    path: item.path,
  });
}

function addUniquePath(paths: string[], path: string) {
  return paths.includes(path) ? paths : [...paths, path];
}

function buildAiChatRenderItems(
  messages: SpaceAiChatMessage[],
  deleteToolMessages: SpaceDeleteToolMessage[],
  readToolMessages: SpaceReadToolMessage[],
): SpaceAiChatRenderItem[] {
  const deleteToolsByAssistantIndex = new Map<number, SpaceDeleteToolMessage[]>();
  for (const tool of deleteToolMessages) {
    const tools = deleteToolsByAssistantIndex.get(tool.assistantIndex) ?? [];
    tools.push(tool);
    deleteToolsByAssistantIndex.set(tool.assistantIndex, tools);
  }

  const readToolsByAssistantIndex = new Map<number, SpaceReadToolMessage[]>();
  for (const tool of readToolMessages) {
    const tools = readToolsByAssistantIndex.get(tool.assistantIndex) ?? [];
    tools.push(tool);
    readToolsByAssistantIndex.set(tool.assistantIndex, tools);
  }

  const items: SpaceAiChatRenderItem[] = [];
  messages.forEach((message, index) => {
    if (message.role === "user" || message.content.trim().length > 0) {
      items.push({
        type: "message",
        key: `${message.role}-${index}-${message.content.length}`,
        message,
      });
    }

    const readTools = readToolsByAssistantIndex.get(index) ?? [];
    if (readTools.length > 0) {
      items.push({
        type: "readToolGroup",
        key: `read-tools-${index}-${readTools.map((tool) => tool.id).join("-")}`,
        tools: readTools,
      });
    }

    const deleteTools = deleteToolsByAssistantIndex.get(index) ?? [];
    appendDeleteToolRenderItems(items, index, deleteTools);
  });

  for (const [assistantIndex, tools] of readToolsByAssistantIndex) {
    if (assistantIndex >= messages.length && tools.length > 0) {
      items.push({
        type: "readToolGroup",
        key: `read-tools-${assistantIndex}-${tools.map((tool) => tool.id).join("-")}`,
        tools,
      });
    }
  }

  for (const [assistantIndex, tools] of deleteToolsByAssistantIndex) {
    if (assistantIndex >= messages.length) {
      appendDeleteToolRenderItems(items, assistantIndex, tools);
    }
  }

  return items;
}

function appendDeleteToolRenderItems(
  items: SpaceAiChatRenderItem[],
  assistantIndex: number,
  tools: SpaceDeleteToolMessage[],
) {
  if (tools.length === 0) {
    return;
  }

  if (tools.length === 1) {
    const [tool] = tools;
    items.push({
      type: "deleteTool",
      key: `delete-tool-${tool.id}`,
      tool,
    });
    return;
  }

  items.push({
    type: "deleteToolGroup",
    key: `delete-tools-${assistantIndex}-${tools.map((tool) => tool.id).join("-")}`,
    tools,
  });
}

function findScannedItem(root: SpaceScanNode, path: string): SpaceAiReportItem | null {
  const normalizedPath = path.trim();
  if (!normalizedPath) {
    return null;
  }

  const match = flattenSpaceNodes(root).find((node) => node.path === normalizedPath);
  return match ? toAiReportItem(match) : null;
}

function buildAiRequest(
  result: SpaceScanResult,
  messages: SpaceAiChatMessage[],
  referencedPaths: string[],
  locale: Locale,
): SpaceAiAnalysisRequest {
  return {
    locale,
    path: result.root.path,
    total_size: result.total_size,
    total_files: result.total_files,
    total_dirs: result.total_dirs,
    unreadable_entries: result.unreadable_entries,
    top_items: collectTopItems(result.root).slice(0, 40),
    items: collectAiContextItems(result.root, referencedPaths),
    messages,
  };
}

function collectAiContextItems(
  root: SpaceScanNode,
  referencedPaths: string[],
): SpaceAiReportItem[] {
  const nodes = flattenSpaceNodes(root);
  const referencedPathSet = new Set(referencedPaths);
  const selected = new Map<string, SpaceAiReportItem>();

  for (const node of nodes.slice(0, MAX_AI_CONTEXT_ITEMS)) {
    const item = toAiReportItem(node);
    selected.set(item.path, item);
  }

  for (const node of nodes) {
    if (!referencedPathSet.has(node.path) && !hasReferencedParent(node.path, referencedPathSet)) {
      continue;
    }

    const item = toAiReportItem(node);
    selected.set(item.path, item);
  }

  return Array.from(selected.values());
}

function hasReferencedParent(path: string, referencedPaths: Set<string>) {
  return referencedPaths.has(parentPath(path));
}

function parentPath(path: string) {
  const normalized = path.replace(/[/\\]+$/, "");
  const slashIndex = normalized.lastIndexOf("/");
  const backslashIndex = normalized.lastIndexOf("\\");
  const index = Math.max(slashIndex, backslashIndex);
  return index > 0 ? normalized.slice(0, index) : "";
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

function permanentDeleteConfirmation(path: string) {
  return `DELETE ${path}`;
}

function createAiStreamRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createToolMessageId(toolCall: SpaceAiToolCall) {
  const base = toolCall.id.trim() || toolCall.name;
  return `${base}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getToolCallKey(toolCall: SpaceAiToolCall) {
  return `${toolCall.name}:${toolCall.id}:${toolCall.arguments.path}`;
}

function ensureAssistantMessage(messages: SpaceAiChatMessage[], index: number) {
  const next = [...messages];
  while (next.length <= index) {
    next.push({ role: "assistant", content: "" });
  }

  if (next[index]?.role !== "assistant") {
    next[index] = { role: "assistant", content: "" };
  }

  return next;
}

function updateAssistantMessage(
  messages: SpaceAiChatMessage[],
  index: number,
  update: (content: string) => string,
) {
  return messages.map((message, currentIndex) =>
    currentIndex === index && message.role === "assistant"
      ? { ...message, content: update(message.content) }
      : message,
  );
}

function streamAiAnalysis(
  requestId: string,
  request: SpaceAiAnalysisRequest,
  onEvent: (event: SpaceAiStreamEvent) => void,
) {
  return new Promise<SpaceAiAnalysisResult | null>((resolve, reject) => {
    let settled = false;
    let unlisten: (() => void) | null = null;

    function finish(callback: () => void) {
      if (settled) {
        return;
      }
      settled = true;
      unlisten?.();
      callback();
    }

    listen<SpaceAiStreamEvent>(SPACE_AI_STREAM_EVENT, ({ payload }) => {
      if (payload.request_id !== requestId) {
        return;
      }

      if (payload.kind === "delta" || payload.kind === "tool") {
        onEvent(payload);
        return;
      }

      if (payload.kind === "done") {
        onEvent(payload);
        finish(() => resolve(payload.result));
        return;
      }

      finish(() => reject(new Error(payload.error ?? "AI stream failed")));
    })
      .then((nextUnlisten) => {
        unlisten = nextUnlisten;
        return invoke("stream_directory_space_analysis", {
          requestId,
          request,
        });
      })
      .then(() => {
        if (!settled) {
          finish(() => resolve(null));
        }
      })
      .catch((error) => {
        finish(() => reject(error));
      });
  });
}
