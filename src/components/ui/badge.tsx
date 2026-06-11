import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex h-5 items-center rounded-md px-2 text-[11px] font-medium",
  {
    variants: {
      variant: {
        default: "bg-muted text-muted-foreground",
        safe: "bg-success-background text-success",
        review: "bg-warning-background text-warning",
        careful: "bg-careful-background text-careful",
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
