import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy, FileText, Search, Trash2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
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
import { formatCount, formatDate, formatSize } from "../lib/format";
import { useI18n } from "../lib/i18n";
import type {
  DeleteFilesResult,
  DuplicateFileGroup,
  DuplicateFileScanResult,
  FileItem,
} from "../types/cleanup";

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export function DuplicateFilesPage({
  onDeleteComplete,
}: {
  onDeleteComplete: (result: DeleteFilesResult) => void;
}) {
  const { locale, t } = useI18n();
  const [groups, setGroups] = useState<DuplicateFileGroup[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [scannedFiles, setScannedFiles] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const files = useMemo(() => groups.flatMap((group) => group.files), [groups]);
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const selectedSize = useMemo(
    () =>
      files
        .filter((file) => selectedPathSet.has(file.path))
        .reduce((sum, file) => sum + file.size, 0),
    [files, selectedPathSet],
  );
  const reclaimableSize = useMemo(
    () =>
      groups.reduce(
        (sum, group) => sum + group.size * Math.max(group.files.length - 1, 0),
        0,
      ),
    [groups],
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
      const result = await invoke<DuplicateFileScanResult>("scan_duplicate_files", {
        request: { group_limit: 40 },
      });
      setGroups(result.groups);
      setSelectedPaths(defaultDuplicateSelection(result.groups));
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
      setGroups((current) =>
        current
          .map((group) => {
            const files = group.files.filter((file) => !deleted.has(file.path));
            const count = files.length;

            return {
              ...group,
              count,
              files,
              reclaimable_size: group.size * Math.max(count - 1, 0),
            };
          })
          .filter((group) => group.files.length > 1),
      );
      setSelectedPaths([]);
      onDeleteComplete(result);

      if (result.failed_count > 0) {
        setError(t("duplicates.failed"));
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

    setSelectedPaths((current) => {
      if (current.includes(path)) {
        return current.filter((item) => item !== path);
      }

      const group = groups.find((item) =>
        item.files.some((file) => file.path === path),
      );
      if (!group) {
        return [...current, path];
      }

      const selectedInGroup = group.files.filter((file) =>
        current.includes(file.path),
      ).length;
      if (selectedInGroup >= group.files.length - 1) {
        return current;
      }

      return [...current, path];
    });
  }

  return (
    <PageSurface>
      <ToolStrip>
        <p>{t("duplicates.subtitle")}</p>
        <Button disabled={busy} onClick={scan} variant="outline">
          <Search className={scanning ? "animate-spin" : undefined} size={16} />
          {scanning ? t("common.scanning") : groups.length > 0 ? t("actions.rescan") : t("actions.startScan")}
        </Button>
      </ToolStrip>

      <StatGrid>
        <StatCard icon={Copy} label={t("summary.reclaimable")} value={formatSize(reclaimableSize)} caption={t("duplicates.stat.keepOne")} />
        <StatCard icon={FileText} label={t("duplicates.stat.groups")} value={formatCount(groups.length, locale)} caption={t("format.scannedFiles", { count: formatCount(scannedFiles, locale) })} />
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
            <strong>{t("duplicates.resultTitle")}</strong>
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
                ? t("duplicates.activity.scanning")
                : t("duplicates.activity.deleting", {
                    count: formatCount(selectedPaths.length, locale),
                  })
            }
            icon={scanning ? Search : Trash2}
            title={scanning ? t("duplicates.activity.scanTitle") : t("duplicates.activity.deleteTitle")}
          />
        ) : (
          <DuplicateGroupRows
            groups={groups}
            onToggleFile={toggleFile}
            selectedPathSet={selectedPathSet}
          />
        )}
      </ResultPanel>
    </PageSurface>
  );
}

function defaultDuplicateSelection(groups: DuplicateFileGroup[]) {
  const selected: string[] = [];

  for (const group of groups) {
    selected.push(...group.files.slice(1).map((file: FileItem) => file.path));
  }

  return selected;
}

function DuplicateGroupRows({
  groups,
  selectedPathSet,
  onToggleFile,
}: {
  groups: DuplicateFileGroup[];
  selectedPathSet: Set<string>;
  onToggleFile: (path: string) => void;
}) {
  const { locale, t } = useI18n();

  if (groups.length === 0) {
    return (
      <CleanupEmptyState
        description={t("empty.file.description")}
        icon={FileText}
        title={t("empty.file.title")}
      />
    );
  }

  return (
    <div className="grid">
      {groups.map((group) => {
        const selectedInGroup = group.files.filter((file) =>
          selectedPathSet.has(file.path),
        ).length;

        return (
          <section className="border-b border-[#eeeeee]" key={group.id}>
            <div className="grid min-h-[44px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 bg-[#fbfbfa] px-5 py-2 max-[720px]:grid-cols-1 max-[720px]:px-4">
              <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-[680] text-[#141414]">
                {t("duplicates.groupTitle", {
                  count: formatCount(group.files.length, locale),
                })}
              </strong>
              <span className="text-xs text-[#68717d]">
                {t("duplicates.groupDetail", {
                  size: formatSize(group.size),
                  reclaimable: formatSize(
                    group.size * Math.max(group.files.length - 1, 0),
                  ),
                })}
              </span>
            </div>
            <div className="grid">
              {group.files.map((file) => {
                const checked = selectedPathSet.has(file.path);
                const cannotSelect =
                  !checked && selectedInGroup >= group.files.length - 1;

                return (
                  <button
                    className="grid min-h-[54px] w-full grid-cols-[30px_minmax(0,1fr)_96px_72px_30px] items-center gap-3 border-0 border-t border-[#f1f1f1] bg-white px-5 py-2 text-left [content-visibility:auto] [contain-intrinsic-size:54px] hover:bg-[#fafafa] disabled:cursor-not-allowed disabled:bg-white disabled:opacity-70 max-[720px]:grid-cols-[34px_minmax(0,1fr)_30px] max-[720px]:px-4"
                    disabled={cannotSelect}
                    key={file.path}
                    onClick={() => onToggleFile(file.path)}
                    type="button"
                  >
                    <span className="grid size-7 place-items-center rounded-md bg-[#f6f6f6] text-[#111111]">
                      <FileText size={18} strokeWidth={1.9} />
                    </span>
                    <span className="grid min-w-0 gap-1">
                      <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-bold text-[#141414]">
                        {file.name}
                      </strong>
                      <code className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] text-[#777777]">
                        {file.path}
                      </code>
                    </span>
                    <span className="grid justify-items-end gap-1 max-[720px]:hidden">
                      <strong className="text-sm text-[#101010]">
                        {formatSize(file.size)}
                      </strong>
                      <span className="text-[11px] text-[#777777]">
                        {formatDate(file.modified, locale, t("common.unknownTime"))}
                      </span>
                    </span>
                    <span className="text-right text-xs font-medium text-[#68717d] max-[720px]:hidden">
                      {checked ? t("duplicates.deleteFile") : t("duplicates.keepFile")}
                    </span>
                    <Checkbox
                      aria-label={t("file.select", { name: file.name })}
                      checked={checked}
                      disabled={cannotSelect}
                      onChange={() => onToggleFile(file.path)}
                      onClick={(event) => event.stopPropagation()}
                    />
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
