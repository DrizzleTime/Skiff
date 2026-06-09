export type CleanupRisk = "safe" | "review" | "careful";

export type CleanupCategory = "cache" | "browser" | "developer" | "flatpak" | "package";

export type RunState =
  | "idle"
  | "scanning"
  | "ready"
  | "confirming"
  | "cleaning"
  | "done"
  | "error";

export type ActiveView =
  | "overview"
  | "junk"
  | "agent"
  | "developer"
  | "duplicates"
  | "large-files"
  | "history"
  | "settings"
  | "about";

export type CleanupTarget = {
  id: string;
  name: string;
  category: CleanupCategory;
  risk: CleanupRisk;
  description: string;
  path: string;
  paths: string[];
  exists: boolean;
  cleanable: boolean;
  requires_privilege: boolean;
  size: number;
  files: number;
  error: string | null;
};

export type CleanupScanResult = {
  targets: CleanupTarget[];
  total_size: number;
  total_files: number;
};

export type CleanupProgressPayload = {
  phase: "scanning" | "cleaning";
  processed: number;
  total: number;
  percent: number;
  target_id: string | null;
  target_name: string | null;
};

export type CleanupRunItemResult = {
  id: string;
  name: string;
  path: string;
  released_size: number;
  deleted_files: number;
  success: boolean;
  error: string | null;
};

export type CleanupRunResult = {
  items: CleanupRunItemResult[];
  released_size: number;
  deleted_files: number;
  failed_count: number;
};

export type DiskStatus = {
  total: number;
  used: number;
  available: number;
  used_percent: number;
  mount_point: string;
};

export type FileItem = {
  id: string;
  name: string;
  path: string;
  size: number;
  modified: number | null;
};

export type LargeFileScanResult = {
  items: FileItem[];
  total_size: number;
  total_files: number;
  scanned_files: number;
};

export type DuplicateFileGroup = {
  id: string;
  size: number;
  count: number;
  reclaimable_size: number;
  files: FileItem[];
};

export type DuplicateFileScanResult = {
  groups: DuplicateFileGroup[];
  total_reclaimable_size: number;
  total_files: number;
  scanned_files: number;
};

export type DeleteFilesResult = {
  items: Array<{
    path: string;
    released_size: number;
    success: boolean;
    error: string | null;
  }>;
  released_size: number;
  deleted_files: number;
  failed_count: number;
};

export type AppSettings = {
  large_file_min_size: number;
  duplicate_min_size: number;
  close_to_tray: boolean;
  language: LanguagePreference;
};

export type LanguagePreference = "system" | "zh-CN" | "en-US";

export type AppInfo = {
  name: string;
  version: string;
  platform: "linux" | "macos" | "windows";
  scan_roots: string[];
  cleanup_targets: number;
};

export type PackageManagerStatus = {
  id: string;
  name: string;
  available: boolean;
  command: string;
  note: string;
};

export type InstalledPackage = {
  id: string;
  manager: string;
  name: string;
  package_id: string;
  version: string;
  description: string;
  icon_url: string | null;
  size: number;
  source: string;
  requires_privilege: boolean;
};

export type PackageScanResult = {
  packages: InstalledPackage[];
  managers: PackageManagerStatus[];
  total_size: number;
  total_count: number;
};

export type PackageIconResult = {
  items: Array<{
    id: string;
    icon_url: string | null;
  }>;
};

export type PackageUninstallResult = {
  items: Array<{
    id: string;
    name: string;
    manager: string;
    released_size: number;
    success: boolean;
    error: string | null;
  }>;
  released_size: number;
  removed_count: number;
  failed_count: number;
};

export type AgentProviderStatus = {
  id: string;
  name: string;
  available: boolean;
  path: string;
  note: string;
};

export type AgentThread = {
  id: string;
  agent: string;
  title: string;
  cwd: string;
  rollout_path: string;
  source: string;
  model: string;
  archived: boolean;
  created_at_ms: number;
  updated_at_ms: number;
  size: number;
  log_count: number;
  goal_count: number;
};

export type AgentThreadScanResult = {
  threads: AgentThread[];
  agents: AgentProviderStatus[];
  total_size: number;
  total_logs: number;
};

export type AgentCleanupResult = {
  items: Array<{
    id: string;
    agent: string;
    title: string;
    path: string;
    released_size: number;
    deleted_logs: number;
    success: boolean;
    error: string | null;
  }>;
  released_size: number;
  deleted_threads: number;
  deleted_logs: number;
  failed_count: number;
};
