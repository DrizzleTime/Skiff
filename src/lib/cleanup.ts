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
  Terminal,
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
import type { I18nKey } from "./i18n";

export const navItems: Array<{
  key: ActiveView;
  icon: LucideIcon;
}> = [
  { key: "overview", icon: Grid2X2 },
  { key: "junk", icon: Trash2 },
  { key: "agent", icon: Bot },
  { key: "developer", icon: Box },
  { key: "environment", icon: Terminal },
  { key: "duplicates", icon: Copy },
  { key: "large-files", icon: FileQuestion },
  { key: "history", icon: Clock3 },
  { key: "settings", icon: Settings },
  { key: "about", icon: Info },
];

export const advancedViewKeys = new Set<ActiveView>([
  "agent",
  "environment",
]);

export const riskLabelKeys: Record<CleanupRisk, I18nKey> = {
  safe: "risk.safe",
  review: "risk.review",
  careful: "risk.careful",
};

export const categoryLabelKeys: Record<CleanupCategory, I18nKey> = {
  cache: "category.cache",
  browser: "category.browser",
  developer: "category.developer",
  flatpak: "category.flatpak",
  package: "category.package",
};

export const viewLabelKeys: Record<ActiveView, I18nKey> = {
  overview: "nav.overview",
  junk: "nav.junk",
  agent: "nav.agent",
  developer: "nav.developer",
  environment: "nav.environment",
  duplicates: "nav.duplicates",
  "large-files": "nav.largeFiles",
  history: "nav.history",
  settings: "nav.settings",
  about: "nav.about",
};

export const viewDescriptionKeys: Record<ActiveView, I18nKey> = {
  overview: "view.overview.description",
  junk: "view.junk.description",
  agent: "view.agent.description",
  developer: "view.developer.description",
  environment: "view.environment.description",
  duplicates: "view.duplicates.description",
  "large-files": "view.largeFiles.description",
  history: "view.history.description",
  settings: "view.settings.description",
  about: "view.about.description",
};

export const statusLabelKeys: Record<RunState, I18nKey> = {
  idle: "status.idle",
  scanning: "status.scanning",
  ready: "status.ready",
  confirming: "status.confirming",
  cleaning: "status.cleaning",
  done: "status.done",
  error: "status.error",
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
