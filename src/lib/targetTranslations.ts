import targetEnUS from "../locales/target-en-US.json";
import targetZhCN from "../locales/target-zh-CN.json";
import type { CleanupTarget } from "../types/cleanup";
import type { Locale } from "./i18n";

type TargetCopy = {
  name: string;
  description: string;
};

type TargetCopyMap = Record<string, TargetCopy>;

const translations: Record<Locale, TargetCopyMap> = {
  "zh-CN": targetZhCN,
  "en-US": targetEnUS,
};

export function getLocalizedTarget(target: CleanupTarget, locale: Locale): TargetCopy {
  const copy = translations[locale][target.id];
  if (copy) {
    return copy;
  }

  if (target.id.startsWith("flatpak-app-cache:")) {
    const appName = target.name.replace(/\s*缓存$/, "");
    return interpolateCopy(translations[locale]["__flatpak-app-cache"], appName);
  }

  if (target.id.startsWith("flatpak-app-data:")) {
    const appName = target.name.replace(/\s*应用数据$/, "");
    return interpolateCopy(translations[locale]["__flatpak-app-data"], appName);
  }

  return {
    name: target.name,
    description: target.description,
  };
}

function interpolateCopy(copy: TargetCopy, name: string): TargetCopy {
  return {
    name: copy.name.replace("{name}", name),
    description: copy.description.replace("{name}", name),
  };
}
