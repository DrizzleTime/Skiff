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
    <div className="inline-grid min-h-0 grid-cols-[auto_auto] items-center gap-x-1.5 border-0 bg-transparent p-0 max-[720px]:border-l-0 max-[720px]:pl-0 [&+&]:border-l [&+&]:border-black/10 [&+&]:pl-3.5">
      <div className="inline-flex items-center gap-1.5 text-[#45505c]">
        <Icon className="hidden" size={20} strokeWidth={1.9} />
        <span className="text-xs font-[620] text-[#7c8490]">{label}</span>
      </div>
      <strong className="block text-[13px] font-[680] leading-none text-[#151b22]">
        {value}
      </strong>
      <p className="hidden">{caption}</p>
    </div>
  );
}
