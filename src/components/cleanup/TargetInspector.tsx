import { Badge } from "../ui/badge";
import { categoryLabels, riskLabels } from "../../lib/cleanup";
import { formatCount, formatSize } from "../../lib/format";
import type { CleanupTarget } from "../../types/cleanup";
import { DetailLine } from "./DetailLine";

export function TargetInspector({ target }: { target: CleanupTarget | null }) {
  if (!target) {
    return (
      <section className="rounded-md border border-[#e5e5e5] bg-white p-3">
        <h2 className="text-[13px] font-[760] leading-tight tracking-normal text-[#151515]">
          项目详情
        </h2>
        <p className="mt-2 text-xs leading-normal text-[#707070]">
          扫描后选择一项查看路径和影响。
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-[#e5e5e5] bg-white p-3">
      <h2 className="text-[13px] font-[760] leading-tight tracking-normal text-[#151515]">
        项目详情
      </h2>
      <div className="mt-3 flex items-center justify-between gap-2">
        <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-[720] text-[#171717]">
          {target.name}
        </strong>
        <Badge variant={target.risk}>{riskLabels[target.risk]}</Badge>
      </div>
      <p className="mt-2 text-xs leading-normal text-[#707070]">{target.description}</p>

      <div className="mt-3 grid gap-1.5">
        <DetailLine label="类型" value={categoryLabels[target.category]} />
        <DetailLine label="大小" value={formatSize(target.size)} />
        <DetailLine label="文件" value={formatCount(target.files)} />
        <DetailLine label="状态" value={target.cleanable ? "可清理" : target.exists ? "已找到" : "不存在"} />
        <DetailLine label="权限" value={target.requires_privilege ? "需要授权" : "当前用户"} />
      </div>

      <code className="mt-3 block max-w-full whitespace-pre-wrap rounded-[5px] border border-[#dddddd] bg-[#eeeeee] px-1.5 py-1 font-mono text-[11px] leading-normal text-[#555555] [overflow-wrap:anywhere]">
        {target.path}
      </code>
      {target.error ? (
        <p className="mt-2.5 text-xs leading-normal text-[#991b1b]">{target.error}</p>
      ) : null}
    </section>
  );
}
