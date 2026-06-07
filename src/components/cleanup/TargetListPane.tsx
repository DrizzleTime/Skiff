import { Search, Trash2 } from "lucide-react";
import { ActivityPanel } from "./ActivityPanel";
import { TargetTable } from "./TargetTable";
import { formatCount } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import type { ActiveView, CleanupTarget, RunState } from "../../types/cleanup";

export type TargetListPaneProps = {
  activeView: ActiveView;
  targets: CleanupTarget[];
  selectedTargetId: string | null;
  availableCount: number;
  selectedCount: number;
  selectedIdSet: Set<string>;
  runState: RunState;
  onToggleTarget: (id: string) => void;
  onSelectTarget: (id: string) => void;
};

export function TargetListPane({
  activeView,
  targets,
  selectedTargetId,
  availableCount,
  selectedCount,
  selectedIdSet,
  runState,
  onToggleTarget,
  onSelectTarget,
}: TargetListPaneProps) {
  const { locale, t } = useI18n();
  const busy = runState === "scanning" || runState === "cleaning";

  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-[#e5e5e5] bg-white max-[980px]:border-r-0 max-[720px]:min-h-[520px]">
      <div className="flex min-h-[52px] items-center justify-between gap-3.5 border-b border-[#eeeeee] bg-white px-5 py-[10px] pb-[9px] max-[720px]:px-4">
        <div>
          <strong className="block text-sm font-[760] leading-tight text-[#171717]">
            {t("targetList.title")}
          </strong>
          <span className="mt-1 text-xs leading-tight text-[#7a7a7a]">
            {t("targetList.summary", {
              available: formatCount(availableCount, locale),
              total: formatCount(targets.length, locale),
            })}
          </span>
        </div>
        <span className="whitespace-nowrap text-xs leading-tight text-[#7a7a7a]">
          {t("format.selectedItems", { count: formatCount(selectedCount, locale) })}
        </span>
      </div>

      {busy ? (
        <RunActivity
          runState={runState}
          selectedCount={selectedCount}
          targetCount={targets.length}
        />
      ) : (
        <TargetTable
          activeView={activeView}
          onSelectTarget={onSelectTarget}
          onToggleTarget={onToggleTarget}
          selectedIdSet={selectedIdSet}
          selectedTargetId={selectedTargetId}
          targets={targets}
        />
      )}
    </section>
  );
}

function RunActivity({
  runState,
  selectedCount,
  targetCount,
}: {
  runState: RunState;
  selectedCount: number;
  targetCount: number;
}) {
  const { locale, t } = useI18n();
  const scanning = runState === "scanning";
  const Icon = scanning ? Search : Trash2;

  return (
    <ActivityPanel
      caption={
        scanning
          ? targetCount > 0
            ? t("targetList.activity.scanning", {
                count: formatCount(targetCount, locale),
              })
            : t("targetList.activity.scanningCurrent")
          : t("targetList.activity.cleaning", {
              count: formatCount(selectedCount, locale),
            })
      }
      icon={Icon}
      title={scanning ? t("targetList.activity.scanningTitle") : t("targetList.activity.cleaningTitle")}
    />
  );
}
