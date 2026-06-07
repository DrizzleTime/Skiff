import { cn } from "../../lib/utils";

type ProgressProps = {
  value: number;
  className?: string;
};

export function Progress({ value, className }: ProgressProps) {
  const safeValue = Math.max(0, Math.min(100, value));

  return (
    <div
      aria-label="执行进度"
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
