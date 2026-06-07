import * as React from "react"

import { cn } from "../../lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-oklch(0.922 0 0) bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-oklch(0.205 0 0) selection:text-oklch(0.985 0 0) file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-oklch(0.145 0 0) placeholder:text-oklch(0.556 0 0) disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-oklch(0.922 0 0)/30 dark:border-oklch(1 0 0 / 10%) dark:border-oklch(1 0 0 / 15%) dark:selection:bg-oklch(0.922 0 0) dark:selection:text-oklch(0.205 0 0) dark:file:text-oklch(0.985 0 0) dark:placeholder:text-oklch(0.708 0 0) dark:dark:bg-oklch(1 0 0 / 15%)/30",
        "focus-visible:border-[#b8b8b8] focus-visible:ring-2 focus-visible:ring-[#181818]/10 dark:focus-visible:border-oklch(0.556 0 0) dark:focus-visible:ring-oklch(0.556 0 0)/50",
        "aria-invalid:border-oklch(0.577 0.245 27.325) aria-invalid:ring-oklch(0.577 0.245 27.325)/20 dark:aria-invalid:ring-oklch(0.577 0.245 27.325)/40 dark:aria-invalid:border-oklch(0.704 0.191 22.216) dark:aria-invalid:ring-oklch(0.704 0.191 22.216)/20 dark:dark:aria-invalid:ring-oklch(0.704 0.191 22.216)/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
