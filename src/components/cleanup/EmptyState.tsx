import { Search } from "lucide-react";
import { useI18n } from "../../lib/i18n";
import type { ActiveView } from "../../types/cleanup";
import { CleanupEmptyState } from "./CleanupEmptyState";

export function EmptyState({ activeView }: { activeView: ActiveView }) {
  const { t } = useI18n();
  const title =
    activeView === "junk" ? t("empty.scan.notScanned") : t("empty.scan.noResult");

  return (
    <CleanupEmptyState
      description={t("empty.scan.description")}
      icon={Search}
      title={title}
    />
  );
}
