import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileQuestion, HardDrive, Search, ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { ActivityPanel } from "../components/cleanup/ActivityPanel";
import { FileRows } from "../components/cleanup/FileRows";
import {
  InlineMessage,
  PanelTitle,
  PageSurface,
  ResultPanel,
  StatGrid,
  ToolStrip,
} from "../components/cleanup/PageChrome";
import { StatCard } from "../components/cleanup/StatCard";
import { formatCount, formatSize } from "../lib/format";
import { useI18n } from "../lib/i18n";
import type { DeleteFilesResult, FileItem, LargeFileScanResult } from "../types/cleanup";

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export function LargeFilesPage({
  onDeleteComplete,
}: {
  onDeleteComplete: (result: DeleteFilesResult) => void;
}) {
  const { locale, t } = useI18n();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [scannedFiles, setScannedFiles] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const selectedFiles = useMemo(
    () => files.filter((file) => selectedPathSet.has(file.path)),
    [files, selectedPathSet],
  );
  const selectedSize = useMemo(
    () => selectedFiles.reduce((sum, file) => sum + file.size, 0),
    [selectedFiles],
  );
  const totalSize = useMemo(
    () => files.reduce((sum, file) => sum + file.size, 0),
    [files],
  );
  const busy = scanning || deleting;

  async function scan() {
    if (busy) {
      return;
    }

    setScanning(true);
    setError(null);
    try {
      await waitForNextFrame();
      const result = await invoke<LargeFileScanResult>("scan_large_files", {
        request: { limit: 80 },
      });
      setFiles(result.items);
      setSelectedPaths([]);
      setScannedFiles(result.scanned_files);
    } catch (scanError) {
      setError(String(scanError));
    } finally {
      setScanning(false);
    }
  }

  function requestMoveToTrash() {
    if (selectedPaths.length === 0 || busy) {
      return;
    }

    setConfirming(true);
  }

  async function moveSelectedToTrash() {
    if (selectedPaths.length === 0 || busy) {
      return;
    }

    setDeleting(true);
    setError(null);
    try {
      await waitForNextFrame();
      const result = await invoke<DeleteFilesResult>("delete_user_files", {
        request: { paths: selectedPaths },
      });
      const deleted = new Set(
        result.items.filter((item) => item.success).map((item) => item.path),
      );
      setFiles((current) => current.filter((file) => !deleted.has(file.path)));
      setSelectedPaths([]);
      setConfirming(false);
      onDeleteComplete(result);

      if (result.failed_count > 0) {
        setError(t("large.failed"));
      }
    } catch (deleteError) {
      setError(String(deleteError));
    } finally {
      setDeleting(false);
    }
  }

  function toggleFile(path: string) {
    if (busy) {
      return;
    }

    setSelectedPaths((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path],
    );
  }

  return (
    <PageSurface>
      <ToolStrip>
        <p>{t("large.subtitle")}</p>
        <Button disabled={busy} onClick={scan} variant="outline">
          <Search className={scanning ? "animate-spin" : undefined} size={16} />
          {scanning ? t("common.scanning") : files.length > 0 ? t("actions.rescan") : t("actions.startScan")}
        </Button>
      </ToolStrip>

      <StatGrid>
        <StatCard icon={HardDrive} label={t("large.stat.checkable")} value={formatSize(totalSize)} caption={t("large.stat.total")} />
        <StatCard icon={FileQuestion} label={t("large.stat.largeFiles")} value={formatCount(files.length, locale)} caption={t("format.scannedFiles", { count: formatCount(scannedFiles, locale) })} />
        <StatCard icon={Trash2} label={t("summary.selected")} value={formatSize(selectedSize)} caption={t("format.selectedFiles", { count: formatCount(selectedPaths.length, locale) })} />
      </StatGrid>

      {error ? <InlineMessage kind="error">{error}</InlineMessage> : null}

      <ResultPanel>
        <PanelTitle
          actions={
            <Button disabled={selectedPaths.length === 0 || busy} onClick={requestMoveToTrash} variant="default">
              <Trash2 className={deleting ? "animate-spin" : undefined} size={16} />
              {deleting ? t("common.movingToTrash") : t("actions.moveToTrashSelected")}
            </Button>
          }
        >
          <div>
            <strong>{t("large.resultTitle")}</strong>
            <span>
              {busy
                ? scanning
                  ? t("common.scanning")
                  : t("common.movingToTrash")
                : t("format.totalFiles", { count: formatCount(files.length, locale) })}
            </span>
          </div>
        </PanelTitle>
        {busy ? (
          <ActivityPanel
            caption={
              scanning
                ? t("large.activity.scanning")
                : t("large.activity.deleting", {
                    count: formatCount(selectedPaths.length, locale),
                  })
            }
            icon={scanning ? Search : Trash2}
            title={scanning ? t("large.activity.scanTitle") : t("large.activity.deleteTitle")}
          />
        ) : (
          <FileRows
            files={files}
            onToggleFile={toggleFile}
            selectedPathSet={selectedPathSet}
          />
        )}
      </ResultPanel>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("large.confirm.title")}</DialogTitle>
            <DialogDescription>
              {t("large.confirm.description", {
                count: formatCount(selectedFiles.length, locale),
                size: formatSize(selectedSize),
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[220px] gap-1.5 overflow-auto rounded-lg border border-[#f1d4b8] bg-[#fff9f2] p-3 text-xs text-[#755118]">
            <div className="mb-1 flex items-center gap-2 font-semibold">
              <ShieldAlert size={15} />
              <span>{t("large.confirm.recoverable")}</span>
            </div>
            {selectedFiles.slice(0, 8).map((file) => (
              <code className="break-all rounded-md bg-white/75 px-2 py-1" key={file.path}>
                {file.path}
              </code>
            ))}
            {selectedFiles.length > 8 ? (
              <span>{t("large.confirm.more", { count: formatCount(selectedFiles.length - 8, locale) })}</span>
            ) : null}
          </div>
          <DialogFooter>
            <Button disabled={deleting} onClick={() => setConfirming(false)} variant="outline">
              {t("actions.cancel")}
            </Button>
            <Button disabled={deleting} onClick={moveSelectedToTrash}>
              <Trash2 className={deleting ? "animate-spin" : undefined} size={15} />
              {deleting ? t("common.movingToTrash") : t("actions.confirmMoveToTrash")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageSurface>
  );
}
