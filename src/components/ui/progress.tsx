import { cn } from "../../lib/utils";
import { useI18n } from "../../lib/i18n";

type ProgressProps = {
  value: number;
  className?: string;
};

export function Progress({ value, className }: ProgressProps) {
  const { t } = useI18n();
  const safeValue = Math.max(0, Math.min(100, value));

  return (
    <div
      aria-label={t("progress.aria")}
      className={cn("h-1.5 overflow-hidden rounded-full bg-[#e4e4e7]", className)}
      role="progressbar"
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={safeValue}
    >
      <div
        className="h-full rounded-full bg-[#18181b] transition-[width] duration-300"
        style={{ width: `${safeValue}%` }}
      />
    </div>
  );
}
