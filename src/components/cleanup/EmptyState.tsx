import { Search } from "lucide-react";
import type { ActiveView } from "../../types/cleanup";
import { CleanupEmptyState } from "./CleanupEmptyState";

export function EmptyState({ activeView }: { activeView: ActiveView }) {
  const title = activeView === "junk" ? "尚未扫描" : "暂无结果";

  return (
    <CleanupEmptyState
      description="点击工具栏的扫描按钮读取当前用户缓存目录。"
      icon={Search}
      title={title}
    />
  );
}
