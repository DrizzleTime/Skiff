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
import { cn } from "../lib/utils";
import type { CleanupRunResult } from "../types/cleanup";

const tableGridClass =
  "grid grid-cols-[minmax(150px,1fr)_minmax(180px,1.35fr)_70px_76px_118px] items-center gap-2.5 max-[720px]:min-w-[660px]";

export function HistoryPage({ lastRun }: { lastRun: CleanupRunResult | null }) {
  const successCount = lastRun
    ? lastRun.items.filter((item) => item.success).length
    : 0;
  const hasFailures = Boolean(lastRun?.failed_count);
  const releasedLabel = lastRun ? formatSize(lastRun.released_size) : "0 B";
  const processedLabel = lastRun ? formatCount(lastRun.deleted_files) : "0";

  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-[#e5e5e5] bg-white">
      <div className="flex min-h-[52px] items-center justify-between gap-3.5 border-b border-[#eeeeee] bg-white px-5 py-[10px] pb-[9px] max-[720px]:px-4">
        <div>
          <strong className="block text-sm font-[760] leading-tight text-[#171717]">
            清理记录
          </strong>
          <span className="mt-1 text-xs leading-tight text-[#7a7a7a]">
            最近一次清理或删除操作的结果
          </span>
        </div>
      </div>

      {!lastRun ? (
        <CleanupEmptyState
          description="完成清理后会显示结果。"
          icon={Clock3}
          title="暂无记录"
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
                  {hasFailures ? "部分项目处理失败" : "清理完成"}
                </strong>
                <span className="mt-1 block text-xs leading-tight text-[#686868]">
                  成功 {formatCount(successCount)} 项，失败 {formatCount(lastRun.failed_count)} 项
                </span>
              </div>
            </div>

            <div className="flex min-w-0 items-center gap-0 rounded-md border border-[#e5e5e5] bg-white max-[720px]:w-full [&>div+div]:border-l [&>div+div]:border-[#eeeeee]">
              <div className="grid min-h-12 min-w-[110px] grid-cols-[auto_auto] items-center gap-x-1.5 px-3 py-2 max-[720px]:min-w-0 max-[720px]:flex-1">
                <HardDrive className="text-[#555555]" size={16} />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-semibold leading-tight text-[#727272]">
                  已释放
                </span>
                <strong className="col-span-full mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-[780] leading-none text-[#101010]">
                  {releasedLabel}
                </strong>
              </div>
              <div className="grid min-h-12 min-w-[110px] grid-cols-[auto_auto] items-center gap-x-1.5 px-3 py-2 max-[720px]:min-w-0 max-[720px]:flex-1">
                <ListChecks className="text-[#555555]" size={16} />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-semibold leading-tight text-[#727272]">
                  处理数量
                </span>
                <strong className="col-span-full mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-[780] leading-none text-[#101010]">
                  {processedLabel}
                </strong>
              </div>
              <div className="grid min-h-12 min-w-[110px] grid-cols-[auto_auto] items-center gap-x-1.5 px-3 py-2 max-[720px]:min-w-0 max-[720px]:flex-1">
                <ShieldAlert className="text-[#555555]" size={16} />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-semibold leading-tight text-[#727272]">
                  失败
                </span>
                <strong className="col-span-full mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-[780] leading-none text-[#101010]">
                  {formatCount(lastRun.failed_count)}
                </strong>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col max-[720px]:overflow-auto">
            <div className={cn(tableGridClass, "min-h-[34px] border-b border-[#e5e5e5] bg-[#f7f7f7] px-5 text-[11px] font-[680] text-[#6d6d6d] [&_span:nth-child(3)]:text-right [&_span:nth-child(4)]:text-right")}>
              <span>项目</span>
              <span>路径 / 来源</span>
              <span>处理</span>
              <span>释放</span>
              <span>状态</span>
            </div>
            {lastRun.items.map((item) => (
              <div
                className={cn(
                  tableGridClass,
                  "min-h-[58px] border-b border-[#eeeeee] px-5 py-2 hover:bg-[#fafafa]",
                  item.success ? "bg-white" : "bg-[#fffafa]",
                )}
                key={item.id}
              >
                <div className="flex min-w-0 items-center gap-2">
                  {item.success ? (
                    <CheckCircle2 className="shrink-0 text-[#166534]" size={16} />
                  ) : (
                    <XCircle className="shrink-0 text-[#991b1b]" size={16} />
                  )}
                  <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-bold leading-tight text-[#171717]">
                    {item.name}
                  </strong>
                </div>
                <code
                  className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] text-[#707070]"
                  title={item.path}
                >
                  {item.path}
                </code>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-right text-[13px] leading-tight text-[#171717]">
                  {formatCount(item.deleted_files)} 项
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
                    {item.success ? "成功" : "失败"}
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
