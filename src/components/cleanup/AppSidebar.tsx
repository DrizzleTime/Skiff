import skiffLogo from "../../assets/skiff-logo.svg";
import { Grid2X2, Sparkles } from "lucide-react";
import { advancedViewKeys, navItems, viewLabelKeys } from "../../lib/cleanup";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import type { ActiveView, AppMode } from "../../types/cleanup";

export function AppSidebar({
  activeView,
  mode,
  onSelectMode,
  onSelectView,
  showAdvancedFeatures,
  sizeForView,
}: {
  activeView: ActiveView;
  mode: AppMode;
  onSelectMode: (mode: AppMode) => void;
  onSelectView: (view: ActiveView) => void;
  showAdvancedFeatures: boolean;
  sizeForView: (view: ActiveView) => string;
}) {
  const { t } = useI18n();
  const visibleNavItems = navItems.filter(
    (item) => showAdvancedFeatures || !advancedViewKeys.has(item.key) || item.key === activeView,
  );

  return (
    <aside className="skiff-sidebar flex min-w-0 flex-col border-r border-black/5 bg-[#f3f5f7] max-[720px]:border-r-0 max-[720px]:border-b max-[720px]:border-black/10">
      <div className="flex min-h-[78px] items-center gap-3 px-5 max-[720px]:min-h-[58px]">
        <div className="grid size-9 place-items-center rounded-lg border border-black/5 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
          <img className="block size-[23px]" src={skiffLogo} alt="" aria-hidden="true" />
        </div>
        <div>
          <strong className="block text-[22px] font-[760] leading-none tracking-normal text-[#101419]">
            Skiff
          </strong>
          <span className="mt-1 block text-xs leading-tight text-[#7a828c]">
            {t("sidebar.slogan")}
          </span>
        </div>
      </div>

      {mode === "classic" ? (
        <nav className="grid gap-1 px-3 py-2 max-[720px]:grid-cols-2" aria-label={t("nav.aria")}>
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const sizeLabel = sizeForView(item.key);

            return (
              <button
                className={cn(
                  "flex min-h-[40px] w-full items-center justify-between rounded-lg border border-transparent bg-transparent px-3 text-left text-[#333b45] transition-colors hover:bg-white/70 hover:text-[#101419]",
                  activeView === item.key &&
                    "border-black/5 bg-white text-[#101419] shadow-[0_1px_2px_rgba(15,23,42,0.06)]",
                )}
                key={item.key}
                onClick={() => onSelectView(item.key)}
                type="button"
              >
                <span className="inline-flex min-w-0 items-center gap-2.5 text-[13px] font-[620] leading-none">
                  <Icon className={activeView === item.key ? "text-[#145c53]" : undefined} size={17} strokeWidth={1.9} />
                  {t(viewLabelKeys[item.key])}
                </span>
                {sizeLabel ? (
                  <strong className="max-w-[82px] overflow-hidden text-ellipsis whitespace-nowrap rounded-full bg-white/80 px-2 text-[11px] font-[560] leading-5 text-[#59626e]">
                    {sizeLabel}
                  </strong>
                ) : null}
              </button>
            );
          })}
        </nav>
      ) : (
        <nav className="grid gap-1 px-3 py-2" aria-label={t("nav.aria")}>
          <button
            className="flex min-h-[40px] w-full items-center justify-between rounded-lg border border-black/5 bg-white px-3 text-left text-[#101419] shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
            type="button"
          >
            <span className="inline-flex min-w-0 items-center gap-2.5 text-[13px] font-[620] leading-none">
              <Sparkles className="text-[#145c53]" size={17} strokeWidth={1.9} />
              {t("nav.spaceAnalysis")}
            </span>
          </button>
        </nav>
      )}

      <div className="mt-auto px-3 pb-4 pt-3 max-[720px]:mt-0 max-[720px]:pb-3">
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-black/5 bg-white/70 p-1 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          {modeOptions.map((item) => {
            const Icon = item.icon;

            return (
              <button
                className={cn(
                  "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 text-xs font-[650] text-[#59626e] transition-all duration-200 ease-out hover:bg-white hover:text-[#101419]",
                  mode === item.key &&
                    "border-black/5 bg-white text-[#101419] shadow-[0_1px_2px_rgba(15,23,42,0.06)]",
                )}
                key={item.key}
                onClick={() => onSelectMode(item.key)}
                type="button"
              >
                <Icon size={14} strokeWidth={2} />
                {t(item.labelKey)}
              </button>
            );
          })}
        </div>
      </div>

    </aside>
  );
}

const modeOptions: Array<{
  key: AppMode;
  icon: typeof Grid2X2;
  labelKey: "mode.classic" | "mode.space";
}> = [
  { key: "classic", icon: Grid2X2, labelKey: "mode.classic" },
  { key: "space", icon: Sparkles, labelKey: "mode.space" },
];
