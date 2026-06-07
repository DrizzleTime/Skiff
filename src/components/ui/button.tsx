import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#18181b]/20 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[#18181b] text-white hover:bg-[#27272a]",
        secondary:
          "border-transparent bg-[#f4f4f5] text-[#18181b] hover:bg-[#e4e4e7]",
        outline: "border-[#d4d4d8] bg-white text-[#18181b] hover:bg-[#f4f4f5]",
        ghost: "border-transparent bg-transparent text-[#52525b] hover:bg-[#f4f4f5]",
        destructive: "border-transparent bg-[#b42318] text-white hover:bg-[#912018]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({
  className,
  variant,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant }), className)}
      type={type}
      {...props}
    />
  );
}
