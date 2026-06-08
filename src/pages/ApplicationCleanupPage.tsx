import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
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
import { MetricCell } from "../components/cleanup/MetricCell";
import {
  InlineMessage,
  PanelTitle,
  PageSurface,
  ResultPanel,
} from "../components/cleanup/PageChrome";
import { SummaryMetricStrip } from "../components/cleanup/SummaryStrip";
import { formatCount, formatSize } from "../lib/format";
import { useI18n, type I18nKey } from "../lib/i18n";
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
  pacman: "Pacman",
  flatpak: "Flatpak",
  "macos-app": "macOS",
  "homebrew-formula": "Brew",
  "homebrew-cask": "Cask",
  "windows-registry": "Windows",
};
const platformPrivilegeKeys = {
  linux: "apps.platform.linux.privilege",
  macos: "apps.platform.macos.privilege",
  windows: "apps.platform.windows.privilege",
} satisfies Record<"linux" | "macos" | "windows", I18nKey>;
const platformScanningKeys = {
  linux: "apps.platform.linux.scanning",
  macos: "apps.platform.macos.scanning",
  windows: "apps.platform.windows.scanning",
} satisfies Record<"linux" | "macos" | "windows", I18nKey>;
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
  onChromeChange,
  onScanComplete,
  onUninstallComplete,
}: {
  platform: "linux" | "macos" | "windows";
  initialIncludeSystem: boolean;
  initialScanResult: PackageScanResult | null;
  onChromeChange: (chrome: { actions: ReactNode; summary: ReactNode } | null) => void;
  onScanComplete: (result: PackageScanResult, includeSystem: boolean) => void;
  onUninstallComplete: (result: PackageUninstallResult) => void;
}) {
  const { locale, t } = useI18n();
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
        // Icons are optional data; keep the letter fallback when loading fails.
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
  const platformPrivilege = t(platformPrivilegeKeys[platform]);
  const platformScanning = t(platformScanningKeys[platform]);

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
        setError(t("apps.failed"));
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

  const toolbarActions = useMemo(
    () =>
      confirming ? (
        <>
          <Button
            className="h-9 gap-1.5 px-3.5 text-[13px]"
            disabled={uninstalling}
            onClick={() => setConfirming(false)}
            variant="outline"
          >
            <X size={16} />
            {t("actions.cancel")}
          </Button>
          <Button
            className="h-9 gap-1.5 px-3.5 text-[13px]"
            disabled={uninstalling || selectedIds.length === 0}
            onClick={uninstallSelected}
            variant="default"
          >
            <Trash2 className={uninstalling ? "animate-spin" : undefined} size={16} />
            {uninstalling ? t("common.processing") : t("actions.confirmUninstall")}
          </Button>
        </>
      ) : (
        <>
          <Button
            className="h-9 gap-1.5 px-3.5 text-[13px]"
            disabled={busy}
            onClick={() => void scanPackages()}
            variant="outline"
          >
            <Search className={scanning ? "animate-spin" : undefined} size={16} />
            {scanning ? t("common.scanning") : packages.length > 0 ? t("actions.rescan") : t("actions.scanApps")}
          </Button>
          <Button
            className="h-9 gap-1.5 px-3.5 text-[13px]"
            disabled={selectedIds.length === 0 || busy}
            onClick={() => setConfirming(true)}
            variant="default"
          >
            <Trash2 size={16} />
            {t("actions.uninstallSelected")}
          </Button>
        </>
      ),
    [busy, confirming, packages.length, scanning, selectedIds, t, uninstalling],
  );

  const chromeSummary = useMemo(
    () => (
      <SummaryMetricStrip>
        <MetricCell icon={Package} label={t("apps.stat.installed")} value={formatCount(packages.length, locale)} />
        <MetricCell icon={Box} label={t("apps.table.source")} value={formatCount(availableManagers, locale)} />
        <MetricCell icon={Trash2} label={t("summary.selected")} value={formatSize(selectedSize)} />
      </SummaryMetricStrip>
    ),
    [availableManagers, locale, packages.length, selectedSize, t],
  );

  useEffect(() => {
    onChromeChange({ actions: toolbarActions, summary: chromeSummary });
  }, [chromeSummary, onChromeChange, toolbarActions]);

  useEffect(() => () => onChromeChange(null), [onChromeChange]);

  return (
    <PageSurface className="flex h-full min-h-0 flex-col max-[720px]:h-auto">
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
          {t("apps.filter.all")}
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
          <span>{t("apps.includeSystem")}</span>
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
            placeholder={t("apps.searchPlaceholder")}
            type="search"
            value={query}
          />
        </InputGroup>
      </div>

      {error ? <InlineMessage kind="error">{error}</InlineMessage> : null}

      <ResultPanel className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PanelTitle>
          <div>
            <strong>{t("apps.title")}</strong>
            <span>
              {busy
                ? scanning
                  ? t("common.scanning")
                  : t("common.processing")
                : `${formatCount(filteredPackages.length, locale)} ${t("common.items")}`}
            </span>
          </div>
        </PanelTitle>

        {confirming && privilegeCount > 0 ? (
          <div className="flex min-h-[38px] items-center gap-2 border-b border-[#f1d4b8] bg-[#fff9f2] px-5 text-[13px] text-[#8a4b12]">
            <ShieldAlert size={16} />
            <span>{formatCount(privilegeCount, locale)} {platformPrivilege}</span>
          </div>
        ) : null}

        {busy ? (
          <ActivityPanel
            caption={
              scanning
                ? platformScanning
                : t("apps.activity.processing", {
                    count: formatCount(selectedIds.length, locale),
                  })
            }
            icon={scanning ? Search : Trash2}
            title={scanning ? t("apps.activity.scanTitle") : t("apps.activity.uninstallTitle")}
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
  const { t } = useI18n();
  const [contextMenu, setContextMenu] = useState<{
    packageItem: InstalledPackage;
    x: number;
    y: number;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    let removeListeners = false;

    function closeContextMenu() {
      setContextMenu(null);
    }

    function isInsideContextMenu(target: EventTarget | null) {
      return target instanceof Node && contextMenuRef.current?.contains(target);
    }

    function closeContextMenuOnPointerDown(event: PointerEvent) {
      if (event.button !== 0) {
        return;
      }
      if (isInsideContextMenu(event.target)) {
        return;
      }

      setContextMenu(null);
    }

    function closeContextMenuOnContextMenu(event: MouseEvent) {
      if (!isInsideContextMenu(event.target)) {
        setContextMenu(null);
      }
    }

    function closeContextMenuOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    }

    const listenerTimer = window.setTimeout(() => {
      window.addEventListener("pointerdown", closeContextMenuOnPointerDown);
      window.addEventListener("contextmenu", closeContextMenuOnContextMenu, true);
      window.addEventListener("scroll", closeContextMenu, true);
      window.addEventListener("keydown", closeContextMenuOnEscape);
      removeListeners = true;
    }, 0);

    return () => {
      window.clearTimeout(listenerTimer);
      if (removeListeners) {
        window.removeEventListener("pointerdown", closeContextMenuOnPointerDown);
        window.removeEventListener("contextmenu", closeContextMenuOnContextMenu, true);
        window.removeEventListener("scroll", closeContextMenu, true);
        window.removeEventListener("keydown", closeContextMenuOnEscape);
      }
    };
  }, [contextMenu]);

  if (packages.length === 0) {
    return (
      <CleanupEmptyState
        description={t("apps.empty.description")}
        icon={Package}
        title={t("apps.empty.title")}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" role="table" aria-label={t("apps.title")}>
      <div
        className={cn(
          packageGridClass,
          "min-h-8 border-b border-[#e7e7e7] bg-[#fafafa] px-5 text-[11px] font-bold text-[#6f6f6f]",
          "max-[720px]:[&_span:nth-child(3)]:hidden max-[720px]:[&_span:nth-child(4)]:hidden",
        )}
        role="row"
      >
        <span role="columnheader">{t("apps.table.source")}</span>
        <span role="columnheader">{t("apps.table.app")}</span>
        <span role="columnheader">{t("apps.table.version")}</span>
        <span className="text-right" role="columnheader">{t("apps.table.size")}</span>
        <span className="text-right" role="columnheader">{t("apps.table.select")}</span>
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
                  aria-label={t("file.select", { name: item.name })}
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
          menuRef={contextMenuRef}
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
  menuRef,
  packageItem,
  x,
  y,
  onClose,
  onShowDetails,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  packageItem: InstalledPackage;
  x: number;
  y: number;
  onClose: () => void;
  onShowDetails: (packageItem: InstalledPackage) => void;
}) {
  const { t } = useI18n();
  const left = Math.max(8, Math.min(x, window.innerWidth - 184));
  const top = Math.max(8, Math.min(y, window.innerHeight - 48));

  return (
    <div
      className="fixed z-[60] w-[168px] rounded-md border border-[#d4d4d8] bg-white p-1 text-[#18181b] shadow-lg"
      onContextMenu={(event) => event.preventDefault()}
      ref={menuRef}
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
        <span>{t("apps.viewDetails")}</span>
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
  const { t } = useI18n();
  const managerLabel = managerLabels[packageItem.manager] ?? packageItem.manager;
  const sourceLabel = packageSourceLabel(packageItem.source, t);
  const privilegeLabel = packageItem.requires_privilege
    ? t("apps.permission.needsAdmin")
    : t("apps.permission.usuallyNoAdmin");

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
          aria-label={t("apps.packageDetail.close")}
          className="w-[34px] min-w-[34px] p-0"
          onClick={onClose}
          variant="ghost"
        >
          <X size={16} />
        </Button>
      </header>

      <div className="min-h-0 overflow-y-auto bg-white">
        <div className="grid grid-cols-2 gap-2.5 px-4 py-3.5 max-[720px]:grid-cols-1">
          <PackageDetailField label={t("apps.packageDetail.manager")} value={managerLabel} />
          <PackageDetailField
            label={t("apps.packageDetail.size")}
            value={packageItem.size > 0 ? formatSize(packageItem.size) : "-"}
          />
          <PackageDetailField label={t("apps.packageDetail.version")} value={packageItem.version || "-"} />
          <PackageDetailField label={t("apps.packageDetail.source")} value={sourceLabel} />
          <PackageDetailField label={t("apps.packageDetail.permission")} value={privilegeLabel} />
          <PackageDetailField
            className="col-span-2 max-[720px]:col-span-1"
            label={t("apps.packageDetail.id")}
            value={packageItem.id}
          />
        </div>

        <div className="border-t border-[#eeeeee] px-4 pt-3.5 pb-4">
          <strong className="block text-[13px] font-[760] leading-tight text-[#171717]">
            {t("apps.packageDetail.description")}
          </strong>
          <p className="mt-2 text-[13px] leading-normal text-[#555555] [overflow-wrap:anywhere]">
            {packageItem.description || t("apps.noDescription")}
          </p>
        </div>
      </div>
    </DialogContent>
  );
}

function packageSourceLabel(source: string, t: (key: I18nKey) => string) {
  switch (source) {
    case "user":
      return t("apps.source.user");
    case "system":
      return t("apps.source.system");
    case "applications":
      return t("apps.source.applications");
    case "homebrew":
      return t("apps.source.homebrew");
    case "aur":
      return t("apps.source.aur");
    case "HKCU":
      return t("appData.permission.currentUser");
    case "HKLM":
      return t("appData.permission.localMachine");
    default:
      return source || "-";
  }
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
