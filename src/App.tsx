import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { AppSidebar } from "./components/cleanup/AppSidebar";
import { DiskStatusPanel } from "./components/cleanup/DiskStatusPanel";
import { SummaryStrip } from "./components/cleanup/SummaryStrip";
import { TargetInspector } from "./components/cleanup/TargetInspector";
import { Toolbar } from "./components/cleanup/Toolbar";
import { WindowTitlebar } from "./components/WindowTitlebar";
import { formatSize, formatTime } from "./lib/format";
import { isJunkCleanupView } from "./lib/cleanup";
import { useI18n } from "./lib/i18n";
import { cn } from "./lib/utils";
import { AboutPage } from "./pages/AboutPage";
import { AgentCleanupPage } from "./pages/AgentCleanupPage";
import { ApplicationCleanupPage } from "./pages/ApplicationCleanupPage";
import { DuplicateFilesPage } from "./pages/DuplicateFilesPage";
import { EnvironmentPage } from "./pages/EnvironmentPage";
import { HistoryPage } from "./pages/HistoryPage";
import { JunkCleanupPage } from "./pages/JunkCleanupPage";
import { LargeFilesPage } from "./pages/LargeFilesPage";
import { OverviewPage } from "./pages/OverviewPage";
import { SettingsPage } from "./pages/SettingsPage";
import type {
  ActiveView,
  AgentCleanupResult,
  AgentThreadScanResult,
  AppInfo,
  CleanupProgressPayload,
  CleanupRunMode,
  CleanupRunRecord,
  CleanupRunResult,
  CleanupScanResult,
  CleanupTarget,
  DeleteFilesResult,
  DiskStatus,
  AppSettings,
  PackageScanResult,
  PackageUninstallResult,
  RunState,
} from "./types/cleanup";
import "./App.css";

const CLEANUP_PROGRESS_EVENT = "cleanup-progress";
const HISTORY_STORAGE_KEY = "skiff.cleanupHistory.v1";
const MAX_HISTORY_RECORDS = 50;

type PageChromeConfig = {
  actions: ReactNode;
  summary: ReactNode;
} | null;

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function getInitialAppPlatform(): AppInfo["platform"] {
  const platform = window.navigator.platform.toLowerCase();
  const userAgent = window.navigator.userAgent.toLowerCase();

  if (platform.includes("mac") || userAgent.includes("mac os")) {
    return "macos";
  }

  if (platform.includes("win") || userAgent.includes("windows")) {
    return "windows";
  }

  return "linux";
}

function shouldShowCleanupTarget(target: CleanupTarget) {
  return target.cleanable || Boolean(target.error) || target.size > 0 || target.files > 0;
}

function readCleanupHistory(): CleanupRunRecord[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const records = JSON.parse(raw);
    if (!Array.isArray(records)) {
      return [];
    }

    return records
      .filter((record): record is CleanupRunRecord =>
        typeof record?.id === "string" &&
        typeof record?.created_at === "number" &&
        ["clean", "trash", "uninstall", "agent"].includes(record?.mode) &&
        Array.isArray(record?.items) &&
        typeof record?.released_size === "number" &&
        typeof record?.deleted_files === "number" &&
        typeof record?.failed_count === "number",
      )
      .slice(0, MAX_HISTORY_RECORDS);
  } catch {
    return [];
  }
}

function persistCleanupHistory(records: CleanupRunRecord[]) {
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // History is useful for audit, but cleanup should not fail because local storage is unavailable.
  }
}

