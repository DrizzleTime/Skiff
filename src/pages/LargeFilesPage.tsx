import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileQuestion, HardDrive, Search, Trash2 } from "lucide-react";
import { Button } from "../components/ui/button";
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
  const [error, setError] = useState<string | null>(null);

  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const selectedSize = useMemo(
    () =>
      files
        .filter((file) => selectedPathSet.has(file.path))
        .reduce((sum, file) => sum + file.size, 0),
    [files, selectedPathSet],
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

  async function deleteSelected() {
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
            <Button disabled={selectedPaths.length === 0 || busy} onClick={deleteSelected} variant="default">
              <Trash2 className={deleting ? "animate-spin" : undefined} size={16} />
              {deleting ? t("common.deleting") : t("actions.deleteSelected")}
            </Button>
          }
        >
          <div>
            <strong>{t("large.resultTitle")}</strong>
            <span>
              {busy
                ? scanning
                  ? t("common.scanning")
                  : t("common.deleting")
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
    </PageSurface>
  );
}
