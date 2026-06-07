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

export function formatCount(value: number) {
  return value.toLocaleString("zh-CN");
}

export function formatTime(value: Date) {
  return value.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(value: number | null) {
  if (!value) {
    return "未知时间";
  }

  return new Date(value * 1000).toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
}
