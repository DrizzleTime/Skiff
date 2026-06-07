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
        setError("部分文件删除失败。");
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
        <p>扫描用户目录中的大体积文件，确认后再删除。</p>
        <Button disabled={busy} onClick={scan} variant="outline">
          <Search className={scanning ? "animate-spin" : undefined} size={16} />
          {scanning ? "扫描中" : files.length > 0 ? "重新扫描" : "开始扫描"}
        </Button>
      </ToolStrip>

      <StatGrid>
        <StatCard icon={HardDrive} label="可检查空间" value={formatSize(totalSize)} caption="当前结果合计" />
        <StatCard icon={FileQuestion} label="大文件" value={formatCount(files.length)} caption={`已扫描 ${formatCount(scannedFiles)} 个文件`} />
        <StatCard icon={Trash2} label="已选择" value={formatSize(selectedSize)} caption={`${formatCount(selectedPaths.length)} 个文件`} />
      </StatGrid>

      {error ? <InlineMessage kind="error">{error}</InlineMessage> : null}

      <ResultPanel>
        <PanelTitle
          actions={
            <Button disabled={selectedPaths.length === 0 || busy} onClick={deleteSelected} variant="default">
              <Trash2 className={deleting ? "animate-spin" : undefined} size={16} />
              {deleting ? "删除中" : "删除所选"}
            </Button>
          }
        >
          <div>
            <strong>扫描结果</strong>
            <span>{busy ? (scanning ? "扫描中" : "删除中") : `${files.length} 个文件`}</span>
          </div>
        </PanelTitle>
        {busy ? (
          <ActivityPanel
            caption={
              scanning
                ? "正在扫描用户目录中的大体积文件"
                : `正在删除 ${selectedPaths.length} 个已选择文件`
            }
            icon={scanning ? Search : Trash2}
            title={scanning ? "正在扫描大文件" : "正在删除文件"}
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
