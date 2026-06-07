import skiffLogo from "../../assets/skiff-logo.svg";
import { navItems, viewLabelKeys } from "../../lib/cleanup";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import type { ActiveView } from "../../types/cleanup";

export function AppSidebar({
  activeView,
  onSelectView,
  sizeForView,
}: {
  activeView: ActiveView;
  onSelectView: (view: ActiveView) => void;
  sizeForView: (view: ActiveView) => string;
}) {
  const { t } = useI18n();

  return (
    <aside className="flex min-w-0 flex-col border-r border-[#e7e7e7] bg-[#fafafa] max-[720px]:border-r-0 max-[720px]:border-b max-[720px]:border-[#d8d8d8]">
      <div className="flex min-h-[72px] items-center gap-3 px-[18px] max-[720px]:min-h-[58px]">
        <div className="grid size-7 place-items-center text-[#121212]">
          <img className="block size-[25px]" src={skiffLogo} alt="" aria-hidden="true" />
        </div>
        <div>
          <strong className="block text-[22px] font-extrabold leading-none tracking-normal text-[#121212]">
            Skiff
          </strong>
          <span className="mt-0.5 block text-xs leading-tight text-[#7a7a7a]">
            {t("sidebar.slogan")}
          </span>
        </div>
      </div>

      <nav className="grid gap-0.5 px-2.5 py-1.5 max-[720px]:grid-cols-2" aria-label={t("nav.aria")}>
        {navItems.map((item) => {
          const Icon = item.icon;
          const sizeLabel = sizeForView(item.key);

          return (
            <button
              className={cn(
                "flex min-h-[38px] w-full items-center justify-between rounded-md border-0 bg-transparent px-2.5 text-left text-[#242424] hover:bg-[#f0f0f0] hover:text-[#090909]",
                activeView === item.key && "bg-[#f0f0f0] text-[#090909]",
              )}
              key={item.key}
              onClick={() => onSelectView(item.key)}
              type="button"
            >
              <span className="inline-flex min-w-0 items-center gap-2 text-[13px] font-[650] leading-none">
                <Icon size={17} strokeWidth={1.9} />
                {t(viewLabelKeys[item.key])}
              </span>
              {sizeLabel ? (
                <strong className="max-w-[82px] overflow-hidden text-ellipsis whitespace-nowrap rounded-full bg-[#eeeeee] px-2 text-[11px] font-[560] leading-5 text-[#4b4b4b]">
                  {sizeLabel}
                </strong>
              ) : null}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
