import type { Locale } from "./i18n";

export function formatSize(size: number) {
  if (size >= 1024 * 1024 * 1024) {
    return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
  }

  if (size >= 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(0)} MB`;
  }

  if (size >= 1024) {
    return `${(size / 1024).toFixed(0)} KB`;
  }

  return `${size} B`;
}

export function formatCount(value: number, locale: Locale = "zh-CN") {
  return value.toLocaleString(locale);
}

export function formatTime(value: Date, locale: Locale = "zh-CN") {
  return value.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(
  value: number | null,
  locale: Locale = "zh-CN",
  emptyLabel = "Unknown time",
) {
  if (!value) {
    return emptyLabel;
  }

  return new Date(value * 1000).toLocaleDateString(locale, {
    month: "2-digit",
    day: "2-digit",
  });
}
