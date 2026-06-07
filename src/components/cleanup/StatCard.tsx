import type { LucideIcon } from "lucide-react";

export function StatCard({
  icon: Icon,
  label,
  value,
  caption,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <div className="inline-grid min-h-0 grid-cols-[auto_auto] items-center gap-x-1.5 border-0 bg-transparent p-0 max-[720px]:border-l-0 max-[720px]:pl-0 [&+&]:border-l [&+&]:border-[#dcdcdc] [&+&]:pl-3.5">
      <div className="inline-flex items-center gap-1.5 text-[#1c1c1c]">
        <Icon className="hidden" size={20} strokeWidth={1.9} />
        <span className="text-xs font-semibold text-[#777777]">{label}</span>
      </div>
      <strong className="block text-[13px] font-[760] leading-none text-[#050505]">
        {value}
      </strong>
      <p className="hidden">{caption}</p>
    </div>
  );
}
