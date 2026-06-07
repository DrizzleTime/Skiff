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
      <section className="rounded-md border border-[#e5e5e5] bg-white p-3">
        <h2 className="text-[13px] font-[760] leading-tight tracking-normal text-[#151515]">
          {t("inspector.title")}
        </h2>
        <p className="mt-2 text-xs leading-normal text-[#707070]">
          {t("inspector.noTarget")}
        </p>
      </section>
    );
  }

  const targetCopy = getLocalizedTarget(target, locale);

  return (
    <section className="rounded-md border border-[#e5e5e5] bg-white p-3">
      <h2 className="text-[13px] font-[760] leading-tight tracking-normal text-[#151515]">
        {t("inspector.title")}
      </h2>
      <div className="mt-3 flex items-center justify-between gap-2">
        <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-[720] text-[#171717]">
          {targetCopy.name}
        </strong>
        <Badge variant={target.risk}>{t(riskLabelKeys[target.risk])}</Badge>
      </div>
      <p className="mt-2 text-xs leading-normal text-[#707070]">{targetCopy.description}</p>

      <div className="mt-3 grid gap-1.5">
        <DetailLine label={t("inspector.category")} value={t(categoryLabelKeys[target.category])} />
        <DetailLine label={t("inspector.size")} value={formatSize(target.size)} />
        <DetailLine label={t("inspector.files")} value={formatCount(target.files, locale)} />
        <DetailLine label={t("inspector.status")} value={target.cleanable ? t("inspector.targetCleanable") : target.exists ? t("inspector.exists") : t("inspector.missing")} />
        <DetailLine label={t("apps.packageDetail.permission")} value={target.requires_privilege ? t("inspector.needsPrivilege") : t("inspector.currentUser")} />
      </div>

      <code className="mt-3 block max-w-full whitespace-pre-wrap rounded-[5px] border border-[#dddddd] bg-[#eeeeee] px-1.5 py-1 font-mono text-[11px] leading-normal text-[#555555] [overflow-wrap:anywhere]">
        {target.path}
      </code>
      {target.error ? (
        <p className="mt-2.5 text-xs leading-normal text-[#991b1b]">{target.error}</p>
      ) : null}
    </section>
  );
}
