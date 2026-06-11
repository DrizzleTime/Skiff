import * as React from "react";
import { cn } from "../../lib/utils";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ className, ...props }, ref) {
    return (
      <input
        className={cn(
          "h-4 w-4 shrink-0 rounded border border-input bg-card accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-45",
          className,
        )}
        ref={ref}
        type="checkbox"
        {...props}
      />
    );
  },
);
