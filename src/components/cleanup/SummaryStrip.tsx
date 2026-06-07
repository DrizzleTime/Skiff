import { CheckCircle2, FileText, Folder, Gauge } from "lucide-react";
import { formatCount, formatSize } from "../../lib/format";
import { MetricCell } from "./MetricCell";

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
  return (
    <div className="flex min-h-[38px] items-center gap-0 border-b border-[#eeeeee] bg-white px-7 max-[980px]:px-6 max-[720px]:h-auto max-[720px]:min-h-0 max-[720px]:flex-col max-[720px]:items-start max-[720px]:gap-1.5 max-[720px]:px-3.5 max-[720px]:py-2">
      <MetricCell icon={Folder} label="可释放" value={formatSize(totalSize)} />
      <MetricCell icon={FileText} label="文件" value={formatCount(totalFiles)} />
      <MetricCell icon={CheckCircle2} label="已选" value={formatSize(selectedSize)} />
      <MetricCell icon={Gauge} label="比例" value={`${releaseRatio.toFixed(1)}%`} />
    </div>
  );
}
