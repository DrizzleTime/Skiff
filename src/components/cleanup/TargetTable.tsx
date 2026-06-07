import { Badge } from "../ui/badge";
import { Checkbox } from "../ui/checkbox";
import { categoryLabels, iconForTarget, riskLabels } from "../../lib/cleanup";
import { formatCount, formatSize } from "../../lib/format";
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
  if (targets.length === 0) {
    return <EmptyState activeView={activeView} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" role="table">
      <div
        className={cn(
          tableGridClass,
          "min-h-8 border-b border-[#e2e2e2] bg-[#fafafa] px-5 text-[11px] font-[650] text-[#707070] max-[720px]:hidden",
        )}
        role="row"
      >
        <span role="columnheader" />
        <span role="columnheader">名称</span>
        <span role="columnheader">类型</span>
        <span role="columnheader">风险</span>
        <span className="text-right" role="columnheader">大小</span>
        <span className="text-right" role="columnheader">文件</span>
        <span role="columnheader" />
      </div>

      <div className="min-h-0 overflow-auto">
        {targets.map((target) => {
          const checked = selectedIdSet.has(target.id);
          const disabled = !target.cleanable || Boolean(target.error);
          const Icon = iconForTarget(target);

          return (
            <div
              className={cn(
                tableGridClass,
                "min-h-[54px] border-b border-[#eeeeee] bg-white px-5 py-2 [content-visibility:auto] [contain-intrinsic-size:54px] hover:bg-[#f8f8f8] max-[720px]:px-4",
                selectedTargetId === target.id &&
                  "bg-[#f7f7f7] shadow-[inset_3px_0_0_#111111]",
              )}
              key={target.id}
              onClick={() => onSelectTarget(target.id)}
              role="row"
            >
              <div className="grid place-items-center text-[#222222]" role="cell">
                <Icon size={18} strokeWidth={1.9} />
              </div>

              <div className="grid min-w-0 gap-1" role="cell">
                <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-bold leading-tight text-[#151515]">
                  {target.name}
                </strong>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-tight text-[#747474]">
                  {target.description}
                </span>
              </div>

              <span className="text-xs text-[#555555] max-[720px]:hidden" role="cell">
                {categoryLabels[target.category]}
              </span>

              <span className="max-[720px]:hidden" role="cell">
                <Badge variant={target.risk}>{riskLabels[target.risk]}</Badge>
              </span>

              <strong className="whitespace-nowrap text-right text-[13px] font-[720] text-[#171717]" role="cell">
                {formatSize(target.size)}
              </strong>

              <span className="whitespace-nowrap text-right text-xs text-[#555555] max-[720px]:hidden" role="cell">
                {formatCount(target.files)}
              </span>

              <Checkbox
                aria-label={`选择${target.name}`}
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
