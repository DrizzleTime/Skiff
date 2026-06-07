import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#145c53]/20 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[#145c53] text-white hover:bg-[#0f4a43]",
        secondary:
          "border-transparent bg-[#edf1ef] text-[#16211f] hover:bg-[#e1e7e4]",
        outline: "border-black/10 bg-white text-[#17201f] hover:bg-[#f3f5f4]",
        ghost: "border-transparent bg-transparent text-[#58616d] hover:bg-[#edf1ef]",
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
