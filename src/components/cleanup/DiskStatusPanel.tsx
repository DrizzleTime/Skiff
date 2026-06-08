import { formatSize } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import type { DiskStatus } from "../../types/cleanup";
import { DetailLine } from "./DetailLine";

export function DiskStatusPanel({ diskStatus }: { diskStatus: DiskStatus | null }) {
  const { t } = useI18n();
  const percent = Math.min(100, Math.max(0, diskStatus?.used_percent ?? 0));

  return (
    <section className="rounded-lg border border-black/5 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[13px] font-[680] leading-tight tracking-normal text-[#14191f]">
            {t("systemStatus.title")}
          </h2>
          <span className="mt-1 block text-[11px] leading-tight text-[#7c8490]">
            {diskStatus?.mount_point ?? t("overview.disk.mountMissing")}
          </span>
        </div>
        <strong className="whitespace-nowrap text-lg font-[760] leading-none text-[#111820]">
          {diskStatus ? `${percent}%` : "--"}
        </strong>
      </div>

      <div className="mt-3">
        <div className="h-2 overflow-hidden rounded-full bg-[#e8ecea]" aria-label={t("systemStatus.used")}>
          <span
            className="block h-full rounded-full bg-[#145c53]"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      <div className="mt-3 grid gap-1.5">
        <DetailLine label={t("overview.disk.total")} value={formatSize(diskStatus?.total ?? 0)} />
        <DetailLine label={t("overview.disk.used")} value={formatSize(diskStatus?.used ?? 0)} />
        <DetailLine label={t("overview.disk.available")} value={formatSize(diskStatus?.available ?? 0)} />
      </div>

      {diskStatus ? (
        <p className="mt-3 min-w-0 rounded-md bg-[#f5f6f5] px-2 py-1.5 text-[11px] leading-normal text-[#68717b] [overflow-wrap:anywhere]">
          <span className="font-[680] text-[#4f5863]">{t("overview.disk.mount")}</span>
          {" "}
          {diskStatus.mount_point}
        </p>
      ) : null}
    </section>
  );
}
