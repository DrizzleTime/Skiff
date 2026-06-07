import {
  Archive,
  Bot,
  Box,
  Clock3,
  Copy,
  FileQuestion,
  FileText,
  Folder,
  Globe,
  Grid2X2,
  Images,
  Info,
  Package,
  Settings,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type {
  ActiveView,
  CleanupCategory,
  CleanupRisk,
  CleanupTarget,
  RunState,
} from "../types/cleanup";

export const navItems: Array<{
  key: ActiveView;
  label: string;
  icon: LucideIcon;
}> = [
  { key: "overview", label: "总览", icon: Grid2X2 },
  { key: "junk", label: "垃圾清理", icon: Trash2 },
  { key: "agent", label: "Agent 清理", icon: Bot },
  { key: "developer", label: "应用清理", icon: Box },
  { key: "duplicates", label: "重复文件", icon: Copy },
  { key: "large-files", label: "大文件", icon: FileQuestion },
  { key: "history", label: "清理记录", icon: Clock3 },
  { key: "settings", label: "设置", icon: Settings },
  { key: "about", label: "关于", icon: Info },
];

export const riskLabels: Record<CleanupRisk, string> = {
  safe: "低风险",
  review: "需确认",
  careful: "高风险",
};

export const categoryLabels: Record<CleanupCategory, string> = {
  cache: "系统缓存",
  browser: "浏览器缓存",
  developer: "开发工具缓存",
  flatpak: "Flatpak 数据",
  package: "包管理缓存",
};

export const viewLabels: Record<ActiveView, string> = {
  overview: "总览",
  junk: "垃圾清理",
  agent: "Agent 清理",
  developer: "应用清理",
  duplicates: "重复文件",
  "large-files": "大文件",
  history: "清理记录",
  settings: "设置",
  about: "关于",
};

export const viewDescriptions: Record<ActiveView, string> = {
  overview: "磁盘状态、清理结果与近期操作集中视图",
  junk: "扫描状态",
  agent: "检查本地 Agent 会话与运行记录占用",
  developer: "查看已安装软件包，确认后执行卸载",
  duplicates: "按内容识别重复文件，保留必要副本",
  "large-files": "定位占用较高的文件，删除前逐项确认",
  history: "查看最近一次清理或删除操作结果",
  settings: "调整扫描阈值与清理偏好",
  about: "了解 Skiff 的功能范围与安全边界",
};

export const statusLabels: Record<RunState, string> = {
  idle: "未扫描",
  scanning: "正在扫描",
  ready: "扫描完成",
  confirming: "等待确认",
  cleaning: "正在清理",
  done: "清理完成",
  error: "有错误",
};

export function isJunkCleanupView(view: ActiveView): view is "junk" {
  return view === "junk";
}

export function iconForTarget(target: CleanupTarget): LucideIcon {
  if (target.id === "thumbnail-cache") {
    return Images;
  }

  if (target.id === "fontconfig-cache") {
    return FileText;
  }

  if (target.category === "browser") {
    return Globe;
  }

  if (target.category === "developer") {
    return Package;
  }

  if (target.category === "flatpak") {
    return Box;
  }

  if (target.category === "package") {
    return Package;
  }

  if (target.category === "cache") {
    return Archive;
  }

  return Folder;
}
