import type { ReactNode } from "react";
import { CheckCircle2, FileText, Folder, Gauge } from "lucide-react";
import { formatCount, formatSize } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { MetricCell } from "./MetricCell";

export function SummaryMetricStrip({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[38px] items-center gap-0 border-b border-black/5 bg-[#f7f8f6] px-7 max-[980px]:px-6 max-[720px]:h-auto max-[720px]:min-h-0 max-[720px]:flex-col max-[720px]:items-start max-[720px]:gap-1.5 max-[720px]:px-3.5 max-[720px]:py-2">
      {children}
    </div>
  );
}

export function SummaryStrip({
  totalSize,
  totalFiles,
  selectedSize,
  releaseRatio,
}: {
  totalSize: number;
  totalFiles: number;
  selectedSize: number;
  releaseRatio: number;
}) {
  const { locale, t } = useI18n();

  return (
    <SummaryMetricStrip>
      <MetricCell icon={Folder} label={t("summary.reclaimable")} value={formatSize(totalSize)} />
      <MetricCell icon={FileText} label={t("summary.files")} value={formatCount(totalFiles, locale)} />
      <MetricCell icon={CheckCircle2} label={t("summary.selected")} value={formatSize(selectedSize)} />
      <MetricCell icon={Gauge} label={t("summary.ratio")} value={`${releaseRatio.toFixed(1)}%`} />
    </SummaryMetricStrip>
  );
}
