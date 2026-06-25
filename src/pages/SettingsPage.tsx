import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Copy,
  FolderOpen,
  FolderSearch,
  HardDrive,
  Languages,
  Minimize2,
  Plus,
  Save,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PageSurface, ToolStrip } from "../components/cleanup/PageChrome";
import { Button } from "../components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldTitle,
} from "../components/ui/field";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { useI18n } from "../lib/i18n";
import { cn } from "../lib/utils";
import type { AiProtocol } from "../types/cleanup";
import type { AppSettings } from "../types/cleanup";
import type { LanguagePreference } from "../types/cleanup";

const MB = 1024 * 1024;
const DEFAULT_CHAT_COMPLETIONS_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
const settingsRowClass =
  "grid min-h-[90px] grid-cols-[minmax(0,1fr)_224px] items-center gap-5 border-b border-[#eeeeee] px-5 py-[18px] last:border-b-0 max-[720px]:grid-cols-1";
const languageRowClass =
  "grid min-h-[90px] grid-cols-[minmax(0,1fr)_360px] items-center gap-5 border-b border-[#eeeeee] px-5 py-[18px] last:border-b-0 max-[720px]:grid-cols-1";
const scanPathRowClass =
  "grid min-h-[120px] grid-cols-[minmax(0,1fr)_minmax(320px,520px)] items-start gap-5 border-b border-[#eeeeee] px-5 py-[18px] last:border-b-0 max-[720px]:grid-cols-1";
const aiRowClass =
  "grid min-h-[156px] grid-cols-[minmax(0,1fr)_minmax(320px,520px)] items-start gap-5 border-b border-[#eeeeee] px-5 py-[18px] last:border-b-0 max-[720px]:grid-cols-1";
const fieldClass = "grid grid-cols-[24px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5";

type SettingsTab = "scan" | "ai" | "general";

