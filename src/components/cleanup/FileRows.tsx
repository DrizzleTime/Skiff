import { FileText } from "lucide-react";
import { Checkbox } from "../ui/checkbox";
import { formatDate, formatSize } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import type { FileItem } from "../../types/cleanup";
import { CleanupEmptyState } from "./CleanupEmptyState";

export function FileRows({
  files,
  selectedPathSet,
  onToggleFile,
}: {
  files: FileItem[];
  selectedPathSet: Set<string>;
  onToggleFile: (path: string) => void;
}) {
  const { locale, t } = useI18n();

  if (files.length === 0) {
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
      {files.map((file) => (
        <button
          className="grid min-h-[54px] w-full grid-cols-[30px_minmax(0,1fr)_96px_30px] items-center gap-3 border-0 border-b border-[#eeeeee] bg-white px-5 py-2 text-left [content-visibility:auto] [contain-intrinsic-size:54px] hover:bg-[#fafafa] max-[720px]:grid-cols-[34px_minmax(0,1fr)_30px] max-[720px]:px-4"
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
            <strong className="text-sm text-[#101010]">{formatSize(file.size)}</strong>
            <span className="text-[11px] text-[#777777]">
              {formatDate(file.modified, locale, t("common.unknownTime"))}
            </span>
          </span>
          <Checkbox
            aria-label={t("file.select", { name: file.name })}
            checked={selectedPathSet.has(file.path)}
            onChange={() => onToggleFile(file.path)}
            onClick={(event) => event.stopPropagation()}
          />
        </button>
      ))}
    </div>
  );
}
