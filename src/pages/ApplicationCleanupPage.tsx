import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Box, Info, Package, Search, ShieldAlert, Trash2, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../components/ui/input-group";
import { Switch } from "../components/ui/switch";
import { ActivityPanel } from "../components/cleanup/ActivityPanel";
import { CleanupEmptyState } from "../components/cleanup/CleanupEmptyState";
import {
  InlineMessage,
  PanelTitle,
  PageSurface,
  ResultPanel,
  StatGrid,
  ToolStrip,
} from "../components/cleanup/PageChrome";
import { StatCard } from "../components/cleanup/StatCard";
import { formatCount, formatSize } from "../lib/format";
import { cn } from "../lib/utils";
import type {
  InstalledPackage,
  PackageIconResult,
  PackageManagerStatus,
  PackageScanResult,
  PackageUninstallResult,
} from "../types/cleanup";

const managerLabels: Record<string, string> = {
  apt: "APT",
  rpm: "RPM",
  flatpak: "Flatpak",
  "macos-app": "macOS",
  "homebrew-formula": "Brew",
  "homebrew-cask": "Cask",
  "windows-registry": "Windows",
};
const platformCopy = {
  linux: {
    caption: "APT / RPM / Flatpak",
    description: "扫描 APT、RPM、Flatpak 已安装应用，确认后调用系统包管理器卸载。",
    privilege: "个系统软件包需要管理员授权。",
    scanning: "正在读取包管理器应用列表",
  },
  macos: {
    caption: "Apps / Homebrew",
    description: "扫描 .app、Homebrew formula 和 cask，确认后移入废纸篓或调用 brew uninstall。",
    privilege: "个系统应用可能需要管理员授权。",
    scanning: "正在读取 macOS 应用和 Homebrew 列表",
  },
  windows: {
    caption: "Registry uninstall",
    description: "扫描 Windows Uninstall 注册表项，确认后调用应用登记的官方卸载命令。",
    privilege: "个系统级应用可能需要管理员授权。",
    scanning: "正在读取 Windows 应用注册表",
  },
} satisfies Record<
  "linux" | "macos" | "windows",
  { caption: string; description: string; privilege: string; scanning: string }
>;
const searchGroupClass =
  "h-10 gap-2.5 rounded-lg border-[#dddddd] bg-white px-3 shadow-none";
