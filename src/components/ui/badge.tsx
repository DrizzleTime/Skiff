import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex h-5 items-center rounded-md px-2 text-[11px] font-medium",
  {
    variants: {
      variant: {
        default: "bg-[#f4f4f5] text-[#52525b]",
        safe: "bg-[#e7f6ed] text-[#166534]",
        review: "bg-[#fef3c7] text-[#92400e]",
        careful: "bg-[#fee2e2] text-[#991b1b]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
