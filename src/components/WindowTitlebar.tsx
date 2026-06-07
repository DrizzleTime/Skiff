import type { MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "../lib/utils";

function runWindowAction(action: () => Promise<void>) {
  void action();
}

export function WindowTitlebar() {
  function handleDrag(event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    runWindowAction(() => getCurrentWindow().startDragging());
  }

  return (
    <header className="sticky top-0 z-20 flex min-h-[38px] min-w-0 items-stretch border-b border-[#dddddd] bg-[linear-gradient(180deg,#fbfbfb_0%,#f2f2f2_100%)] shadow-[inset_0_1px_0_rgb(255_255_255_/_86%)] select-none max-[720px]:sticky">
      <div className="group absolute top-0 right-3.5 z-[2] flex h-full items-center gap-2 pointer-events-none" aria-label="窗口控制">
        <button
          aria-label="最小化窗口"
          className={controlClass("bg-[#febc2e]")}
          onClick={() => runWindowAction(() => getCurrentWindow().minimize())}
          type="button"
        >
          <span className="translate-y-[-0.5px] text-[10px] font-bold leading-none opacity-0 group-hover:opacity-100" aria-hidden="true">−</span>
        </button>
        <button
          aria-label="最大化窗口"
          className={controlClass("bg-[#28c840]")}
          onClick={() => runWindowAction(() => getCurrentWindow().toggleMaximize())}
          type="button"
        >
          <span className="translate-y-[-0.5px] text-[10px] font-bold leading-none opacity-0 group-hover:opacity-100" aria-hidden="true">+</span>
        </button>
        <button
          aria-label="关闭窗口"
          className={controlClass("bg-[#ff5f57]")}
          onClick={() => runWindowAction(() => getCurrentWindow().close())}
          type="button"
        >
          <span className="translate-y-[-0.5px] text-[10px] font-bold leading-none opacity-0 group-hover:opacity-100" aria-hidden="true">×</span>
        </button>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-center px-28" onMouseDown={handleDrag}>
        <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-xs font-bold leading-none text-[#525252]">
          Skiff
        </strong>
      </div>
    </header>
  );
}

function controlClass(colorClass: string) {
  return cn(
    "grid size-[13px] place-items-center rounded-full border border-black/10 p-0 leading-none text-black/60 pointer-events-auto hover:brightness-95",
    colorClass,
  );
}
