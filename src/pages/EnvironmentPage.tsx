import { useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  CheckCircle2,
  CopyPlus,
  Filter,
  ListTree,
  Plus,
  RefreshCw,
  Save,
  Search,
  Terminal,
  Trash2,
  Variable,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { MetricCell } from "../components/cleanup/MetricCell";
import {
  InlineMessage,
  PageSurface,
  PanelTitle,
  ResultPanel,
} from "../components/cleanup/PageChrome";
import { SummaryMetricStrip } from "../components/cleanup/SummaryStrip";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../components/ui/input-group";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { useI18n } from "../lib/i18n";
import { cn } from "../lib/utils";
import type {
  EnvEntry,
  EnvEntryChange,
  EnvEntryKind,
  EnvEntrySource,
  EnvInventory,
  EnvInventorySaveResult,
  EnvShell,
  EnvShellConfig,
} from "../types/cleanup";

type LocalEnvEntry = EnvEntry & {
  deleted?: boolean;
  dirty?: boolean;
  isNew?: boolean;
  original_key: string;
  original_value: string;
};

type SourceFilter = "all" | EnvEntrySource | `shell:${EnvShell}`;
type KindFilter = "all" | EnvEntryKind;

const envKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const tableGridClass =
  "grid grid-cols-[70px_minmax(130px,180px)_minmax(220px,1fr)_136px_92px] items-center gap-3 max-[860px]:grid-cols-[62px_minmax(0,1fr)_76px]";

export function EnvironmentPage({
  onChromeChange,
}: {
  onChromeChange: (chrome: { actions: ReactNode; summary: ReactNode } | null) => void;
}) {
  const { t } = useI18n();
  const [shells, setShells] = useState<EnvShellConfig[]>([]);
  const [entries, setEntries] = useState<LocalEnvEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedShell, setSelectedShell] = useState<EnvShell | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [onlyActionable, setOnlyActionable] = useState(false);
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void scanInventory();
  }, []);

  const visibleEntries = useMemo(() => {
    const keyword = query.trim().toLowerCase();

    return entries.filter((entry) => {
      if (entry.deleted) {
        return false;
      }

      if (kindFilter !== "all" && entry.kind !== kindFilter) {
        return false;
      }

      if (sourceFilter !== "all") {
        if (sourceFilter.startsWith("shell:")) {
          const shell = sourceFilter.replace("shell:", "") as EnvShell;
          if (entry.shell !== shell) {
            return false;
          }
        } else if (entry.source !== sourceFilter) {
          return false;
        }
      }

      if (onlyActionable && !entry.editable && !entry.importable) {
        return false;
      }

      return (
        keyword.length === 0 ||
        entry.key.toLowerCase().includes(keyword) ||
        entry.value.toLowerCase().includes(keyword) ||
        entry.source_label.toLowerCase().includes(keyword)
      );
    });
  }, [entries, kindFilter, onlyActionable, query, sourceFilter]);

  const selectedEntry =
    entries.find((entry) => entry.id === selectedId && !entry.deleted) ??
    visibleEntries[0] ??
    null;
  const dirtyEntries = entries.filter((entry) => entry.dirty || entry.deleted || entry.isNew);
  const variableCount = entries.filter((entry) => !entry.deleted && entry.kind === "variable").length;
  const pathCount = entries.filter((entry) => !entry.deleted && entry.kind === "path").length;
  const editableCount = entries.filter((entry) => !entry.deleted && entry.editable).length;

  const toolbarActions = useMemo(
    () =>
      confirming ? (
        <>
          <Button
            className="h-9 gap-1.5 px-3.5 text-[13px]"
            disabled={saving}
            onClick={() => setConfirming(false)}
            variant="outline"
          >
            <X size={16} />
            {t("actions.cancel")}
          </Button>
          <Button
            className="h-9 gap-1.5 px-3.5 text-[13px]"
            disabled={saving || dirtyEntries.length === 0}
            onClick={() => void saveChanges()}
          >
            <Save className={saving ? "animate-spin" : undefined} size={16} />
            {t("env.confirmSave")}
          </Button>
        </>
      ) : (
        <>
          <Button
            className="h-9 gap-1.5 px-3.5 text-[13px]"
            disabled={scanning || saving}
            onClick={() => void scanInventory()}
            variant="outline"
          >
            <RefreshCw className={scanning ? "animate-spin" : undefined} size={16} />
            {t("actions.rescan")}
          </Button>
          <Button
            className="h-9 gap-1.5 px-3.5 text-[13px]"
            disabled={!selectedShell || scanning || saving}
            onClick={() => addEntry("variable")}
            variant="outline"
          >
            <Plus size={16} />
            {t("env.variables.add")}
          </Button>
          <Button
            className="h-9 gap-1.5 px-3.5 text-[13px]"
            disabled={!selectedShell || scanning || saving}
            onClick={() => addEntry("path")}
            variant="outline"
          >
            <Plus size={16} />
            {t("env.path.add")}
          </Button>
          <Button
            className="h-9 gap-1.5 px-3.5 text-[13px]"
            disabled={dirtyEntries.length === 0 || scanning || saving}
            onClick={requestSave}
          >
            <Save size={16} />
            {t("env.save")}
          </Button>
        </>
      ),
    [confirming, dirtyEntries.length, entries, saving, scanning, selectedShell, t],
  );

  const chromeSummary = useMemo(
    () => (
      <SummaryMetricStrip>
        <MetricCell icon={Terminal} label={t("env.summary.shells")} value={String(shells.length)} />
        <MetricCell icon={Variable} label={t("env.summary.variables")} value={String(variableCount)} />
        <MetricCell icon={ListTree} label={t("env.summary.path")} value={String(pathCount)} />
        <MetricCell icon={CheckCircle2} label={t("env.summary.editable")} value={String(editableCount)} />
        <MetricCell icon={Save} label={t("env.summary.unsaved")} value={String(dirtyEntries.length)} />
      </SummaryMetricStrip>
    ),
    [dirtyEntries.length, editableCount, pathCount, shells.length, t, variableCount],
  );

  useEffect(() => {
    onChromeChange({ actions: toolbarActions, summary: chromeSummary });
  }, [chromeSummary, onChromeChange, toolbarActions]);

  useEffect(() => () => onChromeChange(null), [onChromeChange]);

  async function scanInventory() {
    if (dirtyEntries.length > 0 && !window.confirm(t("env.discardConfirm"))) {
      return;
    }

    setScanning(true);
    setError(null);
    setConfirming(false);
    try {
      const result = await invoke<EnvInventory>("scan_env_inventory");
      const nextEntries = result.entries.map(toLocalEntry);
      setShells(result.shells);
      setEntries(nextEntries);
      const nextShell =
        result.shells.find((shell) => shell.is_default)?.shell ??
        result.shells[0]?.shell ??
        null;
      setSelectedShell(nextShell);
      setSelectedId(nextEntries[0]?.id ?? null);
    } catch (scanError) {
      setError(String(scanError));
    } finally {
      setScanning(false);
    }
  }

  function toLocalEntry(entry: EnvEntry): LocalEnvEntry {
    return {
      ...entry,
      original_key: entry.key,
      original_value: entry.value,
    };
  }

  function addEntry(kind: EnvEntryKind) {
    const shell = selectedShell ?? shells[0]?.shell ?? null;
    if (!shell) {
      return;
    }

    const shellConfig = shells.find((item) => item.shell === shell);
    const id = `draft:${kind}:${Date.now()}`;
    const entry: LocalEnvEntry = {
      id,
      kind,
      key: kind === "path" ? "PATH" : "NEW_VARIABLE",
      value: "",
      source: "skiff-block",
      shell,
      source_label: `${shellConfig?.label ?? shell} Skiff`,
      config_path: shellConfig?.config_path ?? null,
      line_number: null,
      editable: true,
      importable: false,
      enabled: true,
      note: t("env.note.newEntry"),
      dirty: true,
      isNew: true,
      original_key: kind === "path" ? "PATH" : "NEW_VARIABLE",
      original_value: "",
    };

    setEntries((current) => [entry, ...current]);
    setSelectedId(id);
  }

  function importEntry(entry: LocalEnvEntry) {
    const shell = selectedShell ?? shells[0]?.shell ?? null;
    if (!shell) {
      return;
    }

    const shellConfig = shells.find((item) => item.shell === shell);
    const id = `import:${entry.id}:${Date.now()}`;
    const imported: LocalEnvEntry = {
      ...entry,
      id,
      source: "skiff-block",
      shell,
      source_label: `${shellConfig?.label ?? shell} Skiff`,
      config_path: shellConfig?.config_path ?? null,
      line_number: null,
      editable: true,
      importable: false,
      note: t("env.note.imported"),
      dirty: true,
      isNew: true,
      original_key: entry.key,
      original_value: entry.value,
    };

    setEntries((current) => [imported, ...current]);
    setSelectedId(id);
  }

  function updateSelected(patch: Partial<LocalEnvEntry>) {
    if (!selectedEntry || !selectedEntry.editable) {
      return;
    }

    setEntries((current) =>
      current.map((entry) =>
        entry.id === selectedEntry.id
          ? { ...entry, ...patch, dirty: true }
          : entry,
      ),
    );
  }

  function deleteSelected() {
    if (!selectedEntry || !selectedEntry.editable) {
      return;
    }

    if (selectedEntry.isNew) {
      setEntries((current) => current.filter((entry) => entry.id !== selectedEntry.id));
      setSelectedId(visibleEntries.find((entry) => entry.id !== selectedEntry.id)?.id ?? null);
      return;
    }

    setEntries((current) =>
      current.map((entry) =>
        entry.id === selectedEntry.id ? { ...entry, deleted: true, dirty: true } : entry,
      ),
    );
    setSelectedId(visibleEntries.find((entry) => entry.id !== selectedEntry.id)?.id ?? null);
  }

  function requestSave() {
    if (!validateChanges()) {
      return;
    }

    setConfirming(true);
  }

  function validateChanges() {
    const changed = entries.filter((entry) => entry.dirty || entry.deleted || entry.isNew);
    for (const entry of changed) {
      if (entry.deleted) {
        continue;
      }

      if (entry.kind === "variable" && !envKeyPattern.test(entry.key.trim())) {
        toast.error(t("env.invalidKey"));
        setSelectedId(entry.id);
        return false;
      }

      if (entry.kind === "path" && !entry.value.trim()) {
        toast.error(t("env.emptyPath"));
        setSelectedId(entry.id);
        return false;
      }
    }

    return true;
  }

  async function saveChanges() {
    const changes = entries
      .filter((entry) => entry.dirty || entry.deleted || entry.isNew)
      .map(toChange);
    if (changes.length === 0) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const result = await invoke<EnvInventorySaveResult>("save_env_inventory", {
        request: { changes },
      });
      toast.success(t("env.savedDetailed", { count: result.changed_count }));
      if (result.backup_paths.length > 0) {
        toast.message(t("env.backupSaved", { path: result.backup_paths[0] }));
      }
      if (result.registry_changed) {
        toast.message(t("env.registryChanged"));
      }
      setConfirming(false);
      await scanInventoryAfterSave();
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function scanInventoryAfterSave() {
    const result = await invoke<EnvInventory>("scan_env_inventory");
    const nextEntries = result.entries.map(toLocalEntry);
    setShells(result.shells);
    setEntries(nextEntries);
    setSelectedId(nextEntries[0]?.id ?? null);
  }

  function toChange(entry: LocalEnvEntry): EnvEntryChange {
    return {
      action: entry.deleted ? "delete" : "upsert",
      kind: entry.kind,
      key: entry.key.trim(),
      value: entry.value,
      source: entry.source,
      shell: entry.shell,
      config_path: entry.config_path,
      line_number: entry.line_number,
      original_key: entry.original_key,
      original_value: entry.original_value,
      enabled: entry.enabled,
    };
  }

  const sourceFilters = buildSourceFilters(shells, t);

  return (
    <PageSurface className="grid min-h-0 gap-3">
      {error ? <InlineMessage kind="error">{error}</InlineMessage> : null}

      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_318px] gap-3 max-[1080px]:grid-cols-1">
        <ResultPanel className="flex min-h-0 flex-col overflow-hidden">
          <PanelTitle
            actions={
              <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                <InputGroup className="h-8 w-[260px] rounded-md border-[#dddddd] bg-white px-2 shadow-none max-[720px]:w-full">
                  <InputGroupAddon>
                    <Search size={15} />
                  </InputGroupAddon>
                  <InputGroupInput
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("env.searchPlaceholder")}
                    value={query}
                  />
                </InputGroup>
                <button
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold",
                    onlyActionable
                      ? "border-[#145c53] bg-[#edf7f4] text-[#145c53]"
                      : "border-[#dddddd] bg-white text-[#58616d]",
                  )}
                  onClick={() => setOnlyActionable((value) => !value)}
                  type="button"
                >
                  <Filter size={14} />
                  {t("env.filter.actionable")}
                </button>
              </div>
            }
          >
            <div>
              <strong>{t("env.inventory.title")}</strong>
              <span>{t("env.inventory.subtitle")}</span>
            </div>
          </PanelTitle>

          <div className="flex min-h-[44px] flex-wrap items-center gap-2 border-b border-black/5 bg-white px-4 py-2">
            {sourceFilters.map((filter) => (
              <FilterButton
                active={sourceFilter === filter.value}
                key={filter.value}
                label={filter.label}
                onClick={() => setSourceFilter(filter.value)}
              />
            ))}
            <span className="mx-1 h-5 w-px bg-black/10" />
            <FilterButton
              active={kindFilter === "all"}
              label={t("env.kind.all")}
              onClick={() => setKindFilter("all")}
            />
            <FilterButton
              active={kindFilter === "variable"}
              label={t("env.kind.variable")}
              onClick={() => setKindFilter("variable")}
            />
            <FilterButton
              active={kindFilter === "path"}
              label={t("env.kind.path")}
              onClick={() => setKindFilter("path")}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden" role="table">
            <div
              className={cn(
                tableGridClass,
                "min-h-8 border-b border-black/5 bg-[#fbfbfa] px-5 text-[11px] font-[620] text-[#7c8490] max-[860px]:hidden",
              )}
              role="row"
            >
              <span role="columnheader">{t("env.table.kind")}</span>
              <span role="columnheader">{t("env.table.name")}</span>
              <span role="columnheader">{t("env.table.value")}</span>
              <span role="columnheader">{t("env.table.source")}</span>
              <span role="columnheader">{t("env.table.status")}</span>
            </div>

            <div className="min-h-0 overflow-auto">
              {visibleEntries.length > 0 ? (
                visibleEntries.map((entry) => (
                  <EnvRow
                    entry={entry}
                    key={entry.id}
                    onSelect={() => setSelectedId(entry.id)}
                    selected={selectedEntry?.id === entry.id}
                  />
                ))
              ) : (
                <div className="p-4">
                  <InlineMessage kind="info" className="mb-0">
                    {scanning ? t("env.loading") : t("env.noResults")}
                  </InlineMessage>
                </div>
              )}
            </div>
          </div>
        </ResultPanel>

        <EnvInspector
          entry={selectedEntry}
          onDelete={deleteSelected}
          onImport={importEntry}
          onUpdate={updateSelected}
          selectedShell={selectedShell}
          setSelectedShell={setSelectedShell}
          shells={shells}
        />
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("env.confirm.title")}</DialogTitle>
            <DialogDescription>
              {t("env.confirm.inventoryDescription", { count: dirtyEntries.length })}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[240px] overflow-auto rounded-lg border border-[#ecd9a8] bg-[#fffaf0] p-3">
            {dirtyEntries.slice(0, 8).map((entry) => (
              <div
                className="grid grid-cols-[78px_minmax(0,1fr)] gap-2 border-b border-[#ead9b1] py-1.5 text-sm last:border-b-0"
                key={entry.id}
              >
                <strong className="text-[#5c3d08]">
                  {entry.deleted ? t("env.change.delete") : t("env.change.upsert")}
                </strong>
                <span className="min-w-0 truncate text-[#77520f]">
                  {entry.key} · {entry.source_label}
                </span>
              </div>
            ))}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button disabled={saving} variant="outline">
                {t("actions.cancel")}
              </Button>
            </DialogClose>
            <Button disabled={saving} onClick={() => void saveChanges()}>
              <Save size={15} />
              {t("env.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageSurface>
  );
}

function EnvRow({
  entry,
  onSelect,
  selected,
}: {
  entry: LocalEnvEntry;
  onSelect: () => void;
  selected: boolean;
}) {
  const { t } = useI18n();
  const Icon = entry.kind === "path" ? ListTree : Variable;

  return (
    <button
      className={cn(
        tableGridClass,
        "min-h-[52px] w-full border-b border-black/5 bg-white px-5 py-2 text-left hover:bg-[#fafaf8] max-[860px]:grid-cols-[62px_minmax(0,1fr)_76px] max-[860px]:px-4",
        selected && "bg-[#f7faf8] shadow-[inset_3px_0_0_#145c53]",
        entry.dirty && "bg-[#fffdf5]",
      )}
      onClick={onSelect}
      role="row"
      type="button"
    >
      <span className="inline-flex items-center gap-2 text-xs font-semibold text-[#44505c]" role="cell">
        <Icon size={16} />
        {entry.kind === "path" ? t("env.kind.path") : t("env.kind.variable")}
      </span>
      <strong className="truncate text-[13px] font-[680] text-[#151b22]" role="cell">
        {entry.key}
      </strong>
      <code className="truncate font-mono text-[12px] text-[#58616d] max-[860px]:hidden" role="cell">
        {entry.value || "-"}
      </code>
      <span className="truncate text-xs text-[#68717b] max-[860px]:hidden" role="cell">
        {entry.source_label}
      </span>
      <span className="justify-self-start" role="cell">
        <EntryStatus entry={entry} />
      </span>
    </button>
  );
}

function EnvInspector({
  entry,
  onDelete,
  onImport,
  onUpdate,
  selectedShell,
  setSelectedShell,
  shells,
}: {
  entry: LocalEnvEntry | null;
  onDelete: () => void;
  onImport: (entry: LocalEnvEntry) => void;
  onUpdate: (patch: Partial<LocalEnvEntry>) => void;
  selectedShell: EnvShell | null;
  setSelectedShell: (shell: EnvShell) => void;
  shells: EnvShellConfig[];
}) {
  const { t } = useI18n();

  if (!entry) {
    return (
      <aside className="grid content-start gap-3">
        <ResultPanel>
          <div className="p-4">
            <strong className="text-sm text-[#14191f]">{t("env.inspector.title")}</strong>
            <p className="mt-2 text-xs leading-normal text-[#7c8490]">
              {t("env.inspector.empty")}
            </p>
          </div>
        </ResultPanel>
      </aside>
    );
  }

  const editable = entry.editable;

  return (
    <aside className="grid content-start gap-3">
      <ResultPanel>
        <PanelTitle
          actions={
            <div className="flex gap-1.5">
              {entry.importable ? (
                <Button onClick={() => onImport(entry)} variant="outline">
                  <CopyPlus size={15} />
                  {t("env.importToShell")}
                </Button>
              ) : null}
              {editable ? (
                <Button onClick={onDelete} variant="outline">
                  <Trash2 size={15} />
                  {t("env.delete")}
                </Button>
              ) : null}
            </div>
          }
        >
          <div>
            <strong>{t("env.inspector.title")}</strong>
            <span>{entry.source_label}</span>
          </div>
        </PanelTitle>

        <div className="grid gap-3 p-3">
          <div className="grid gap-1.5">
            <label className="text-[11px] font-semibold uppercase text-[#7c8490]">
              {t("env.variables.key")}
            </label>
            <Input
              className="h-9 bg-white font-mono text-sm"
              disabled={!editable || entry.kind === "path"}
              onChange={(event) => onUpdate({ key: event.target.value })}
              value={entry.key}
            />
          </div>

          <div className="grid gap-1.5">
            <label className="text-[11px] font-semibold uppercase text-[#7c8490]">
              {entry.kind === "path" ? t("env.path.title") : t("env.variables.value")}
            </label>
            <Input
              className="h-9 bg-white font-mono text-sm"
              disabled={!editable}
              onChange={(event) => onUpdate({ value: event.target.value })}
              value={entry.value}
            />
          </div>

          <div className="grid gap-1.5">
            <span className="text-[11px] font-semibold uppercase text-[#7c8490]">
              {t("env.targetShell")}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {shells.map((shell) => (
                <button
                  className={cn(
                    "h-7 rounded-md border px-2 text-xs font-semibold",
                    selectedShell === shell.shell
                      ? "border-[#145c53] bg-[#edf7f4] text-[#145c53]"
                      : "border-[#dddddd] bg-white text-[#58616d]",
                  )}
                  key={shell.shell}
                  onClick={() => setSelectedShell(shell.shell)}
                  type="button"
                >
                  {shell.label}
                </button>
              ))}
            </div>
          </div>

          <DetailLine label={t("env.table.source")} value={entry.source_label} />
          <DetailLine
            label={t("env.configPath")}
            value={entry.config_path ?? t("common.none")}
          />
          <DetailLine
            label={t("env.lineNumber")}
            value={entry.line_number ? String(entry.line_number) : t("common.none")}
          />

          {editable ? (
            <div className="flex items-center justify-between rounded-lg bg-[#f7f8f6] px-3 py-2">
              <span className="text-xs font-semibold text-[#44505c]">
                {entry.enabled ? t("env.enabled") : t("env.disabled")}
              </span>
              <Switch
                checked={entry.enabled}
                onCheckedChange={(enabled) => onUpdate({ enabled })}
              />
            </div>
          ) : null}

          {entry.note ? (
            <p className="rounded-lg border border-black/5 bg-[#fbfbfa] px-3 py-2 text-xs leading-normal text-[#69727d]">
              {entry.note}
            </p>
          ) : null}
        </div>
      </ResultPanel>
    </aside>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-lg bg-[#f7f8f6] px-3 py-2">
      <span className="text-[11px] font-semibold uppercase text-[#7c8490]">{label}</span>
      <span className="break-all font-mono text-xs text-[#44505c]">{value}</span>
    </div>
  );
}

function EntryStatus({ entry }: { entry: LocalEnvEntry }) {
  const { t } = useI18n();
  const label = entry.dirty
    ? t("env.status.modified")
    : entry.editable
      ? t("env.status.editable")
      : entry.importable
        ? t("env.status.importable")
        : t("env.status.readOnly");
  const tone = entry.dirty
    ? "warn"
    : entry.editable
      ? "good"
      : entry.importable
        ? "info"
        : "muted";

  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}

function StatusBadge({
  children,
  tone,
}: {
  children: string;
  tone: "good" | "info" | "muted" | "warn";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2 text-[11px] font-semibold",
        tone === "good" && "bg-[#e6f4ee] text-[#176149]",
        tone === "info" && "bg-[#e8f1fb] text-[#245d8f]",
        tone === "muted" && "bg-[#edf0f2] text-[#67717d]",
        tone === "warn" && "bg-[#fff3cf] text-[#7a5311]",
      )}
    >
      {children}
    </span>
  );
}

function FilterButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "h-7 rounded-md border px-2.5 text-xs font-semibold",
        active
          ? "border-[#145c53] bg-[#edf7f4] text-[#145c53]"
          : "border-[#dddddd] bg-white text-[#58616d] hover:bg-[#f7f8f6]",
      )}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function buildSourceFilters(shells: EnvShellConfig[], t: ReturnType<typeof useI18n>["t"]) {
  const filters: Array<{ label: string; value: SourceFilter }> = [
    { label: t("env.filter.all"), value: "all" },
    { label: t("env.source.currentProcess"), value: "current-process" },
    { label: t("env.source.shellConfig"), value: "shell-config" },
    { label: t("env.source.skiffBlock"), value: "skiff-block" },
  ];

  for (const shell of shells) {
    filters.push({ label: shell.label, value: `shell:${shell.shell}` });
  }

  if (shells.some((shell) => shell.shell === "powershell" || shell.shell === "cmd")) {
    filters.push({ label: t("env.source.windowsUserEnv"), value: "windows-user-env" });
  }

  return filters;
}
