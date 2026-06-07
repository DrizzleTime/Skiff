import type { LucideIcon } from "lucide-react";
import { Spinner } from "../ui/spinner";

export function ActivityPanel({
  caption,
  icon: Icon,
  title,
}: {
  caption: string;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <div
      aria-live="polite"
      className="grid min-h-[260px] flex-1 place-items-center content-center px-7 py-7 text-center text-[#6f7782]"
      role="status"
    >
      <div className="relative mb-3.5 grid size-[72px] place-items-center text-[#145c53]">
        <div className="absolute inset-0 rounded-full border border-[#dfe6e3] border-t-[#145c53] animate-spin" />
        <div className="absolute inset-3 rounded-full border border-[#edf1ef]" />
        <Spinner aria-hidden="true" className="absolute inset-0 size-[72px] opacity-0" />
        <Icon size={28} strokeWidth={1.85} />
      </div>
      <strong className="text-sm font-[680] leading-tight text-[#14191f]">
        {title}
      </strong>
      <span className="mt-1.5 text-xs leading-normal text-[#7c8490]">{caption}</span>
      <div
        aria-hidden="true"
        className="relative mt-[18px] h-1 w-[min(240px,72%)] overflow-hidden rounded-full bg-[#e6ebe8]"
      >
        <span className="absolute inset-y-0 left-0 block w-[42%] rounded-[inherit] bg-[#145c53] animate-[skiff-sweep_1120ms_ease-in-out_infinite]" />
      </div>
    </div>
  );
}
