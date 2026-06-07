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
      className="grid min-h-[260px] flex-1 place-items-center content-center px-7 py-7 text-center text-[#6d6d6d]"
      role="status"
    >
      <div className="relative mb-3.5 grid size-[72px] place-items-center text-[#151515]">
        <div className="absolute inset-0 rounded-full border border-[#dddddd] border-t-[#151515] animate-spin" />
        <div className="absolute inset-3 rounded-full border border-[#eeeeee]" />
        <Spinner aria-hidden="true" className="absolute inset-0 size-[72px] opacity-0" />
        <Icon size={28} strokeWidth={1.85} />
      </div>
      <strong className="text-sm font-[760] leading-tight text-[#171717]">
        {title}
      </strong>
      <span className="mt-1.5 text-xs leading-normal text-[#747474]">{caption}</span>
      <div
        aria-hidden="true"
        className="relative mt-[18px] h-1 w-[min(240px,72%)] overflow-hidden rounded-full bg-[#e8e8e8]"
      >
        <span className="absolute inset-y-0 left-0 block w-[42%] rounded-[inherit] bg-[#181818] animate-[skiff-sweep_1120ms_ease-in-out_infinite]" />
      </div>
    </div>
  );
}