function App() {
  const { locale, t } = useI18n();
  const [activeView, setActiveView] = useState<ActiveView>("overview");
  const [targets, setTargets] = useState<CleanupTarget[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [runState, setRunState] = useState<RunState>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [diskStatus, setDiskStatus] = useState<DiskStatus | null>(null);
  const [diskError, setDiskError] = useState<string | null>(null);
  const [historyRecords, setHistoryRecords] =
    useState<CleanupRunRecord[]>(readCleanupHistory);
  const [agentCleanupSize, setAgentCleanupSize] = useState(0);
  const [applicationCleanupSize, setApplicationCleanupSize] = useState(0);
  const [agentScanResult, setAgentScanResult] = useState<AgentThreadScanResult | null>(null);
  const [packageScanResult, setPackageScanResult] = useState<PackageScanResult | null>(null);
  const [packageScanIncludesSystem, setPackageScanIncludesSystem] = useState(false);
  const [showAdvancedFeatures, setShowAdvancedFeatures] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [appPlatform, setAppPlatform] = useState<AppInfo["platform"]>(getInitialAppPlatform);
  const [pageChrome, setPageChrome] = useState<PageChromeConfig>(null);
  const updatePageChrome = useCallback((next: PageChromeConfig) => {
    setPageChrome(next);
  }, []);

  useEffect(() => {
    void refreshDiskStatus();
    void refreshAppInfo();
    void refreshAppSettings();
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlistenProgress: (() => void) | null = null;

    void listen<CleanupProgressPayload>(CLEANUP_PROGRESS_EVENT, ({ payload }) => {
      setProgress(payload.percent);
    })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }

        unlistenProgress = unlisten;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlistenProgress?.();
    };
  }, []);

  const visibleTargets = useMemo(() => {
    if (isJunkCleanupView(activeView)) {
      return targets.filter(shouldShowCleanupTarget);
    }

    return [];
  }, [activeView, targets]);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const selectedTarget =
    visibleTargets.find((target) => target.id === selectedTargetId) ??
    visibleTargets[0] ??
    null;

  const targetSummary = useMemo(() => {
    let totalSize = 0;
    let totalFiles = 0;
    let selectedSize = 0;
    let selectedFiles = 0;
    let availableCount = 0;

    for (const target of targets) {
      totalSize += target.size;
      totalFiles += target.files;
      if (target.cleanable) {
        availableCount += 1;
      }
      if (selectedIdSet.has(target.id)) {
        selectedSize += target.size;
        selectedFiles += target.files;
      }
    }

    return {
      availableCount,
      selectedFiles,
      selectedSize,
      totalFiles,
      totalSize,
    };
  }, [selectedIdSet, targets]);
  const { availableCount, selectedFiles, selectedSize, totalFiles, totalSize } =
    targetSummary;
  const releaseRatio = totalSize > 0 ? (selectedSize / totalSize) * 100 : 0;
  const busy = runState === "scanning" || runState === "cleaning";
  const cleanupView = isJunkCleanupView(activeView);
  const showInspector = cleanupView;
  const canClean = cleanupView && selectedIds.length > 0 && !busy && runState !== "idle";
  const lastRun = historyRecords[0] ?? null;
  const lastCleanupAt = lastRun ? new Date(lastRun.created_at) : null;

  async function refreshDiskStatus() {
    try {
      const result = await invoke<DiskStatus>("get_disk_status");
      setDiskStatus(result);
      setDiskError(null);
    } catch (error) {
      setDiskError(String(error));
    }
  }

  async function refreshAppInfo() {
    try {
      const result = await invoke<AppInfo>("get_app_info");
      setAppVersion(result.version);
      setAppPlatform(result.platform);
    } catch {
      setAppVersion(null);
    }
  }

  async function refreshAppSettings() {
    try {
      const settings = await invoke<AppSettings>("get_settings");
      setShowAdvancedFeatures(settings.show_advanced_features);
    } catch {
      setShowAdvancedFeatures(false);
    }
  }

  async function scanTargets() {
    setRunState("scanning");
    setProgress(0);
    setErrorMessage(null);

    try {
      await waitForNextFrame();
      const result = await invoke<CleanupScanResult>("scan_cleanup_targets");
      setTargets(result.targets);
      setSelectedIds(
        result.targets
          .filter((target) => target.risk === "safe" && target.cleanable)
          .map((target) => target.id),
      );
      setSelectedTargetId(result.targets.find(shouldShowCleanupTarget)?.id ?? null);
      await refreshDiskStatus();
      setRunState("ready");
      setProgress(100);
    } catch (error) {
      setRunState("error");
      setProgress(0);
      setErrorMessage(String(error));
    }
  }

  function requestCleanup() {
    if (!canClean) {
      return;
    }

    setRunState("confirming");
  }

  function cancelCleanup() {
    setRunState("ready");
  }

  function recordRun(result: CleanupRunResult, mode: CleanupRunMode) {
    const record: CleanupRunRecord = {
      ...result,
      id: `${Date.now()}-${mode}`,
      mode,
      created_at: Date.now(),
    };

    setHistoryRecords((current) => {
      const next = [record, ...current].slice(0, MAX_HISTORY_RECORDS);
      persistCleanupHistory(next);
      return next;
    });
  }

  async function confirmCleanup() {
    if (selectedIds.length === 0) {
      return;
    }

    setRunState("cleaning");
    setProgress(0);
    setErrorMessage(null);

    try {
      await waitForNextFrame();
      const result = await invoke<CleanupRunResult>("run_cleanup", {
        request: { ids: selectedIds },
      });
      recordRun(result, "clean");
      setTargets((current) =>
        current.map((target) => {
          const itemResult = result.items.find((item) => item.id === target.id);
          if (!itemResult?.success) {
            return target;
          }

          return {
            ...target,
            cleanable: false,
            size: 0,
            files: 0,
            error: null,
          };
        }),
      );
      setSelectedIds([]);
      setRunState(result.failed_count > 0 ? "error" : "done");
      setProgress(100);
      setActiveView("history");
      await refreshDiskStatus();

      if (result.failed_count > 0) {
        setErrorMessage(t("history.failedStatus"));
      }
    } catch (error) {
      setRunState("error");
      setProgress(0);
      setErrorMessage(String(error));
    }
  }

  function toggleTarget(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((selectedId) => selectedId !== id)
        : [...current, id],
    );

    if (runState === "confirming") {
      setRunState("ready");
    }
  }

  function selectView(view: ActiveView) {
    setActiveView(view);
    setPageChrome(null);
    if (isJunkCleanupView(view)) {
      setSelectedTargetId(targets.find(shouldShowCleanupTarget)?.id ?? null);
      return;
    }

    setSelectedTargetId(null);
  }

  function sizeForView(view: ActiveView) {
    if (view === "overview") {
      return "";
    }

    if (isJunkCleanupView(view)) {
      return targets.length > 0 ? formatSize(totalSize) : "";
    }

    if (view === "agent") {
      return agentCleanupSize > 0 ? formatSize(agentCleanupSize) : "";
    }

    if (view === "developer") {
      return applicationCleanupSize > 0 ? formatSize(applicationCleanupSize) : "";
    }

    if (view === "history") {
      return lastRun ? t("history.row.processed", { count: lastRun.items.length }) : "";
    }

    return "";
  }

  function handleFileDeleteComplete(result: DeleteFilesResult) {
    const runResult: CleanupRunResult = {
      items: result.items.map((item) => ({
        id: item.path,
        name: item.path.split("/").pop() || t("common.file"),
        path: item.path,
        released_size: item.released_size,
        deleted_files: item.success ? 1 : 0,
        success: item.success,
        error: item.error,
      })),
      released_size: result.released_size,
      deleted_files: result.deleted_files,
      failed_count: result.failed_count,
    };

    recordRun(runResult, "trash");
    setActiveView("history");
    void refreshDiskStatus();
  }

  function handlePackageUninstallComplete(result: PackageUninstallResult) {
    const runResult: CleanupRunResult = {
      items: result.items.map((item) => ({
        id: item.id,
        name: item.name,
        path: item.manager,
        released_size: item.released_size,
        deleted_files: item.success ? 1 : 0,
        success: item.success,
        error: item.error,
      })),
      released_size: result.released_size,
      deleted_files: result.removed_count,
      failed_count: result.failed_count,
    };

    recordRun(runResult, "uninstall");
    setApplicationCleanupSize((current) => Math.max(0, current - result.released_size));
    setPackageScanResult((current) => {
      if (!current) {
        return current;
      }

      const removed = new Set(
        result.items.filter((item) => item.success).map((item) => item.id),
      );
      const packages = current.packages.filter((item) => !removed.has(item.id));

      return {
        ...current,
        packages,
        total_count: packages.length,
        total_size: packages.reduce((sum, item) => sum + item.size, 0),
      };
    });
    setActiveView("history");
    void refreshDiskStatus();
  }

  function handleAgentCleanupComplete(result: AgentCleanupResult) {
    const runResult: CleanupRunResult = {
      items: result.items.map((item) => ({
        id: item.id,
        name: item.title,
        path: item.path,
        released_size: item.released_size,
        deleted_files: item.success ? 1 : 0,
        success: item.success,
        error: item.error,
      })),
      released_size: result.released_size,
      deleted_files: result.deleted_threads,
      failed_count: result.failed_count,
    };

    recordRun(runResult, "agent");
    setAgentCleanupSize((current) => Math.max(0, current - result.released_size));
    setAgentScanResult((current) => {
      if (!current) {
        return current;
      }

      const removed = new Set(
        result.items.filter((item) => item.success).map((item) => item.id),
      );
      const threads = current.threads.filter((thread) => !removed.has(thread.id));

      return {
        ...current,
        threads,
        total_logs: threads.reduce((sum, thread) => sum + thread.log_count, 0),
        total_size: threads.reduce((sum, thread) => sum + thread.size, 0),
      };
    });
    setActiveView("history");
    void refreshDiskStatus();
  }

  function handleAgentScanComplete(result: AgentThreadScanResult) {
    setAgentScanResult(result);
    setAgentCleanupSize(result.total_size);
  }

  function handlePackageScanComplete(result: PackageScanResult, includeSystem: boolean) {
    setPackageScanResult(result);
    setPackageScanIncludesSystem(includeSystem);
    setApplicationCleanupSize(result.total_size);
  }

  const sharedPageProps = {
    availableCount,
    onSelectTarget: setSelectedTargetId,
    onToggleTarget: toggleTarget,
    runState,
    selectedCount: selectedIds.length,
    selectedIdSet,
    selectedTargetId: selectedTarget?.id ?? null,
    targets: visibleTargets,
  };

  const messageText = errorMessage ?? diskError;
  const useSystemTitlebar = appPlatform === "macos";

  return (
    <main
      className={cn(
        "grid h-full w-full overflow-hidden max-[720px]:h-auto max-[720px]:min-h-screen max-[720px]:overflow-visible",
        useSystemTitlebar
          ? "skiff-system-titlebar grid-rows-[minmax(0,1fr)] bg-[#f3f5f7] max-[720px]:grid-rows-[auto]"
          : "grid-rows-[40px_minmax(0,1fr)] rounded-2xl border border-black/10 bg-[#f3f5f7] shadow-[0_24px_80px_rgba(15,23,42,0.16)] max-[720px]:grid-rows-[40px_auto] max-[720px]:rounded-none max-[720px]:border-0 max-[720px]:shadow-none",
      )}
    >
      {useSystemTitlebar ? null : <WindowTitlebar />}

      <div
        className={cn(
          "grid min-h-0 min-w-0 grid-cols-[232px_minmax(0,1fr)] overflow-hidden bg-[#f7f8f6] max-[720px]:grid-cols-1 max-[720px]:overflow-visible",
          useSystemTitlebar
            ? "bg-[#f3f5f7] max-[720px]:min-h-screen"
            : "max-[720px]:min-h-[calc(100vh-40px)]",
        )}
      >
        <AppSidebar
          activeView={activeView}
          onSelectView={selectView}
          showAdvancedFeatures={showAdvancedFeatures}
          sizeForView={sizeForView}
        />

        <section className="grid min-h-0 min-w-0 grid-rows-[76px_auto_auto_minmax(0,1fr)_40px] overflow-hidden bg-[#f7f8f6] max-[720px]:min-h-[720px] max-[720px]:overflow-visible">
          <Toolbar
            activeView={activeView}
            canClean={canClean}
            hasTargets={targets.length > 0}
            mountPoint={diskStatus?.mount_point ?? null}
            onCancel={cancelCleanup}
            onClean={requestCleanup}
            onConfirm={confirmCleanup}
            onScan={scanTargets}
            progress={progress}
            runState={runState}
            customActions={pageChrome?.actions}
            showActions={cleanupView}
          />

          {cleanupView ? (
            <SummaryStrip
              releaseRatio={releaseRatio}
              selectedSize={selectedSize}
              totalFiles={totalFiles}
              totalSize={totalSize}
            />
          ) : pageChrome?.summary ? (
            pageChrome.summary
          ) : (
            <div className="h-0" />
          )}

          <div
            aria-live="polite"
            className={cn(
              "flex min-h-[34px] items-center gap-2 border-b border-[#efcccc] bg-[#fff7f7] px-[18px] text-[#991b1b]",
              !messageText && "h-0 min-h-0 overflow-hidden border-0 p-0",
            )}
          >
            {messageText ? (
              <>
                <ShieldAlert size={15} />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-normal">
                  {messageText}
                </span>
              </>
            ) : null}
          </div>

          <div
            className={cn(
              "grid min-h-0 items-stretch gap-[18px] overflow-hidden bg-[#f7f8f6] px-7 pt-5 pb-[18px] max-[980px]:grid-cols-1 max-[980px]:px-6 max-[980px]:pt-2 max-[980px]:pb-6 max-[720px]:overflow-visible max-[720px]:px-3.5 max-[720px]:pb-[18px]",
              showInspector
                ? "grid-cols-[minmax(0,1fr)_318px]"
                : "grid-cols-[minmax(0,1fr)]",
            )}
          >
            <div className="min-h-0 min-w-0 h-full max-h-full overflow-auto max-[720px]:overflow-visible">
              {activeView === "history" ? (
                <HistoryPage records={historyRecords} />
              ) : activeView === "agent" ? (
                <AgentCleanupPage
                  initialScanResult={agentScanResult}
                  onChromeChange={updatePageChrome}
                  onCleanupComplete={handleAgentCleanupComplete}
                  onScanComplete={handleAgentScanComplete}
                />
              ) : activeView === "developer" ? (
                <ApplicationCleanupPage
                  platform={appPlatform}
                  initialIncludeSystem={packageScanIncludesSystem}
                  initialScanResult={packageScanResult}
                  onChromeChange={updatePageChrome}
                  onScanComplete={handlePackageScanComplete}
                  onUninstallComplete={handlePackageUninstallComplete}
                />
              ) : activeView === "environment" ? (
                <EnvironmentPage onChromeChange={updatePageChrome} />
              ) : activeView === "duplicates" ? (
                <DuplicateFilesPage onDeleteComplete={handleFileDeleteComplete} />
              ) : activeView === "large-files" ? (
                <LargeFilesPage onDeleteComplete={handleFileDeleteComplete} />
              ) : activeView === "settings" ? (
                <SettingsPage onSettingsSaved={setShowAdvancedFeatures} />
              ) : activeView === "about" ? (
                <AboutPage />
              ) : activeView === "junk" ? (
                <JunkCleanupPage {...sharedPageProps} />
              ) : (
                <OverviewPage
                  availableCount={availableCount}
                  diskStatus={diskStatus}
                  lastCleanupAt={lastCleanupAt}
                  lastRun={lastRun}
                  onOpenCleanup={() => selectView("junk")}
                  onScan={scanTargets}
                  runState={runState}
                  selectedCount={selectedIds.length}
                  selectedFiles={selectedFiles}
                  selectedIds={selectedIds}
                  selectedSize={selectedSize}
                  targets={targets}
                  totalFiles={totalFiles}
                  totalSize={totalSize}
                />
              )}
            </div>

            {showInspector ? (
              <aside className="sticky top-0 grid max-h-full min-w-0 content-start gap-3 self-start overflow-auto bg-transparent max-[980px]:hidden">
                <DiskStatusPanel diskStatus={diskStatus} />
                <TargetInspector target={selectedTarget} />
              </aside>
            ) : null}
          </div>

          <footer className="flex min-h-10 min-w-0 items-center justify-between gap-2 border-t border-black/5 bg-[#f7f8f6] px-7 text-[#69727d] max-[980px]:px-6 max-[720px]:h-auto max-[720px]:flex-col max-[720px]:items-stretch">
            <div className="flex min-w-0 items-center gap-[7px]">
              <CheckCircle2 size={15} />
              <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-tight">
                {appVersion ? `V ${appVersion}` : "V -"}
              </span>
            </div>
            <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-tight">
              {t("overview.footer.lastCleanup")}
              {lastCleanupAt
                ? t("common.todayAt", { time: formatTime(lastCleanupAt, locale) })
                : t("history.empty.title")}
            </span>
          </footer>
        </section>
      </div>
    </main>
  );
}

export default App;
