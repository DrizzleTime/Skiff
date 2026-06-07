import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "../../lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent p-0.5 shadow-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#181818]/10 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-[#171717] data-[state=unchecked]:bg-[#e6e6e6]",
        size === "sm" ? "h-[18px] w-8" : "h-[22px] w-10",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.22)] ring-0 transition-transform data-[state=unchecked]:translate-x-0",
          size === "sm"
            ? "size-3.5 data-[state=checked]:translate-x-3.5"
            : "size-[18px] data-[state=checked]:translate-x-[18px]"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
