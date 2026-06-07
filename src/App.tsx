import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { AppSidebar } from "./components/cleanup/AppSidebar";
import { DiskStatusPanel } from "./components/cleanup/DiskStatusPanel";
import { SummaryStrip } from "./components/cleanup/SummaryStrip";
import { TargetInspector } from "./components/cleanup/TargetInspector";
import { Toolbar } from "./components/cleanup/Toolbar";
import { WindowTitlebar } from "./components/WindowTitlebar";
import { formatSize, formatTime } from "./lib/format";
import { isJunkCleanupView } from "./lib/cleanup";
import { cn } from "./lib/utils";
import { AboutPage } from "./pages/AboutPage";
import { AgentCleanupPage } from "./pages/AgentCleanupPage";
import { ApplicationCleanupPage } from "./pages/ApplicationCleanupPage";
import { DuplicateFilesPage } from "./pages/DuplicateFilesPage";
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
  CleanupRunResult,
  CleanupScanResult,
  CleanupTarget,
  DeleteFilesResult,
  DiskStatus,
  PackageScanResult,
  PackageUninstallResult,
  RunState,
} from "./types/cleanup";
import "./App.css";

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function App() {
  const [activeView, setActiveView] = useState<ActiveView>("overview");
  const [targets, setTargets] = useState<CleanupTarget[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [runState, setRunState] = useState<RunState>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [diskStatus, setDiskStatus] = useState<DiskStatus | null>(null);
  const [diskError, setDiskError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<CleanupRunResult | null>(null);
  const [lastCleanupAt, setLastCleanupAt] = useState<Date | null>(null);
  const [agentCleanupSize, setAgentCleanupSize] = useState(0);
  const [applicationCleanupSize, setApplicationCleanupSize] = useState(0);
  const [agentScanResult, setAgentScanResult] = useState<AgentThreadScanResult | null>(null);
  const [packageScanResult, setPackageScanResult] = useState<PackageScanResult | null>(null);
  const [packageScanIncludesSystem, setPackageScanIncludesSystem] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [appPlatform, setAppPlatform] = useState<AppInfo["platform"]>("linux");

  useEffect(() => {
    void refreshDiskStatus();
    void refreshAppInfo();
  }, []);

  useEffect(() => {
    if (runState !== "scanning" && runState !== "cleaning") {
      return;
    }

    const ceiling = runState === "scanning" ? 88 : 92;
    const interval = window.setInterval(() => {
      setProgress((current) => {
        if (current >= ceiling) {
          return current;
        }

        const step = current < 48 ? 4 : current < 76 ? 2 : 1;
        return Math.min(ceiling, current + step);
      });
    }, 280);

    return () => window.clearInterval(interval);
  }, [runState]);

  const visibleTargets = useMemo(() => {
    if (isJunkCleanupView(activeView)) {
      return targets;
    }

    return [];
  }, [activeView, targets]);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const selectedTarget =
    targets.find((target) => target.id === selectedTargetId) ??
    visibleTargets[0] ??
    targets[0] ??
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

  async function scanTargets() {
    setRunState("scanning");
    setProgress(12);
    setErrorMessage(null);

    try {
      await waitForNextFrame();
      const result = await invoke<CleanupScanResult>("scan_cleanup_targets");
      setProgress(72);
      setTargets(result.targets);
      setSelectedIds(
        result.targets
          .filter((target) => target.risk === "safe" && target.cleanable)
          .map((target) => target.id),
      );
      setSelectedTargetId(result.targets[0]?.id ?? null);
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

  async function confirmCleanup() {
    if (selectedIds.length === 0) {
      return;
    }

    setRunState("cleaning");
    setProgress(18);
    setErrorMessage(null);

    try {
      await waitForNextFrame();
      const result = await invoke<CleanupRunResult>("run_cleanup", {
        request: { ids: selectedIds },
      });
      setLastRun(result);
      setProgress(86);
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
      setLastCleanupAt(new Date());
      await refreshDiskStatus();

      if (result.failed_count > 0) {
        setErrorMessage("部分项目清理失败，详情见清理记录。");
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
    if (isJunkCleanupView(view)) {
      setSelectedTargetId(targets[0]?.id ?? null);
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
      return lastRun ? `${lastRun.items.length} 项` : "";
    }

    return "";
  }

  function handleFileDeleteComplete(result: DeleteFilesResult) {
    const runResult: CleanupRunResult = {
      items: result.items.map((item) => ({
        id: item.path,
        name: item.path.split("/").pop() || "文件",
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

    setLastRun(runResult);
    setLastCleanupAt(new Date());
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

    setLastRun(runResult);
    setLastCleanupAt(new Date());
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

    setLastRun(runResult);
    setLastCleanupAt(new Date());
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

  return (
    <main className="grid h-full w-full grid-rows-[38px_minmax(0,1fr)] overflow-hidden rounded-2xl border border-black/10 bg-white max-[720px]:h-auto max-[720px]:min-h-screen max-[720px]:grid-rows-[38px_auto] max-[720px]:overflow-visible max-[720px]:rounded-none max-[720px]:border-0">
      <WindowTitlebar />

      <div className="grid min-h-0 min-w-0 grid-cols-[216px_minmax(0,1fr)] overflow-hidden bg-white max-[720px]:min-h-[calc(100vh-38px)] max-[720px]:grid-cols-1 max-[720px]:overflow-visible">
        <AppSidebar
          activeView={activeView}
          onSelectView={selectView}
          sizeForView={sizeForView}
        />

        <section className="grid min-h-0 min-w-0 grid-rows-[72px_auto_auto_minmax(0,1fr)_40px] overflow-hidden bg-white max-[720px]:min-h-[720px] max-[720px]:overflow-visible">
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
            showActions={cleanupView}
          />

          {cleanupView ? (
            <SummaryStrip
              releaseRatio={releaseRatio}
              selectedSize={selectedSize}
              totalFiles={totalFiles}
              totalSize={totalSize}
            />
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
              "grid min-h-0 items-stretch gap-[18px] overflow-hidden bg-white px-7 pt-4 pb-[18px] max-[980px]:grid-cols-1 max-[980px]:px-6 max-[980px]:pt-0 max-[980px]:pb-6 max-[720px]:overflow-visible max-[720px]:px-3.5 max-[720px]:pb-[18px]",
              showInspector
                ? "grid-cols-[minmax(0,1fr)_318px]"
                : "grid-cols-[minmax(0,1fr)]",
            )}
          >
            <div className="min-h-0 min-w-0 h-full max-h-full overflow-auto max-[720px]:overflow-visible">
              {activeView === "history" ? (
                <HistoryPage lastRun={lastRun} />
              ) : activeView === "agent" ? (
                <AgentCleanupPage
                  initialScanResult={agentScanResult}
                  onCleanupComplete={handleAgentCleanupComplete}
                  onScanComplete={handleAgentScanComplete}
                />
              ) : activeView === "developer" ? (
                <ApplicationCleanupPage
                  platform={appPlatform}
                  initialIncludeSystem={packageScanIncludesSystem}
                  initialScanResult={packageScanResult}
                  onScanComplete={handlePackageScanComplete}
                  onUninstallComplete={handlePackageUninstallComplete}
                />
              ) : activeView === "duplicates" ? (
                <DuplicateFilesPage onDeleteComplete={handleFileDeleteComplete} />
              ) : activeView === "large-files" ? (
                <LargeFilesPage onDeleteComplete={handleFileDeleteComplete} />
              ) : activeView === "settings" ? (
                <SettingsPage />
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
              <aside className="sticky top-0 grid max-h-full min-w-0 content-start gap-3 self-start overflow-auto bg-white max-[980px]:hidden">
                <DiskStatusPanel diskStatus={diskStatus} />
                <TargetInspector target={selectedTarget} />
              </aside>
            ) : null}
          </div>

          <footer className="flex min-h-10 min-w-0 items-center justify-between gap-2 border-t border-[#eeeeee] bg-white px-7 text-[#666666] max-[980px]:px-6 max-[720px]:h-auto max-[720px]:flex-col max-[720px]:items-stretch">
            <div className="flex min-w-0 items-center gap-[7px]">
              <CheckCircle2 size={15} />
              <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-tight">
                {appVersion ? `V ${appVersion}` : "V -"}
              </span>
            </div>
            <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-tight">
              上次清理：
              {lastCleanupAt ? `今天 ${formatTime(lastCleanupAt)}` : "暂无记录"}
            </span>
          </footer>
        </section>
      </div>
    </main>
  );
}

export default App;
