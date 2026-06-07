import { formatSize } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import type { DiskStatus } from "../../types/cleanup";
import { DetailLine } from "./DetailLine";

export function DiskStatusPanel({ diskStatus }: { diskStatus: DiskStatus | null }) {
  const { t } = useI18n();
  const percent = diskStatus?.used_percent ?? 0;

  return (
    <section className="rounded-lg border border-black/5 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <h2 className="text-[13px] font-[680] leading-tight tracking-normal text-[#14191f]">
        {t("systemStatus.title")}
      </h2>
      <div className="mt-3.5 grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3">
        <div
          className="grid size-[68px] place-items-center rounded-full"
          style={{ background: `conic-gradient(#145c53 ${percent}%, #e4e8e6 0)` }}
        >
          <div className="grid size-12 place-items-center rounded-full bg-[#f5f7f6]">
            <strong className="text-lg font-[760] leading-none text-[#111820]">
              {diskStatus ? `${percent}%` : "--"}
            </strong>
            <span className="mt-1 text-[10px] text-[#6f7782]">{t("systemStatus.used")}</span>
          </div>
        </div>

        <div className="grid gap-1.5">
          <DetailLine label={t("overview.disk.total")} value={formatSize(diskStatus?.total ?? 0)} />
          <DetailLine label={t("overview.disk.used")} value={formatSize(diskStatus?.used ?? 0)} />
          <DetailLine label={t("overview.disk.available")} value={formatSize(diskStatus?.available ?? 0)} />
        </div>
      </div>
      {diskStatus ? (
        <code className="mt-3 block max-w-full whitespace-pre-wrap rounded-md border border-black/5 bg-[#f1f3f2] px-1.5 py-1 font-mono text-[11px] leading-normal text-[#5d6670] [overflow-wrap:anywhere]">
          {diskStatus.mount_point}
        </code>
      ) : null}
    </section>
  );
}
