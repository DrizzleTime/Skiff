import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  HardDrive,
  ListChecks,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { CleanupEmptyState } from "../components/cleanup/CleanupEmptyState";
import { formatCount, formatSize } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { cn } from "../lib/utils";
import type { CleanupRunRecord } from "../types/cleanup";

const tableGridClass =
  "grid grid-cols-[minmax(150px,1fr)_minmax(180px,1.35fr)_70px_76px_118px] items-center gap-2.5 max-[720px]:min-w-[660px]";

export function HistoryPage({ records }: { records: CleanupRunRecord[] }) {
  const { locale, t } = useI18n();
  const lastRun = records[0] ?? null;
  const successCount = lastRun
    ? lastRun.items.filter((item) => item.success).length
    : 0;
  const hasFailures = Boolean(lastRun?.failed_count);
  const releasedLabel = lastRun ? formatSize(lastRun.released_size) : "0 B";
  const processedLabel = lastRun ? formatCount(lastRun.deleted_files, locale) : "0";
  const metricLabel =
    lastRun?.mode === "trash"
      ? t("history.metrics.movedToTrash")
      : t("history.metrics.released");
  const successLabel =
    lastRun?.mode === "trash"
      ? t("history.trashStatus")
      : t("history.successStatus");
  const rows = records.flatMap((record) =>
    record.items.map((item) => ({
      ...item,
      mode: record.mode,
      recordId: record.id,
      createdAt: record.created_at,
    })),
  );

  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-[#e5e5e5] bg-white">
      <div className="flex min-h-[52px] items-center justify-between gap-3.5 border-b border-[#eeeeee] bg-white px-5 py-[10px] pb-[9px] max-[720px]:px-4">
        <div>
          <strong className="block text-sm font-[760] leading-tight text-[#171717]">
            {t("history.header.title")}
          </strong>
          <span className="mt-1 text-xs leading-tight text-[#7a7a7a]">
            {t("history.header.subtitle")}
          </span>
        </div>
      </div>

      {!lastRun ? (
        <CleanupEmptyState
          description={t("history.empty.description")}
          icon={Clock3}
          title={t("history.empty.title")}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <div className="grid min-h-[82px] grid-cols-[minmax(0,1fr)_auto] items-center gap-[18px] border-b border-[#e5e5e5] bg-[#fbfbfb] px-5 py-3.5 max-[720px]:grid-cols-[minmax(0,1fr)] max-[720px]:px-4">
            <div
              className={cn(
                "flex min-w-0 items-center gap-2.5",
                hasFailures ? "text-[#991b1b]" : "text-[#166534]",
              )}
            >
              {hasFailures ? <AlertTriangle size={22} /> : <CheckCircle2 size={22} />}
              <div>
                <strong className="block overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-[780] leading-tight text-[#171717]">
                  {hasFailures ? t("history.failedStatus") : successLabel}
                </strong>
                <span className="mt-1 block text-xs leading-tight text-[#686868]">
                  {t("history.statusLine", {
                    failed: formatCount(lastRun.failed_count, locale),
                    success: formatCount(successCount, locale),
                  })}
                </span>
              </div>
            </div>

            <div className="flex min-w-0 items-center gap-0 rounded-md border border-[#e5e5e5] bg-white max-[720px]:w-full [&>div+div]:border-l [&>div+div]:border-[#eeeeee]">
              <div className="grid min-h-12 min-w-[110px] grid-cols-[auto_auto] items-center gap-x-1.5 px-3 py-2 max-[720px]:min-w-0 max-[720px]:flex-1">
                <HardDrive className="text-[#555555]" size={16} />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-semibold leading-tight text-[#727272]">
                  {metricLabel}
                </span>
                <strong className="col-span-full mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-[780] leading-none text-[#101010]">
                  {releasedLabel}
                </strong>
              </div>
              <div className="grid min-h-12 min-w-[110px] grid-cols-[auto_auto] items-center gap-x-1.5 px-3 py-2 max-[720px]:min-w-0 max-[720px]:flex-1">
                <ListChecks className="text-[#555555]" size={16} />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-semibold leading-tight text-[#727272]">
                  {t("history.metrics.processed")}
                </span>
                <strong className="col-span-full mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-[780] leading-none text-[#101010]">
                  {processedLabel}
                </strong>
              </div>
              <div className="grid min-h-12 min-w-[110px] grid-cols-[auto_auto] items-center gap-x-1.5 px-3 py-2 max-[720px]:min-w-0 max-[720px]:flex-1">
                <ShieldAlert className="text-[#555555]" size={16} />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-semibold leading-tight text-[#727272]">
                  {t("history.metrics.failed")}
                </span>
                <strong className="col-span-full mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-[780] leading-none text-[#101010]">
                  {formatCount(lastRun.failed_count, locale)}
                </strong>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col max-[720px]:overflow-auto">
            <div className={cn(tableGridClass, "min-h-[34px] border-b border-[#e5e5e5] bg-[#f7f7f7] px-5 text-[11px] font-[680] text-[#6d6d6d] [&_span:nth-child(3)]:text-right [&_span:nth-child(4)]:text-right")}>
              <span>{t("history.table.item")}</span>
              <span>{t("history.table.path")}</span>
              <span>{t("history.table.processed")}</span>
              <span>{t("history.table.released")}</span>
              <span>{t("history.table.status")}</span>
            </div>
            {rows.map((item) => (
              <div
                className={cn(
                  tableGridClass,
                  "min-h-[58px] border-b border-[#eeeeee] px-5 py-2 hover:bg-[#fafafa]",
                  item.success ? "bg-white" : "bg-[#fffafa]",
                )}
                key={`${item.recordId}:${item.id}`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  {item.success ? (
                    <CheckCircle2 className="shrink-0 text-[#166534]" size={16} />
                  ) : (
                    <XCircle className="shrink-0 text-[#991b1b]" size={16} />
                  )}
                  <span className="grid min-w-0 gap-1">
                    <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-bold leading-tight text-[#171717]">
                      {item.name}
                    </strong>
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-tight text-[#7a7a7a]">
                      {formatHistoryTime(item.createdAt, locale)}
                    </span>
                  </span>
                </div>
                <code
                  className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] text-[#707070]"
                  title={item.path}
                >
                  {item.path}
                </code>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-right text-[13px] leading-tight text-[#171717]">
                  {t("history.row.processed", {
                    count: formatCount(item.deleted_files, locale),
                  })}
                </span>
                <strong
                  className={cn(
                    "overflow-hidden text-ellipsis whitespace-nowrap text-right text-[13px] font-[760] leading-tight",
                    item.success ? "text-[#166534]" : "text-[#767676]",
                  )}
                >
                  {item.success ? formatSize(item.released_size) : "-"}
                </strong>
                <div className="grid min-w-0 justify-items-start gap-1">
                  <span
                    className={cn(
                      "inline-flex min-h-[22px] items-center whitespace-nowrap rounded-full border px-2 text-[11px] font-[720] leading-none",
                      item.success
                        ? "border-[#cfe4cf] bg-[#f3faf3] text-[#166534]"
                        : "border-[#efcccc] bg-[#fff5f5] text-[#991b1b]",
                    )}
                  >
                    {item.success
                      ? item.mode === "trash"
                        ? t("common.movedToTrash")
                        : t("common.success")
                      : t("common.failure")}
                  </span>
                  {item.error ? (
                    <p className="max-w-full text-[11px] leading-snug text-[#991b1b] [overflow-wrap:anywhere]">
                      {item.error}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function formatHistoryTime(value: number, locale: "zh-CN" | "en-US") {
  return new Date(value).toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
