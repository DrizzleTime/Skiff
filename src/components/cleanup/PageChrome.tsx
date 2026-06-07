import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";

export function PageSurface({
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        "min-w-0 min-h-0 overflow-visible rounded-md border-0 bg-white p-0",
        className,
      )}
      {...props}
    />
  );
}

export function ToolStrip({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mb-2.5 flex min-h-[38px] items-center justify-between gap-4 max-[720px]:flex-col max-[720px]:items-stretch",
        "[&_p]:max-w-[680px] [&_p]:text-[13px] [&_p]:leading-normal [&_p]:text-[#515151]",
        "[&_button]:h-8 [&_button]:gap-1.5 [&_button]:rounded-md [&_button]:px-3 [&_button]:text-[13px]",
        className,
      )}
      {...props}
    />
  );
}

export function StatGrid({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mb-2.5 flex min-h-[34px] items-center gap-3.5 rounded-md border border-[#e6e6e6] bg-[#fafafa] px-3",
        "max-[720px]:h-auto max-[720px]:min-h-0 max-[720px]:flex-col max-[720px]:items-start max-[720px]:gap-1.5 max-[720px]:py-2",
        className,
      )}
      {...props}
    />
  );
}

export function ResultPanel({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "overflow-visible rounded-md border border-[#e5e5e5] bg-white",
        className,
      )}
      {...props}
    />
  );
}

export function PanelTitle({
  actions,
  children,
  className,
}: {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[52px] items-center justify-between gap-4 border-b border-[#eeeeee] bg-white px-5",
        "max-[720px]:flex-col max-[720px]:items-stretch",
        "[&_strong]:text-sm [&_strong]:font-[760] [&_strong]:leading-tight [&_strong]:text-[#171717]",
        "[&_span]:mt-1 [&_span]:block [&_span]:text-xs [&_span]:leading-tight [&_span]:text-[#7a7a7a]",
        "[&_button]:h-8 [&_button]:gap-1.5 [&_button]:rounded-md [&_button]:px-3 [&_button]:text-[13px]",
        className,
      )}
    >
      {children}
      {actions}
    </div>
  );
}

export function InlineMessage({
  kind,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { kind: "error" | "info" }) {
  return (
    <div
      className={cn(
        "mb-3.5 rounded-lg px-3 py-2.5 text-[13px]",
        kind === "error"
          ? "border border-[#efcccc] bg-[#fff7f7] text-[#991b1b]"
          : "border border-[#d8e6d8] bg-[#f7fff7] text-[#166534]",
        className,
      )}
      {...props}
    />
  );
}
