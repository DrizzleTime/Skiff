import type { LucideIcon } from "lucide-react";

export function MetricCell({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="inline-flex min-h-0 items-center border-0 bg-transparent p-0 before:hidden [&+&]:before:mx-3 [&+&]:before:block [&+&]:before:h-3.5 [&+&]:before:w-px [&+&]:before:bg-black/10 [&+&]:before:content-[''] max-[720px]:[&+&]:before:hidden">
      <Icon className="hidden" size={18} strokeWidth={1.9} />
      <span className="overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-tight text-[#7c8490]">
        {label}
      </span>
      <strong className="ml-1.5 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-[680] leading-tight tracking-normal text-[#151b22]">
        {value}
      </strong>
    </div>
  );
}
