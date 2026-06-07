import type { LucideIcon } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";

export function CleanupEmptyState({
  description,
  icon: Icon,
  title,
}: {
  description: string;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <Empty className="grid min-h-[260px] flex-1 place-items-center content-center px-7 py-7 text-center text-[#777777]">
      <EmptyHeader>
        <EmptyMedia>
          <Icon size={28} />
        </EmptyMedia>
        <EmptyTitle className="mt-2.5 text-sm font-[720] text-[#171717]">
          {title}
        </EmptyTitle>
        <EmptyDescription className="mt-1.5 text-xs leading-normal text-[#767676]">
          {description}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
