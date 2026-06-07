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
import { categoryLabelKeys, riskLabelKeys, statusLabelKeys } from "../lib/cleanup";
import { cn } from "../lib/utils";
import { formatCount, formatSize, formatTime } from "../lib/format";
import { useI18n } from "../lib/i18n";
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
const panelClass =
  "min-w-0 overflow-hidden rounded-lg border border-black/5 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]";
const panelTitleClass =
  "flex min-h-[50px] items-center justify-between gap-3 border-b border-black/5 bg-[#fbfbfa] px-4";
const rowTextClass = "text-xs leading-tight text-[#6f7782]";

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
  const { locale, t } = useI18n();
  const busy = runState === "scanning" || runState === "cleaning";
  const hasTargets = targets.length > 0;
  const hasCleanableTargets = totalSize > 0 && availableCount > 0;
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const diskUsedPercent = diskStatus?.used_percent ?? 0;

  const metrics: OverviewMetric[] = useMemo(
    () => [
      {
        icon: HardDrive,
        label: t("overview.metric.available"),
        value: formatSize(diskStatus?.available ?? 0),
        caption: diskStatus
          ? t("overview.metric.diskUsed", { percent: diskStatus.used_percent })
          : t("overview.storage.unread"),
      },
      {
        icon: Trash2,
        label: t("overview.metric.cleanable"),
        value: formatSize(totalSize),
        caption: t("overview.metric.cleanableItems", {
          count: formatCount(availableCount, locale),
        }),
      },
      {
        icon: FileText,
        label: t("overview.metric.files"),
        value: formatCount(totalFiles, locale),
        caption: t("overview.metric.targets", {
          count: formatCount(targets.length, locale),
        }),
      },
      {
        icon: CheckCircle2,
        label: t("overview.metric.selected"),
        value: formatSize(selectedSize),
        caption: t("overview.metric.selectedSummary", {
          files: formatCount(selectedFiles, locale),
          items: formatCount(selectedCount, locale),
        }),
      },
      {
        icon: Clock3,
        label: t("overview.metric.lastCleanup"),
        value: lastRun ? formatSize(lastRun.released_size) : t("common.none"),
        caption: lastCleanupAt
          ? t("common.todayAt", { time: formatTime(lastCleanupAt, locale) })
          : t("overview.metric.noCleanup"),
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
      locale,
      t,
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
      ? t("overview.hero.title.cleanable")
      : t("overview.hero.title.empty")
    : t("overview.hero.title.initial");
  const heroCaption = hasTargets
    ? hasCleanableTargets
      ? t("overview.hero.caption.cleanable", {
          count: formatCount(availableCount, locale),
        })
      : t("overview.hero.caption.empty")
    : t("overview.hero.caption.initial");
  const primaryLabel = busy
    ? t(statusLabelKeys[runState])
    : hasCleanableTargets
      ? t("actions.viewAndClean")
      : hasTargets
        ? t("actions.rescan")
        : t("actions.startScan");
  const PrimaryIcon = busy || !hasCleanableTargets ? RotateCw : ArrowRight;

  return (
    <PageSurface className="grid content-start gap-4">
      <section className="grid min-w-0 grid-cols-[minmax(0,1fr)_264px] overflow-hidden rounded-lg border border-black/5 bg-[#fbfbf9] shadow-[0_18px_45px_rgba(30,41,59,0.06)] max-[980px]:grid-cols-1">
        <div className="min-w-0 p-6 max-[720px]:p-4">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-[#dfe7e4] bg-white/85 px-2.5 py-1 text-[11px] font-[620] leading-none text-[#3c5f58]">
            <ShieldCheck size={13} strokeWidth={2} />
            {t(statusLabelKeys[runState])}
          </div>
          <h2 className="mt-4 text-[24px] font-[720] leading-tight text-[#101419]">
            {heroTitle}
          </h2>
          <p className="mt-2 max-w-[620px] text-[13px] leading-relaxed text-[#58616d]">
            {heroCaption}
          </p>

          <div className="mt-7 flex min-w-0 items-end gap-4 max-[720px]:flex-col max-[720px]:items-stretch">
            <div className="min-w-0 flex-1">
              <span className="block text-xs font-[650] leading-tight text-[#79818b]">
                {t("overview.hero.availableSpace")}
              </span>
              <strong className="mt-2 block overflow-hidden text-ellipsis whitespace-nowrap text-[36px] font-[760] leading-none text-[#0c1117] max-[720px]:text-[31px]">
                {hasTargets ? formatSize(totalSize) : t("common.notScanned")}
              </strong>
            </div>
            <div className="flex gap-2.5 max-[720px]:[&_button]:flex-1">
              {hasCleanableTargets ? (
                <Button
                  className="h-9 gap-1.5 px-3.5 text-[13px]"
                  disabled={busy}
                  onClick={onScan}
                  variant="outline"
                >
                  <RotateCw className={busy ? "animate-spin" : undefined} size={16} />
                  {t("actions.rescan")}
                </Button>
              ) : null}
              <Button
                className="h-9 gap-1.5 px-4 text-[13px]"
                disabled={busy}
                onClick={hasCleanableTargets ? onOpenCleanup : onScan}
              >
                <PrimaryIcon className={busy ? "animate-spin" : undefined} size={16} />
                {primaryLabel}
              </Button>
            </div>
          </div>
        </div>

        <div className="grid min-w-0 gap-2 border-l border-black/5 bg-white/70 p-4 max-[980px]:grid-cols-3 max-[980px]:border-l-0 max-[980px]:border-t max-[720px]:grid-cols-1">
          {metrics.slice(0, 3).map((metric) => {
            const Icon = metric.icon;

            return (
              <article className="grid min-h-[68px] min-w-0 content-center gap-1.5 rounded-lg bg-[#f4f6f4] px-3 py-2" key={metric.label}>
                <div className="flex min-w-0 items-center gap-1.5 text-[#68717b]">
                  <Icon size={15} strokeWidth={1.9} />
                  <span className={rowTextClass}>{metric.label}</span>
                </div>
                <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-[17px] font-[720] leading-tight text-[#121821]">
                  {metric.value}
                </strong>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-tight text-[#7c8490]">
                  {metric.caption}
                </span>
              </article>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] gap-4 max-[1100px]:grid-cols-1">
        <section className={panelClass}>
          <div className={panelTitleClass}>
            <div>
              <strong className="block text-sm font-[680] leading-tight text-[#14191f]">
                {t("overview.category.title")}
              </strong>
              <span className="mt-1 block text-xs leading-tight text-[#7c8490]">
                {hasTargets
                  ? t("overview.category.subtitle.ready")
                  : t("overview.category.subtitle.waiting")}
              </span>
            </div>
            <span className="whitespace-nowrap text-base font-[720] text-[#121821]">
              {formatSize(totalSize)}
            </span>
          </div>

          <div className="grid">
            {categoryRows.map((row) => (
              <div
                className="grid min-h-[54px] grid-cols-[minmax(0,1fr)_86px_74px_92px] items-center gap-3 border-b border-black/5 px-4 py-2.5 last:border-b-0 hover:bg-[#fafaf8] max-[720px]:grid-cols-[minmax(0,1fr)_auto]"
                key={row.category}
              >
                <div className="min-w-0">
                  <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-[620] leading-tight text-[#242a31]">
                    {t(categoryLabelKeys[row.category])}
                  </span>
                  <span className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-tight text-[#7c8490]">
                    {hasTargets
                      ? `${formatCount(row.count, locale)} ${t("common.items")} · ${formatCount(row.files, locale)} ${t("common.files")}`
                      : t("overview.waiting")}
                  </span>
                </div>
                <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-right text-[13px] font-[680] text-[#151b22]">
                  {hasTargets ? formatSize(row.size) : "--"}
                </strong>
                <span
                  className={cn(
                    "justify-self-end rounded-full px-2 text-[11px] font-[620] leading-5",
                    !hasTargets && "bg-[#edf0ef] text-[#727a84]",
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
                  {hasTargets ? t(riskLabelKeys[row.risk]) : t("common.notScanned")}
                </span>
                <em className="overflow-hidden text-ellipsis whitespace-nowrap text-right text-xs not-italic leading-tight text-[#7a828c] max-[720px]:col-span-full max-[720px]:text-left">
                  {hasTargets
                    ? t("format.selectedItems", {
                        count: formatCount(row.selected, locale),
                      })
                    : t("overview.category.subtitle.waiting")}
                </em>
              </div>
            ))}
          </div>
        </section>

        <div className="grid content-start gap-4">
          <section className={panelClass}>
            <div className={panelTitleClass}>
              <div>
                <strong className="block text-sm font-[680] leading-tight text-[#14191f]">
                  {t("overview.disk.status")}
                </strong>
                <span className="mt-1 block text-xs leading-tight text-[#7c8490]">
                  {diskStatus?.mount_point ?? t("overview.disk.mountMissing")}
                </span>
              </div>
              <span className="whitespace-nowrap text-base font-[720] text-[#121821]">
                {diskStatus ? `${diskStatus.used_percent}%` : "--"}
              </span>
            </div>

            <div className="p-4">
              <div className="h-2 overflow-hidden rounded-full bg-[#eef1f0]">
                <span
                  className="block h-full rounded-full bg-[#145c53]"
                  style={{ width: `${Math.min(100, Math.max(0, diskUsedPercent))}%` }}
                />
              </div>
              <div className="mt-4 grid gap-3">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <span className={rowTextClass}>{t("overview.disk.total")}</span>
                  <strong className="text-[13px] font-[680] text-[#151b22]">
                    {formatSize(diskStatus?.total ?? 0)}
                  </strong>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <span className={rowTextClass}>{t("overview.disk.used")}</span>
                  <strong className="text-[13px] font-[680] text-[#151b22]">
                    {formatSize(diskStatus?.used ?? 0)}
                  </strong>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <span className={rowTextClass}>{t("overview.disk.available")}</span>
                  <strong className="text-[13px] font-[680] text-[#151b22]">
                    {formatSize(diskStatus?.available ?? 0)}
                  </strong>
                </div>
              </div>
            </div>
          </section>

          <section className={panelClass}>
            <div className={panelTitleClass}>
              <div>
                <strong className="block text-sm font-[680] leading-tight text-[#14191f]">
                  {t("overview.last.cleanup")}
                </strong>
                <span className="mt-1 block text-xs leading-tight text-[#7c8490]">
                  {lastCleanupAt
                    ? t("common.todayAt", { time: formatTime(lastCleanupAt, locale) })
                    : t("history.empty.title")}
                </span>
              </div>
              <Clock3 size={17} strokeWidth={1.9} />
            </div>

            <div className="grid gap-3 p-4">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <span className={rowTextClass}>{t("overview.last.released")}</span>
                <strong className="text-[13px] font-[680] text-[#151b22]">
                  {lastRun ? formatSize(lastRun.released_size) : t("common.none")}
                </strong>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <span className={rowTextClass}>{t("overview.last.processed")}</span>
                <strong className="text-[13px] font-[680] text-[#151b22]">
                  {lastRun ? formatCount(lastRun.items.length, locale) : t("common.none")}
                </strong>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <span className={rowTextClass}>{t("overview.last.failed")}</span>
                <strong className="text-[13px] font-[680] text-[#151b22]">
                  {lastRun ? formatCount(lastRun.failed_count, locale) : t("common.none")}
                </strong>
              </div>
            </div>
          </section>
        </div>
      </div>
    </PageSurface>
  );
}
