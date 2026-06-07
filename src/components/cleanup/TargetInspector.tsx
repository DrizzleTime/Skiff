import { Badge } from "../ui/badge";
import { categoryLabelKeys, riskLabelKeys } from "../../lib/cleanup";
import { formatCount, formatSize } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { getLocalizedTarget } from "../../lib/targetTranslations";
import type { CleanupTarget } from "../../types/cleanup";
import { DetailLine } from "./DetailLine";

export function TargetInspector({ target }: { target: CleanupTarget | null }) {
  const { locale, t } = useI18n();

  if (!target) {
    return (
      <section className="rounded-lg border border-black/5 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <h2 className="text-[13px] font-[680] leading-tight tracking-normal text-[#14191f]">
          {t("inspector.title")}
        </h2>
        <p className="mt-2 text-xs leading-normal text-[#7c8490]">
          {t("inspector.noTarget")}
        </p>
      </section>
    );
  }

  const targetCopy = getLocalizedTarget(target, locale);

  return (
    <section className="rounded-lg border border-black/5 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <h2 className="text-[13px] font-[680] leading-tight tracking-normal text-[#14191f]">
        {t("inspector.title")}
      </h2>
      <div className="mt-3 flex items-center justify-between gap-2">
        <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-[680] text-[#151b22]">
          {targetCopy.name}
        </strong>
        <Badge variant={target.risk}>{t(riskLabelKeys[target.risk])}</Badge>
      </div>
      <p className="mt-2 text-xs leading-normal text-[#7c8490]">{targetCopy.description}</p>

      <div className="mt-3 grid gap-1.5">
        <DetailLine label={t("inspector.category")} value={t(categoryLabelKeys[target.category])} />
        <DetailLine label={t("inspector.size")} value={formatSize(target.size)} />
        <DetailLine label={t("inspector.files")} value={formatCount(target.files, locale)} />
        <DetailLine label={t("inspector.status")} value={target.cleanable ? t("inspector.targetCleanable") : target.exists ? t("inspector.exists") : t("inspector.missing")} />
        <DetailLine label={t("apps.packageDetail.permission")} value={target.requires_privilege ? t("inspector.needsPrivilege") : t("inspector.currentUser")} />
      </div>

      <code className="mt-3 block max-w-full whitespace-pre-wrap rounded-md border border-black/5 bg-[#f1f3f2] px-1.5 py-1 font-mono text-[11px] leading-normal text-[#5d6670] [overflow-wrap:anywhere]">
        {target.path}
      </code>
      {target.error ? (
        <p className="mt-2.5 text-xs leading-normal text-[#991b1b]">{target.error}</p>
      ) : null}
    </section>
  );
}
