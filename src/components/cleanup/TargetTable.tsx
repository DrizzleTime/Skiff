import { Badge } from "../ui/badge";
import { Checkbox } from "../ui/checkbox";
import { categoryLabelKeys, iconForTarget, riskLabelKeys } from "../../lib/cleanup";
import { formatCount, formatSize } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { getLocalizedTarget } from "../../lib/targetTranslations";
import { cn } from "../../lib/utils";
import type { ActiveView, CleanupTarget } from "../../types/cleanup";
import { EmptyState } from "./EmptyState";

const tableGridClass =
  "grid grid-cols-[32px_minmax(150px,1fr)_70px_74px_78px_50px_30px] items-center gap-3 max-[720px]:grid-cols-[30px_minmax(0,1fr)_auto_30px]";

export function TargetTable({
  activeView,
  targets,
  selectedIdSet,
  selectedTargetId,
  onToggleTarget,
  onSelectTarget,
}: {
  activeView: ActiveView;
  targets: CleanupTarget[];
  selectedIdSet: Set<string>;
  selectedTargetId: string | null;
  onToggleTarget: (id: string) => void;
  onSelectTarget: (id: string) => void;
}) {
  const { locale, t } = useI18n();

  if (targets.length === 0) {
    return <EmptyState activeView={activeView} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" role="table">
      <div
        className={cn(
          tableGridClass,
          "min-h-8 border-b border-black/5 bg-[#fbfbfa] px-5 text-[11px] font-[620] text-[#7c8490] max-[720px]:hidden",
        )}
        role="row"
      >
        <span role="columnheader" />
        <span role="columnheader">{t("table.name")}</span>
        <span role="columnheader">{t("inspector.category")}</span>
        <span role="columnheader">{t("table.risk")}</span>
        <span className="text-right" role="columnheader">{t("inspector.size")}</span>
        <span className="text-right" role="columnheader">{t("inspector.files")}</span>
        <span role="columnheader" />
      </div>

      <div className="min-h-0 overflow-auto">
        {targets.map((target) => {
          const checked = selectedIdSet.has(target.id);
          const disabled = !target.cleanable || Boolean(target.error);
          const Icon = iconForTarget(target);
          const targetCopy = getLocalizedTarget(target, locale);

          return (
            <div
              className={cn(
                tableGridClass,
                "min-h-[54px] border-b border-black/5 bg-white px-5 py-2 [content-visibility:auto] [contain-intrinsic-size:54px] hover:bg-[#fafaf8] max-[720px]:px-4",
                selectedTargetId === target.id &&
                  "bg-[#f7faf8] shadow-[inset_3px_0_0_#145c53]",
              )}
              key={target.id}
              onClick={() => onSelectTarget(target.id)}
              role="row"
            >
              <div className="grid place-items-center text-[#45505c]" role="cell">
                <Icon size={18} strokeWidth={1.9} />
              </div>

              <div className="grid min-w-0 gap-1" role="cell">
                <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-[680] leading-tight text-[#151b22]">
                  {targetCopy.name}
                </strong>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-tight text-[#7c8490]">
                  {targetCopy.description}
                </span>
              </div>

              <span className="text-xs text-[#68717b] max-[720px]:hidden" role="cell">
                {t(categoryLabelKeys[target.category])}
              </span>

              <span className="max-[720px]:hidden" role="cell">
                <Badge variant={target.risk}>{t(riskLabelKeys[target.risk])}</Badge>
              </span>

              <strong className="whitespace-nowrap text-right text-[13px] font-[680] text-[#151b22]" role="cell">
                {formatSize(target.size)}
              </strong>

              <span className="whitespace-nowrap text-right text-xs text-[#68717b] max-[720px]:hidden" role="cell">
                {formatCount(target.files, locale)}
              </span>

              <Checkbox
                aria-label={t("file.select", { name: targetCopy.name })}
                checked={checked}
                disabled={disabled}
                onChange={() => onToggleTarget(target.id)}
                onClick={(event) => event.stopPropagation()}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