const packageGridClass =
  "grid grid-cols-[88px_minmax(180px,1fr)_128px_88px_34px] items-center gap-3 max-[720px]:grid-cols-[72px_minmax(0,1fr)_32px]";

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export function ApplicationCleanupPage({
  platform,
  initialIncludeSystem,
  initialScanResult,
  onScanComplete,
  onUninstallComplete,
}: {
  platform: "linux" | "macos" | "windows";
  initialIncludeSystem: boolean;
  initialScanResult: PackageScanResult | null;
  onScanComplete: (result: PackageScanResult, includeSystem: boolean) => void;
  onUninstallComplete: (result: PackageUninstallResult) => void;
}) {
  const [packages, setPackages] = useState<InstalledPackage[]>(
    () => initialScanResult?.packages ?? [],
  );
  const [managers, setManagers] = useState<PackageManagerStatus[]>(
    () => initialScanResult?.managers ?? [],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [managerFilter, setManagerFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [includeSystem, setIncludeSystem] = useState(initialIncludeSystem);
  const [scanning, setScanning] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailPackage, setDetailPackage] = useState<InstalledPackage | null>(null);

  useEffect(() => {
    const packagesWithoutIcons = packages.filter((item) => !item.icon_url);
    if (packagesWithoutIcons.length === 0) {
      return;
    }

    let cancelled = false;

    async function loadIcons() {
      try {
        const result = await invoke<PackageIconResult>("load_package_icons", {
          request: { packages: packagesWithoutIcons },
        });
        if (cancelled) {
          return;
        }

        const iconById = new Map(
          result.items
            .filter((item) => item.icon_url)
            .map((item) => [item.id, item.icon_url] as const),
        );
        if (iconById.size === 0) {
          return;
        }

        setPackages((current) =>
          current.map((item) => {
            const iconUrl = iconById.get(item.id);
            return iconUrl ? { ...item, icon_url: iconUrl } : item;
          }),
        );
      } catch {
        // 图标不是核心数据，加载失败时保留字母 fallback。
      }
    }

    void loadIcons();

    return () => {
      cancelled = true;
    };
  }, [packages]);

  const filteredPackages = useMemo(() => {
    const keyword = query.trim().toLowerCase();

    return packages
      .filter((item) => {
        const matchesManager = managerFilter === "all" || item.manager === managerFilter;
        const matchesQuery =
          keyword.length === 0 ||
          item.name.toLowerCase().includes(keyword) ||
          item.package_id.toLowerCase().includes(keyword) ||
          item.description.toLowerCase().includes(keyword);

        return matchesManager && matchesQuery;
      })
      .sort((left, right) => {
        if (right.size !== left.size) {
          return right.size - left.size;
        }

        return left.name.toLowerCase().localeCompare(right.name.toLowerCase());
      });
  }, [managerFilter, packages, query]);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedSummary = useMemo(() => {
    let privilegeCount = 0;
    let selectedSize = 0;

    for (const item of packages) {
      if (!selectedIdSet.has(item.id)) {
        continue;
      }
      selectedSize += item.size;
      if (item.requires_privilege) {
        privilegeCount += 1;
      }
    }

    return { privilegeCount, selectedSize };
  }, [packages, selectedIdSet]);
  const availableManagers = useMemo(
    () => managers.filter((item) => item.available).length,
    [managers],
  );
  const { privilegeCount, selectedSize } = selectedSummary;
  const busy = scanning || uninstalling;
  const copy = platformCopy[platform];

  async function scanPackages(nextIncludeSystem = includeSystem) {
    if (busy) {
      return;
    }

    setScanning(true);
    setError(null);
    setConfirming(false);
    setDetailPackage(null);

    try {
      await waitForNextFrame();
      const result = await invoke<PackageScanResult>("list_installed_packages", {
        request: { include_system: nextIncludeSystem },
      });
      setPackages(result.packages);
      setManagers(result.managers);
      setSelectedIds([]);
      onScanComplete(result, nextIncludeSystem);
    } catch (scanError) {
      setError(String(scanError));
    } finally {
      setScanning(false);
    }
  }

  async function uninstallSelected() {
    if (selectedIds.length === 0 || busy) {
      return;
    }

    setUninstalling(true);
    setError(null);
    setDetailPackage(null);

    try {
      await waitForNextFrame();
      const result = await invoke<PackageUninstallResult>("uninstall_packages", {
        request: { ids: selectedIds },
      });
      const removed = new Set(
        result.items.filter((item) => item.success).map((item) => item.id),
      );
      setPackages((current) => current.filter((item) => !removed.has(item.id)));
      setSelectedIds([]);
      setConfirming(false);
      onUninstallComplete(result);

      if (result.failed_count > 0) {
        setError("部分软件包卸载失败。");
      }
    } catch (uninstallError) {
      setError(String(uninstallError));
    } finally {
      setUninstalling(false);
    }
  }

  function togglePackage(id: string) {
    if (busy) {
      return;
    }

    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
    setConfirming(false);
  }

  function toggleSystemPackages(checked: boolean) {
    if (busy) {
      return;
    }

    setIncludeSystem(checked);
    if (packages.length > 0) {
      void scanPackages(checked);
    }
  }

  return (
    <PageSurface className="flex h-full min-h-0 flex-col max-[720px]:h-auto">
      <ToolStrip className="mb-3 min-h-9">
        <p>{copy.description}</p>
        <Button
          disabled={busy}
          onClick={() => void scanPackages()}
          variant="outline"
        >
          <Search className={scanning ? "animate-spin" : undefined} size={16} />
          {scanning ? "扫描中" : packages.length > 0 ? "重新扫描" : "扫描应用"}
        </Button>
      </ToolStrip>

      <StatGrid className="mb-3">
        <StatCard icon={Package} label="已安装" value={formatCount(packages.length)} caption="当前扫描结果" />
        <StatCard icon={Box} label="来源" value={formatCount(availableManagers)} caption={copy.caption} />
        <StatCard icon={Trash2} label="已选择" value={formatSize(selectedSize)} caption={`${formatCount(selectedIds.length)} 个软件包`} />
      </StatGrid>

      <div className="mb-2.5 flex flex-wrap items-center gap-2 max-[720px]:items-start">
        <button
          className={cn(
            "min-h-[30px] rounded-full border px-3.5 text-xs font-semibold",
            managerFilter === "all"
              ? "border-[#111111] bg-[#111111] text-white"
              : "border-[#dedede] bg-white text-[#333333]",
            "disabled:text-[#9a9a9a] disabled:opacity-60",
          )}
          disabled={busy}
          onClick={() => setManagerFilter("all")}
          type="button"
        >
          全部
        </button>
        {managers.map((manager) => (
          <button
            className={cn(
              "min-h-[30px] rounded-full border px-3.5 text-xs font-semibold",
              managerFilter === manager.id
                ? "border-[#111111] bg-[#111111] text-white"
                : "border-[#dedede] bg-white text-[#333333]",
              "disabled:text-[#9a9a9a] disabled:opacity-60",
            )}
            disabled={!manager.available || busy}
            key={manager.id}
            onClick={() => setManagerFilter(manager.id)}
            type="button"
          >
            {manager.name}
          </button>
        ))}
        <label className="ml-auto inline-flex min-h-[30px] items-center gap-2 text-xs font-semibold text-[#555555] max-[720px]:ml-0 max-[720px]:w-full">
          <Switch
            checked={includeSystem}
            disabled={busy}
            onCheckedChange={toggleSystemPackages}
            size="sm"
          />
          <span>显示系统组件</span>
        </label>
      </div>

      <div className="mb-3">
        <InputGroup className={searchGroupClass}>
          <InputGroupAddon>
            <Search size={16} />
          </InputGroupAddon>
          <InputGroupInput
            className="h-10 px-0 text-[13px]"
            disabled={busy}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索包名、应用名或描述"
            type="search"
            value={query}
          />
        </InputGroup>
      </div>

      {error ? <InlineMessage kind="error">{error}</InlineMessage> : null}

      <ResultPanel className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PanelTitle
          actions={
            confirming ? (
              <div className="flex gap-2">
                <Button
                  disabled={uninstalling}
                  onClick={() => setConfirming(false)}
                  variant="outline"
                >
                  取消
                </Button>
                <Button disabled={uninstalling} onClick={uninstallSelected} variant="default">
                  <Trash2 className={uninstalling ? "animate-spin" : undefined} size={16} />
                  {uninstalling ? "卸载中" : "确认卸载"}
                </Button>
              </div>
            ) : (
              <Button
                disabled={selectedIds.length === 0 || busy}
                onClick={() => setConfirming(true)}
                variant="default"
              >
                <Trash2 size={16} />
                卸载所选
              </Button>
            )
          }
        >
          <div>
            <strong>应用包</strong>
            <span>
              {busy ? (scanning ? "扫描中" : "处理中") : `${filteredPackages.length} 项`}
            </span>
          </div>
        </PanelTitle>

        {confirming && privilegeCount > 0 ? (
          <div className="flex min-h-[38px] items-center gap-2 border-b border-[#f1d4b8] bg-[#fff9f2] px-5 text-[13px] text-[#8a4b12]">
            <ShieldAlert size={16} />
            <span>{privilegeCount} {copy.privilege}</span>
          </div>
        ) : null}

        {busy ? (
          <ActivityPanel
            caption={
              scanning
                ? copy.scanning
                : `正在处理 ${selectedIds.length} 个已确认软件包`
            }
            icon={scanning ? Search : Trash2}
            title={scanning ? "正在扫描应用包" : "正在卸载所选应用"}
          />
        ) : (
          <PackageRows
            packages={filteredPackages}
            selectedIdSet={selectedIdSet}
            onShowDetails={setDetailPackage}
            onTogglePackage={togglePackage}
          />
        )}
      </ResultPanel>

      <Dialog
        open={Boolean(detailPackage)}
        onOpenChange={(open) => {
          if (!open) {
            setDetailPackage(null);
          }
        }}
      >
        {detailPackage ? (
          <PackageDetailModal
            packageItem={detailPackage}
            onClose={() => setDetailPackage(null)}
          />
        ) : null}
      </Dialog>
    </PageSurface>
  );
}

function PackageRows({
  packages,
  selectedIdSet,
  onShowDetails,
  onTogglePackage,
}: {
  packages: InstalledPackage[];
  selectedIdSet: Set<string>;
  onShowDetails: (packageItem: InstalledPackage) => void;
  onTogglePackage: (id: string) => void;
}) {
  const [contextMenu, setContextMenu] = useState<{
    packageItem: InstalledPackage;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    let removeClickListener = false;

    function closeContextMenu() {
      setContextMenu(null);
    }

    function closeContextMenuOnClick(event: MouseEvent) {
      if (event.button !== 0) {
        return;
      }

      setContextMenu(null);
    }

    function closeContextMenuOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    }

    const listenerTimer = window.setTimeout(() => {
      window.addEventListener("click", closeContextMenuOnClick);
      removeClickListener = true;
    }, 0);

    window.addEventListener("scroll", closeContextMenu, true);
    window.addEventListener("keydown", closeContextMenuOnEscape);

    return () => {
      window.clearTimeout(listenerTimer);
      if (removeClickListener) {
        window.removeEventListener("click", closeContextMenuOnClick);
      }
      window.removeEventListener("scroll", closeContextMenu, true);
      window.removeEventListener("keydown", closeContextMenuOnEscape);
    };
  }, [contextMenu]);

  if (packages.length === 0) {
    return (
      <CleanupEmptyState
        description="扫描后会显示当前系统中可识别的软件包。"
        icon={Package}
        title="暂无应用包"
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" role="table" aria-label="应用包">
      <div
        className={cn(
          packageGridClass,
          "min-h-8 border-b border-[#e7e7e7] bg-[#fafafa] px-5 text-[11px] font-bold text-[#6f6f6f]",
          "max-[720px]:[&_span:nth-child(3)]:hidden max-[720px]:[&_span:nth-child(4)]:hidden",
        )}
        role="row"
      >
        <span role="columnheader">来源</span>
        <span role="columnheader">应用</span>
        <span role="columnheader">版本</span>
        <span className="text-right" role="columnheader">大小</span>
        <span className="text-right" role="columnheader">选择</span>
      </div>

      <div className="min-h-0 overflow-auto">
        {packages.map((item) => {
          const checked = selectedIdSet.has(item.id);

          return (
            <label
              aria-selected={checked}
              className={cn(
                packageGridClass,
                "min-h-[54px] w-full cursor-pointer border-0 border-b border-[#eeeeee] bg-white px-5 py-2 text-left [content-visibility:auto] [contain-intrinsic-size:54px] hover:bg-[#fafafa]",
                checked && "bg-[#f7f7f7] shadow-[inset_3px_0_0_#181818]",
              )}
              key={item.id}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({
                  packageItem: item,
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
              role="row"
            >
              <span className="inline-flex min-h-[22px] w-fit min-w-[52px] items-center justify-center rounded-full bg-[#f0f0f0] text-[11px] font-bold text-[#222222]" role="cell">
                {managerLabels[item.manager] ?? item.manager}
              </span>
              <span className="grid min-w-0 grid-cols-[30px_minmax(0,1fr)] items-center gap-2.5" role="cell">
                <PackageIcon packageItem={item} />
                <span className="grid min-w-0 gap-1">
                  <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-[720] text-[#111111]">
                    {item.name}
                  </strong>
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-[#707070]">
                    {item.description || item.package_id}
                  </span>
                </span>
              </span>
              <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-[#707070] max-[720px]:hidden" role="cell">
                {item.version || "-"}
              </span>
              <span className="overflow-hidden text-ellipsis whitespace-nowrap text-right text-[11px] font-bold text-[#111111] max-[720px]:hidden" role="cell">
                {item.size > 0 ? formatSize(item.size) : "-"}
              </span>
              <span className="flex justify-end" role="cell">
                <Checkbox
                  aria-label={`选择${item.name}`}
                  checked={checked}
                  onChange={() => onTogglePackage(item.id)}
                />
              </span>
            </label>
          );
        })}
      </div>

      {contextMenu ? (
        <PackageContextMenu
          packageItem={contextMenu.packageItem}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onShowDetails={onShowDetails}
        />
      ) : null}
    </div>
  );
}

function PackageContextMenu({
  packageItem,
  x,
  y,
  onClose,
  onShowDetails,
}: {
  packageItem: InstalledPackage;
  x: number;
  y: number;
  onClose: () => void;
  onShowDetails: (packageItem: InstalledPackage) => void;
}) {
  const left = Math.max(8, Math.min(x, window.innerWidth - 184));
  const top = Math.max(8, Math.min(y, window.innerHeight - 48));

  return (
    <div
      className="fixed z-[60] w-[168px] rounded-md border border-[#d4d4d8] bg-white p-1 text-[#18181b] shadow-lg"
      role="menu"
      style={{ left, top }}
    >
      <button
        className="flex min-h-8 w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] font-medium text-[#18181b] hover:bg-[#f4f4f5]"
        onClick={() => {
          onShowDetails(packageItem);
          onClose();
        }}
        role="menuitem"
        type="button"
      >
        <Info size={15} />
        <span>查看详情</span>
      </button>
    </div>
  );
}

function PackageDetailModal({
  packageItem,
  onClose,
}: {
  packageItem: InstalledPackage;
  onClose: () => void;
}) {
  const managerLabel = managerLabels[packageItem.manager] ?? packageItem.manager;
  const sourceLabel =
    packageItem.source === "user"
      ? "用户安装"
      : packageItem.source === "system"
        ? "系统安装"
        : packageItem.source === "applications"
          ? "Applications"
          : packageItem.source === "homebrew"
            ? "Homebrew"
            : packageItem.source === "HKCU"
              ? "当前用户"
              : packageItem.source === "HKLM"
                ? "本机"
        : packageItem.source || "-";
  const privilegeLabel = packageItem.requires_privilege
    ? "需要管理员权限"
    : "通常无需管理员权限";

  return (
    <DialogContent
      className="max-h-[calc(100vh-48px)] w-[min(560px,calc(100vw-32px))] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0"
      showCloseButton={false}
    >
      <header className="grid min-h-[68px] grid-cols-[38px_minmax(0,1fr)_34px] items-center gap-3 border-b border-[#eeeeee] bg-white py-3 pr-3.5 pl-4">
        <PackageIcon className="size-[38px] rounded-lg text-sm" packageItem={packageItem} />
        <div className="grid min-w-0 gap-1.5">
          <DialogTitle className="overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-[760] leading-tight text-[#111111] max-[720px]:whitespace-normal">
            {packageItem.name}
          </DialogTitle>
          <DialogDescription className="overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-tight text-[#707070] max-[720px]:whitespace-normal">
            {packageItem.package_id}
          </DialogDescription>
        </div>
        <Button
          aria-label="关闭详情"
          className="w-[34px] min-w-[34px] p-0"
          onClick={onClose}
          variant="ghost"
        >
          <X size={16} />
        </Button>
      </header>

      <div className="min-h-0 overflow-y-auto bg-white">
        <div className="grid grid-cols-2 gap-2.5 px-4 py-3.5 max-[720px]:grid-cols-1">
          <PackageDetailField label="包管理器" value={managerLabel} />
          <PackageDetailField
            label="大小"
            value={packageItem.size > 0 ? formatSize(packageItem.size) : "-"}
          />
          <PackageDetailField label="版本" value={packageItem.version || "-"} />
          <PackageDetailField label="来源" value={sourceLabel} />
          <PackageDetailField label="权限" value={privilegeLabel} />
          <PackageDetailField
            className="col-span-2 max-[720px]:col-span-1"
            label="内部 ID"
            value={packageItem.id}
          />
        </div>

        <div className="border-t border-[#eeeeee] px-4 pt-3.5 pb-4">
          <strong className="block text-[13px] font-[760] leading-tight text-[#171717]">
            描述
          </strong>
          <p className="mt-2 text-[13px] leading-normal text-[#555555] [overflow-wrap:anywhere]">
            {packageItem.description || "无描述"}
          </p>
        </div>
      </div>
    </DialogContent>
  );
}

function PackageDetailField({
  className,
  label,
  value,
}: {
  className?: string;
  label: string;
  value: string;
}) {
  return (
    <div className={cn("grid min-w-0 gap-1 rounded-md border border-[#eeeeee] bg-[#fafafa] p-2.5", className)}>
      <span className="text-[11px] font-bold leading-tight text-[#737373]">{label}</span>
      <strong className="text-[13px] font-semibold leading-snug text-[#171717] [overflow-wrap:anywhere]">
        {value}
      </strong>
    </div>
  );
}

function PackageIcon({
  className,
  packageItem,
}: {
  className?: string;
  packageItem: InstalledPackage;
}) {
  const [failed, setFailed] = useState(false);
  const src = packageItem.icon_url && !failed ? packageItem.icon_url : null;
  const fallback = (packageItem.name.trim() || packageItem.package_id.trim() || "?")
    .slice(0, 1)
    .toUpperCase();

  return (
    <span
      className={cn(
        "grid size-[30px] place-items-center overflow-hidden rounded-[7px] bg-[#f2f2f2] text-xs font-[760] leading-none text-[#404040]",
        src ? "" : "border border-[#e5e5e5]",
        className,
      )}
      aria-hidden="true"
    >
      {src ? (
        <img
          className="size-full object-contain"
          alt=""
          onError={() => setFailed(true)}
          src={src}
        />
      ) : (
        fallback
      )}
    </span>
  );
}
