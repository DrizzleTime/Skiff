import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileText,
  HardDrive,
  RotateCw,
  ShieldCheck,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";
import { Button } from "../components/ui/button";
import { PageSurface } from "../components/cleanup/PageChrome";
import { categoryLabels, riskLabels, statusLabels } from "../lib/cleanup";
import { cn } from "../lib/utils";
import { formatCount, formatSize, formatTime } from "../lib/format";
import type {
  CleanupCategory,
  CleanupRisk,
  CleanupRunResult,
  CleanupTarget,
  DiskStatus,
  RunState,
} from "../types/cleanup";

const categoryOrder: CleanupCategory[] = [
  "cache",
  "browser",
  "developer",
  "flatpak",
  "package",
];

type OverviewMetric = {
  icon: LucideIcon;
  label: string;
  value: string;
  caption: string;
};
const panelClass = "min-w-0 overflow-hidden rounded-md border border-[#e5e5e5] bg-white";
const panelTitleClass =
  "flex min-h-[50px] items-center justify-between gap-3 border-b border-[#eeeeee] bg-white px-4";
const rowTextClass = "text-xs leading-tight text-[#707070]";

export function OverviewPage({
  availableCount,
  diskStatus,
  lastCleanupAt,
  lastRun,
  onOpenCleanup,
  onScan,
  runState,
  selectedCount,
  selectedFiles,
  selectedIds,
  selectedSize,
  targets,
  totalFiles,
  totalSize,
}: {
  availableCount: number;
  diskStatus: DiskStatus | null;
  lastCleanupAt: Date | null;
  lastRun: CleanupRunResult | null;
  onOpenCleanup: () => void;
  onScan: () => void;
  runState: RunState;
  selectedCount: number;
  selectedFiles: number;
  selectedIds: string[];
  selectedSize: number;
  targets: CleanupTarget[];
  totalFiles: number;
  totalSize: number;
}) {
  const busy = runState === "scanning" || runState === "cleaning";
  const hasTargets = targets.length > 0;
  const hasCleanableTargets = totalSize > 0 && availableCount > 0;
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const diskUsedPercent = diskStatus?.used_percent ?? 0;

  const metrics: OverviewMetric[] = useMemo(
    () => [
      {
        icon: HardDrive,
        label: "磁盘可用",
        value: formatSize(diskStatus?.available ?? 0),
        caption: diskStatus ? `已用 ${diskStatus.used_percent}%` : "未读取磁盘状态",
      },
      {
        icon: Trash2,
        label: "可释放",
        value: formatSize(totalSize),
        caption: `${formatCount(availableCount)} 项可清理`,
      },
      {
        icon: FileText,
        label: "文件",
        value: formatCount(totalFiles),
        caption: `${formatCount(targets.length)} 个扫描目标`,
      },
      {
        icon: CheckCircle2,
        label: "已选",
        value: formatSize(selectedSize),
        caption: `${formatCount(selectedCount)} 项，${formatCount(selectedFiles)} 个文件`,
      },
      {
        icon: Clock3,
        label: "上次清理",
        value: lastRun ? formatSize(lastRun.released_size) : "暂无",
        caption: lastCleanupAt ? `今天 ${formatTime(lastCleanupAt)}` : "没有清理记录",
      },
    ],
    [
      availableCount,
      diskStatus,
      lastCleanupAt,
      lastRun,
      selectedCount,
      selectedFiles,
      selectedSize,
      targets.length,
      totalFiles,
      totalSize,
    ],
  );

  const categoryRows = useMemo(
    () =>
      categoryOrder.map((category) => {
        let count = 0;
        let files = 0;
        let hasCareful = false;
        let hasReview = false;
        let selected = 0;
        let size = 0;

        for (const target of targets) {
          if (target.category !== category || !target.cleanable) {
            continue;
          }

          count += 1;
          files += target.files;
          size += target.size;
          if (selectedIdSet.has(target.id)) {
            selected += 1;
          }
          if (target.risk === "careful") {
            hasCareful = true;
          } else if (target.risk === "review") {
            hasReview = true;
          }
        }

        const risk: CleanupRisk = hasCareful ? "careful" : hasReview ? "review" : "safe";

        return {
          category,
          count,
          files,
          risk,
          selected,
          size,
        };
      }),
    [selectedIdSet, targets],
  );

  const heroTitle = hasTargets
    ? hasCleanableTargets
      ? "发现可清理空间"
      : "当前没有可清理项"
    : "先扫描用户目录";
  const heroCaption = hasTargets
    ? hasCleanableTargets
      ? `${formatCount(availableCount)} 项可清理，已默认选择低风险项目。`
      : "最近一次扫描没有发现可释放空间，可以稍后重新扫描。"
    : "扫描系统缓存、浏览器缓存和开发工具缓存，确认后再执行删除。";
  const primaryLabel = busy
    ? statusLabels[runState]
    : hasCleanableTargets
      ? "查看并清理"
      : hasTargets
        ? "重新扫描"
        : "开始扫描";
  const PrimaryIcon = busy || !hasCleanableTargets ? RotateCw : ArrowRight;

  return (
    <PageSurface className="grid content-start gap-3.5">
      <section className="grid min-w-0 grid-cols-[minmax(0,1fr)_280px] overflow-hidden rounded-md border border-[#e5e5e5] bg-[#f8f8f8] max-[980px]:grid-cols-1">
        <div className="min-w-0 p-5 max-[720px]:p-4">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-[#dddddd] bg-white px-2 py-1 text-[11px] font-[650] leading-none text-[#4b4b4b]">
            <ShieldCheck size={13} strokeWidth={2} />
            {statusLabels[runState]}
          </div>
          <h2 className="mt-4 text-[22px] font-extrabold leading-tight text-[#111111]">
            {heroTitle}
          </h2>
          <p className="mt-1.5 max-w-[620px] text-[13px] leading-normal text-[#555555]">
            {heroCaption}
          </p>

          <div className="mt-5 flex min-w-0 items-end gap-3 max-[720px]:flex-col max-[720px]:items-stretch">
            <div className="min-w-0 flex-1">
              <span className="block text-xs font-[650] leading-tight text-[#777777]">
                可释放空间
              </span>
              <strong className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-[38px] font-extrabold leading-none text-[#080808] max-[720px]:text-[32px]">
                {hasTargets ? formatSize(totalSize) : "待扫描"}
              </strong>
            </div>
            <div className="flex gap-2 max-[720px]:[&_button]:flex-1">
              {hasCleanableTargets ? (
                <Button
                  className="h-8 gap-1.5 rounded-md px-3 text-[13px]"
                  disabled={busy}
                  onClick={onScan}
                  variant="outline"
                >
                  <RotateCw className={busy ? "animate-spin" : undefined} size={16} />
                  重新扫描
                </Button>
              ) : null}
              <Button
                className="h-8 gap-1.5 rounded-md bg-[#181818] px-3 text-[13px]"
                disabled={busy}
                onClick={hasCleanableTargets ? onOpenCleanup : onScan}
              >
                <PrimaryIcon className={busy ? "animate-spin" : undefined} size={16} />
                {primaryLabel}
              </Button>
            </div>
          </div>
        </div>

        <div className="grid min-w-0 gap-2 border-l border-[#e5e5e5] bg-white p-4 max-[980px]:grid-cols-3 max-[980px]:border-l-0 max-[980px]:border-t max-[720px]:grid-cols-1">
          {metrics.slice(0, 3).map((metric) => {
            const Icon = metric.icon;

            return (
              <article className="grid min-h-[66px] min-w-0 content-center gap-1 rounded-md border border-[#eeeeee] px-3 py-2" key={metric.label}>
                <div className="flex min-w-0 items-center gap-1.5 text-[#666666]">
                  <Icon size={15} strokeWidth={1.9} />
                  <span className={rowTextClass}>{metric.label}</span>
                </div>
                <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-[17px] font-extrabold leading-tight text-[#111111]">
                  {metric.value}
                </strong>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-tight text-[#777777]">
                  {metric.caption}
                </span>
              </article>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] gap-3.5 max-[1100px]:grid-cols-1">
        <section className={panelClass}>
          <div className={panelTitleClass}>
            <div>
              <strong className="block text-sm font-[760] leading-tight text-[#151515]">
                清理建议
              </strong>
              <span className="mt-1 block text-xs leading-tight text-[#707070]">
                {hasTargets ? "按类别查看可释放空间与选择状态" : "等待扫描后生成建议"}
              </span>
            </div>
            <span className="whitespace-nowrap text-base font-[780] text-[#111111]">
              {formatSize(totalSize)}
            </span>
          </div>

          <div className="grid">
            {categoryRows.map((row) => (
              <div
                className="grid min-h-[52px] grid-cols-[minmax(0,1fr)_86px_74px_92px] items-center gap-3 border-b border-[#eeeeee] px-4 py-2 last:border-b-0 max-[720px]:grid-cols-[minmax(0,1fr)_auto]"
                key={row.category}
              >
                <div className="min-w-0">
                  <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-[650] leading-tight text-[#242424]">
                    {categoryLabels[row.category]}
                  </span>
                  <span className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-tight text-[#777777]">
                    {hasTargets
                      ? `${formatCount(row.count)} 项 · ${formatCount(row.files)} 个文件`
                      : "等待扫描"}
                  </span>
                </div>
                <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-right text-[13px] font-[740] text-[#151515]">
                  {hasTargets ? formatSize(row.size) : "--"}
                </strong>
                <span
                  className={cn(
                    "justify-self-end rounded-full px-2 text-[11px] font-[650] leading-5",
                    !hasTargets && "bg-[#eeeeee] text-[#777777]",
                    hasTargets &&
                      row.risk === "safe" &&
                      "bg-[#ecfdf3] text-[#166534]",
                    hasTargets &&
                      row.risk === "review" &&
                      "bg-[#fff7ed] text-[#9a3412]",
                    hasTargets &&
                      row.risk === "careful" &&
                      "bg-[#fff1f2] text-[#9f1239]",
                  )}
                >
                  {hasTargets ? riskLabels[row.risk] : "未扫描"}
                </span>
                <em className="overflow-hidden text-ellipsis whitespace-nowrap text-right text-xs not-italic leading-tight text-[#707070] max-[720px]:col-span-full max-[720px]:text-left">
                  {hasTargets ? `已选 ${formatCount(row.selected)}` : "扫描后可选择"}
                </em>
              </div>
            ))}
          </div>
        </section>

        <div className="grid content-start gap-3.5">
          <section className={panelClass}>
            <div className={panelTitleClass}>
              <div>
                <strong className="block text-sm font-[760] leading-tight text-[#151515]">
                  存储状态
                </strong>
                <span className="mt-1 block text-xs leading-tight text-[#707070]">
                  {diskStatus?.mount_point ?? "未读取挂载点"}
                </span>
              </div>
              <span className="whitespace-nowrap text-base font-[780] text-[#111111]">
                {diskStatus ? `${diskStatus.used_percent}%` : "--"}
              </span>
            </div>

            <div className="p-4">
              <div className="h-2 overflow-hidden rounded-full bg-[#eeeeee]">
                <span
                  className="block h-full rounded-full bg-[#181818]"
                  style={{ width: `${Math.min(100, Math.max(0, diskUsedPercent))}%` }}
                />
              </div>
              <div className="mt-4 grid gap-3">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <span className={rowTextClass}>总容量</span>
                  <strong className="text-[13px] font-[740] text-[#151515]">
                    {formatSize(diskStatus?.total ?? 0)}
                  </strong>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <span className={rowTextClass}>已用空间</span>
                  <strong className="text-[13px] font-[740] text-[#151515]">
                    {formatSize(diskStatus?.used ?? 0)}
                  </strong>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <span className={rowTextClass}>可用空间</span>
                  <strong className="text-[13px] font-[740] text-[#151515]">
                    {formatSize(diskStatus?.available ?? 0)}
                  </strong>
                </div>
              </div>
            </div>
          </section>

          <section className={panelClass}>
            <div className={panelTitleClass}>
              <div>
                <strong className="block text-sm font-[760] leading-tight text-[#151515]">
                  最近清理
                </strong>
                <span className="mt-1 block text-xs leading-tight text-[#707070]">
                  {lastCleanupAt ? `今天 ${formatTime(lastCleanupAt)}` : "暂无记录"}
                </span>
              </div>
              <Clock3 size={17} strokeWidth={1.9} />
            </div>

            <div className="grid gap-3 p-4">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <span className={rowTextClass}>释放空间</span>
                <strong className="text-[13px] font-[740] text-[#151515]">
                  {lastRun ? formatSize(lastRun.released_size) : "暂无"}
                </strong>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <span className={rowTextClass}>处理项目</span>
                <strong className="text-[13px] font-[740] text-[#151515]">
                  {lastRun ? formatCount(lastRun.items.length) : "暂无"}
                </strong>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <span className={rowTextClass}>失败项目</span>
                <strong className="text-[13px] font-[740] text-[#151515]">
                  {lastRun ? formatCount(lastRun.failed_count) : "暂无"}
                </strong>
              </div>
            </div>
          </section>
        </div>
      </div>
    </PageSurface>
  );
}