export function SettingsPage({
  onSettingsSaved,
}: {
  onSettingsSaved?: (showAdvancedFeatures: boolean) => void;
}) {
  const { languagePreference, setLanguagePreference, t } = useI18n();
  const [largeFileMinSize, setLargeFileMinSize] = useState(500);
  const [duplicateMinSize, setDuplicateMinSize] = useState(10);
  const [scanPaths, setScanPaths] = useState<string[]>([]);
  const [scanPathInput, setScanPathInput] = useState("");
  const [closeToTray, setCloseToTray] = useState(true);
  const [showAdvancedFeatures, setShowAdvancedFeatures] = useState(true);
  const [activeTab, setActiveTab] = useState<SettingsTab>("scan");
  const [aiProtocol, setAiProtocol] =
    useState<AiProtocol>("openai_chat_completions");
  const [aiEndpoint, setAiEndpoint] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [localLanguage, setLocalLanguage] =
    useState<LanguagePreference>(languagePreference);

  useEffect(() => {
    setLocalLanguage(languagePreference);
  }, [languagePreference]);

  useEffect(() => {
    void loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const settings = await invoke<AppSettings>("get_settings");
      setLargeFileMinSize(Math.round(settings.large_file_min_size / MB));
      setDuplicateMinSize(Math.round(settings.duplicate_min_size / MB));
      setScanPaths(settings.file_scan_paths ?? []);
      setCloseToTray(settings.close_to_tray);
      setShowAdvancedFeatures(settings.show_advanced_features);
      setAiProtocol(settings.ai_protocol ?? "openai_chat_completions");
      setAiEndpoint(settings.ai_endpoint ?? "");
      setAiApiKey(settings.ai_api_key ?? "");
      setAiModel(settings.ai_model ?? "");
      setLocalLanguage(settings.language ?? "system");
      setLanguagePreference(settings.language ?? "system");
    } catch (error) {
      toast.error(String(error));
    }
  }

  async function saveSettings() {
    try {
      const settings = await invoke<AppSettings>("save_settings", {
        settings: {
          large_file_min_size: largeFileMinSize * MB,
          duplicate_min_size: duplicateMinSize * MB,
          file_scan_paths: scanPaths,
          close_to_tray: closeToTray,
          show_advanced_features: showAdvancedFeatures,
          language: localLanguage,
          ai_protocol: aiProtocol,
          ai_endpoint: aiEndpoint.trim(),
          ai_api_key: aiApiKey.trim(),
          ai_model: aiModel.trim(),
        },
      });
      setScanPaths(settings.file_scan_paths ?? []);
      setShowAdvancedFeatures(settings.show_advanced_features);
      setAiProtocol(settings.ai_protocol ?? "openai_chat_completions");
      setAiEndpoint(settings.ai_endpoint ?? "");
      setAiApiKey(settings.ai_api_key ?? "");
      setAiModel(settings.ai_model ?? "");
      setScanPathInput("");
      setLanguagePreference(localLanguage);
      onSettingsSaved?.(settings.show_advanced_features);
      toast.success(t("settings.saved"));
    } catch (error) {
      toast.error(String(error));
    }
  }

  function addScanPath() {
    const value = scanPathInput.trim();
    if (!value || scanPaths.includes(value)) {
      return;
    }

    setScanPaths((current) => [...current, value]);
    setScanPathInput("");
  }

  async function chooseScanPath() {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: t("settings.scanPaths.dialogTitle"),
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (typeof path !== "string" || scanPaths.includes(path)) {
        return;
      }

      setScanPaths((current) => [...current, path]);
    } catch (error) {
      toast.error(String(error));
    }
  }

  function removeScanPath(path: string) {
    setScanPaths((current) => current.filter((item) => item !== path));
  }

  function selectAiProtocol(protocol: AiProtocol) {
    setAiProtocol(protocol);
    setAiEndpoint((current) => {
      const value = current.trim();
      if (value && !defaultAiEndpoints.includes(value)) {
        return current;
      }

      return defaultEndpointForProtocol(protocol);
    });
  }

  const aiEndpointPlaceholder = defaultEndpointForProtocol(aiProtocol);

  return (
    <PageSurface>
      <ToolStrip>
        <p>{t("settings.subtitle")}</p>
        <Button onClick={saveSettings} variant="default">
          <Save size={16} />
          {t("actions.saveSettings")}
        </Button>
      </ToolStrip>

      <div className="mb-2 grid w-full grid-cols-3 gap-1 rounded-lg border border-[#d8d8d8] bg-[#f6f6f6] p-1">
        {settingsTabOptions.map((tab) => (
          <button
            aria-selected={activeTab === tab.value}
            className={cn(
              "min-h-9 whitespace-nowrap rounded-md px-3 text-xs font-semibold text-[#555555]",
              activeTab === tab.value && "bg-white text-[#111111] shadow-sm",
            )}
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            role="tab"
            type="button"
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      <div className="overflow-visible rounded-md border border-[#e5e5e5] bg-white">
        {activeTab === "scan" ? (
          <>
            <div className={settingsRowClass}>
              <Field className={fieldClass} orientation="horizontal">
                <HardDrive className="row-span-2 self-start" size={18} />
                <FieldContent>
                  <FieldTitle className="text-sm">{t("settings.large.title")}</FieldTitle>
                  <FieldDescription className="text-xs text-[#6f6f6f]">
                    {t("settings.large.description")}
                  </FieldDescription>
                </FieldContent>
              </Field>
              <label className="grid grid-cols-[minmax(0,1fr)_34px] items-center gap-2">
                <Input
                  className="h-[38px] w-full rounded-lg border-[#d8d8d8] px-2.5"
                  min={1}
                  onChange={(event) => setLargeFileMinSize(Number(event.target.value))}
                  type="number"
                  value={largeFileMinSize}
                />
                <span className="text-xs text-[#6f6f6f]">MB</span>
              </label>
            </div>

            <div className={settingsRowClass}>
              <Field className={fieldClass} orientation="horizontal">
                <Copy className="row-span-2 self-start" size={18} />
                <FieldContent>
                  <FieldTitle className="text-sm">{t("settings.duplicate.title")}</FieldTitle>
                  <FieldDescription className="text-xs text-[#6f6f6f]">
                    {t("settings.duplicate.description")}
                  </FieldDescription>
                </FieldContent>
              </Field>
              <label className="grid grid-cols-[minmax(0,1fr)_34px] items-center gap-2">
                <Input
                  className="h-[38px] w-full rounded-lg border-[#d8d8d8] px-2.5"
                  min={1}
                  onChange={(event) => setDuplicateMinSize(Number(event.target.value))}
                  type="number"
                  value={duplicateMinSize}
                />
                <span className="text-xs text-[#6f6f6f]">MB</span>
              </label>
            </div>

            <div className={scanPathRowClass}>
              <Field className={fieldClass} orientation="horizontal">
                <FolderSearch className="row-span-2 self-start" size={18} />
                <FieldContent>
                  <FieldTitle className="text-sm">{t("settings.scanPaths.title")}</FieldTitle>
                  <FieldDescription className="text-xs text-[#6f6f6f]">
                    {t("settings.scanPaths.description")}
                  </FieldDescription>
                </FieldContent>
              </Field>
              <div className="grid gap-2">
                <div className="grid grid-cols-[minmax(0,1fr)_92px_92px] gap-2 max-[720px]:grid-cols-[minmax(0,1fr)_88px]">
                  <Input
                    className="h-[38px] w-full rounded-lg border-[#d8d8d8] px-2.5 max-[720px]:col-span-2"
                    onChange={(event) => setScanPathInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addScanPath();
                      }
                    }}
                    placeholder={t("settings.scanPaths.placeholder")}
                    value={scanPathInput}
                  />
                  <Button
                    className="h-[38px] gap-1.5 rounded-lg text-xs"
                    onClick={chooseScanPath}
                    type="button"
                    variant="outline"
                  >
                    <FolderOpen size={14} />
                    {t("settings.scanPaths.choose")}
                  </Button>
                  <Button
                    className="h-[38px] gap-1.5 rounded-lg text-xs"
                    disabled={!scanPathInput.trim()}
                    onClick={addScanPath}
                    type="button"
                    variant="outline"
                  >
                    <Plus size={14} />
                    {t("settings.scanPaths.add")}
                  </Button>
                </div>
                <div className="grid gap-1.5">
                  {scanPaths.length === 0 ? (
                    <p className="rounded-md border border-dashed border-[#d8d8d8] px-3 py-2 text-xs text-[#777777]">
                      {t("settings.scanPaths.empty")}
                    </p>
                  ) : (
                    scanPaths.map((path) => (
                      <div
                        className="grid min-h-9 grid-cols-[minmax(0,1fr)_28px] items-center gap-2 rounded-md border border-[#e5e5e5] bg-[#fbfbfa] px-2"
                        key={path}
                      >
                        <code className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] text-[#555555]">
                          {path}
                        </code>
                        <button
                          aria-label={t("settings.scanPaths.remove")}
                          className="grid size-7 place-items-center rounded-md text-[#777777] hover:bg-[#eeeeee] hover:text-[#111111]"
                          onClick={() => removeScanPath(path)}
                          type="button"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        ) : null}

        {activeTab === "ai" ? (
          <div className={aiRowClass}>
            <Field className={fieldClass} orientation="horizontal">
              <Sparkles className="row-span-2 self-start" size={18} />
              <FieldContent>
                <FieldTitle className="text-sm">{t("settings.ai.title")}</FieldTitle>
                <FieldDescription className="text-xs text-[#6f6f6f]">
                  {t("settings.ai.description")}
                </FieldDescription>
              </FieldContent>
            </Field>
            <div className="grid gap-2">
              <div className="grid w-full grid-cols-3 gap-1 rounded-lg border border-[#d8d8d8] bg-[#f6f6f6] p-1">
                {aiProtocolOptions.map((option) => (
                  <button
                    aria-selected={aiProtocol === option.value}
                    className={cn(
                      "min-h-8 whitespace-nowrap rounded-md px-2 text-[11px] font-semibold text-[#555555]",
                      aiProtocol === option.value && "bg-white text-[#111111] shadow-sm",
                    )}
                    key={option.value}
                    onClick={() => selectAiProtocol(option.value)}
                    type="button"
                  >
                    {t(option.labelKey)}
                  </button>
                ))}
              </div>
              <Input
                className="h-[38px] w-full rounded-lg border-[#d8d8d8] px-2.5"
                onChange={(event) => setAiEndpoint(event.target.value)}
                placeholder={aiEndpointPlaceholder}
                value={aiEndpoint}
              />
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 max-[720px]:grid-cols-1">
                <Input
                  className="h-[38px] w-full rounded-lg border-[#d8d8d8] px-2.5"
                  onChange={(event) => setAiModel(event.target.value)}
                  placeholder={t("settings.ai.modelPlaceholder")}
                  value={aiModel}
                />
                <Input
                  className="h-[38px] w-full rounded-lg border-[#d8d8d8] px-2.5"
                  onChange={(event) => setAiApiKey(event.target.value)}
                  placeholder={t("settings.ai.keyPlaceholder")}
                  type="password"
                  value={aiApiKey}
                />
              </div>
              <p className="text-xs leading-normal text-[#777777]">
                {t("settings.ai.note")}
              </p>
            </div>
          </div>
        ) : null}

        {activeTab === "general" ? (
          <>
            <div className={settingsRowClass}>
              <Field className={fieldClass} orientation="horizontal">
                <Minimize2 className="row-span-2 self-start" size={18} />
                <FieldContent>
                  <FieldTitle className="text-sm">{t("settings.closeToTray.title")}</FieldTitle>
                  <FieldDescription className="text-xs text-[#6f6f6f]">
                    {t("settings.closeToTray.description")}
                  </FieldDescription>
                </FieldContent>
              </Field>
              <div className="flex items-center justify-end max-[720px]:justify-start">
                <Switch
                  aria-label={t("settings.closeToTray.title")}
                  checked={closeToTray}
                  onCheckedChange={setCloseToTray}
                />
              </div>
            </div>

            <div className={settingsRowClass}>
              <Field className={fieldClass} orientation="horizontal">
                <SlidersHorizontal className="row-span-2 self-start" size={18} />
                <FieldContent>
                  <FieldTitle className="text-sm">{t("settings.advanced.title")}</FieldTitle>
                  <FieldDescription className="text-xs text-[#6f6f6f]">
                    {t("settings.advanced.description")}
                  </FieldDescription>
                </FieldContent>
              </Field>
              <div className="flex items-center justify-end max-[720px]:justify-start">
                <Switch
                  aria-label={t("settings.advanced.title")}
                  checked={showAdvancedFeatures}
                  onCheckedChange={setShowAdvancedFeatures}
                />
              </div>
            </div>

            <div className={languageRowClass}>
              <Field className={fieldClass} orientation="horizontal">
                <Languages className="row-span-2 self-start" size={18} />
                <FieldContent>
                  <FieldTitle className="text-sm">{t("settings.language.title")}</FieldTitle>
                  <FieldDescription className="text-xs text-[#6f6f6f]">
                    {t("settings.language.description")}
                  </FieldDescription>
                </FieldContent>
              </Field>
              <div className="grid w-full grid-cols-3 gap-1 rounded-lg border border-[#d8d8d8] bg-[#f6f6f6] p-1">
                {languageOptions.map((option) => (
                  <button
                    className={cn(
                      "min-h-8 whitespace-nowrap rounded-md px-3 text-xs font-semibold text-[#555555]",
                      localLanguage === option.value && "bg-white text-[#111111] shadow-sm",
                    )}
                    key={option.value}
                    onClick={() => {
                      setLocalLanguage(option.value);
                      setLanguagePreference(option.value);
                    }}
                    type="button"
                  >
                    {t(option.labelKey)}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </PageSurface>
  );
}

const languageOptions: Array<{
  value: LanguagePreference;
  labelKey:
    | "settings.language.system"
    | "settings.language.zh"
    | "settings.language.english";
}> = [
  { value: "system", labelKey: "settings.language.system" },
  { value: "zh-CN", labelKey: "settings.language.zh" },
  { value: "en-US", labelKey: "settings.language.english" },
];

const settingsTabOptions: Array<{
  value: SettingsTab;
  labelKey: "settings.tabs.scan" | "settings.tabs.ai" | "settings.tabs.general";
}> = [
  { value: "scan", labelKey: "settings.tabs.scan" },
  { value: "ai", labelKey: "settings.tabs.ai" },
  { value: "general", labelKey: "settings.tabs.general" },
];

const aiProtocolOptions: Array<{
  value: AiProtocol;
  labelKey:
    | "settings.ai.protocol.chat"
    | "settings.ai.protocol.responses"
    | "settings.ai.protocol.anthropic";
}> = [
  { value: "openai_chat_completions", labelKey: "settings.ai.protocol.chat" },
  { value: "openai_responses", labelKey: "settings.ai.protocol.responses" },
  { value: "anthropic_messages", labelKey: "settings.ai.protocol.anthropic" },
];

const defaultAiEndpoints = [
  DEFAULT_CHAT_COMPLETIONS_ENDPOINT,
  DEFAULT_RESPONSES_ENDPOINT,
  DEFAULT_ANTHROPIC_MESSAGES_ENDPOINT,
];

function defaultEndpointForProtocol(protocol: AiProtocol) {
  switch (protocol) {
    case "openai_responses":
      return DEFAULT_RESPONSES_ENDPOINT;
    case "anthropic_messages":
      return DEFAULT_ANTHROPIC_MESSAGES_ENDPOINT;
    case "openai_chat_completions":
    default:
      return DEFAULT_CHAT_COMPLETIONS_ENDPOINT;
  }
}
