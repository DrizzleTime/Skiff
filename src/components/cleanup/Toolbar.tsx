import { RotateCw, Trash2, X } from "lucide-react";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
import {
  isJunkCleanupView,
  statusLabelKeys,
  viewDescriptionKeys,
  viewLabelKeys,
} from "../../lib/cleanup";
import { useI18n } from "../../lib/i18n";
import type { ActiveView, RunState } from "../../types/cleanup";

export function Toolbar({
  activeView,
  runState,
  progress,
  mountPoint,
  hasTargets,
  canClean,
  showActions = true,
  onScan,
  onClean,
  onConfirm,
  onCancel,
}: {
  activeView: ActiveView;
  runState: RunState;
  progress: number;
  mountPoint: string | null;
  hasTargets: boolean;
  canClean: boolean;
  showActions?: boolean;
  onScan: () => void;
  onClean: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const busy = runState === "scanning" || runState === "cleaning";
  const subtitle = isJunkCleanupView(activeView)
    ? `${t(statusLabelKeys[runState])}${mountPoint ? ` · ${mountPoint}` : ""}`
    : t(viewDescriptionKeys[activeView]);

  return (
    <header className="grid min-h-[72px] min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 border-b border-[#eeeeee] bg-white px-7 max-[980px]:px-6 max-[720px]:grid-cols-1 max-[720px]:grid-rows-[auto_auto] max-[720px]:px-3 max-[720px]:py-2.5">
      <div className="min-w-0">
        <h1 className="overflow-hidden text-ellipsis whitespace-nowrap text-[25px] font-extrabold leading-tight tracking-normal text-[#151515]">
          {t(viewLabelKeys[activeView])}
        </h1>
        <span className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-[13px] leading-tight text-[#424242]">
          {subtitle}
        </span>
      </div>

      {busy && (
        <div className="w-[190px] max-[720px]:w-full">
          <Progress value={progress} />
        </div>
      )}

      {showActions ? (
        <div className="flex justify-end gap-2 max-[720px]:justify-stretch max-[720px]:[&_button]:flex-1">
          {runState === "confirming" ? (
            <>
              <Button
                className="h-8 gap-1.5 rounded-md px-3 text-[13px]"
                onClick={onCancel}
                variant="outline"
              >
                <X size={16} />
                {t("actions.cancel")}
              </Button>
              <Button
                className="h-8 gap-1.5 rounded-md bg-[#181818] px-3 text-[13px]"
                disabled={!canClean}
                onClick={onConfirm}
                variant="default"
              >
                <Trash2 size={16} />
                {t("actions.confirmClean")}
              </Button>
            </>
          ) : (
            <>
              <Button
                className="h-8 gap-1.5 rounded-md px-3 text-[13px]"
                disabled={busy}
                onClick={onScan}
                variant="outline"
              >
                <RotateCw className={busy ? "animate-spin" : undefined} size={16} />
                {hasTargets ? t("actions.rescan") : t("actions.scan")}
              </Button>
              <Button
                className="h-8 gap-1.5 rounded-md bg-[#181818] px-3 text-[13px]"
                disabled={!canClean}
                onClick={onClean}
                variant="default"
              >
                <Trash2 size={16} />
                {t("actions.cleanSelected")}
              </Button>
            </>
          )}
        </div>
      ) : null}
    </header>
  );
}
