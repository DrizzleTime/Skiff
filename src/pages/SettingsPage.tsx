import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Save, Settings } from "lucide-react";
import {
  InlineMessage,
  PageSurface,
  ToolStrip,
} from "../components/cleanup/PageChrome";
import { Button } from "../components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldTitle,
} from "../components/ui/field";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import type { AppSettings } from "../types/cleanup";

const MB = 1024 * 1024;
const settingsRowClass =
  "grid min-h-[90px] grid-cols-[minmax(0,1fr)_170px] items-center gap-5 border-b border-[#eeeeee] px-5 py-[18px] last:border-b-0 max-[720px]:grid-cols-1";
const fieldClass = "grid grid-cols-[24px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5";

export function SettingsPage() {
  const [largeFileMinSize, setLargeFileMinSize] = useState(500);
  const [duplicateMinSize, setDuplicateMinSize] = useState(10);
  const [closeToTray, setCloseToTray] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const settings = await invoke<AppSettings>("get_settings");
      setLargeFileMinSize(Math.round(settings.large_file_min_size / MB));
      setDuplicateMinSize(Math.round(settings.duplicate_min_size / MB));
      setCloseToTray(settings.close_to_tray);
    } catch (error) {
      setMessage(String(error));
    }
  }

  async function saveSettings() {
    setMessage(null);
    try {
      await invoke<AppSettings>("save_settings", {
        settings: {
          large_file_min_size: largeFileMinSize * MB,
          duplicate_min_size: duplicateMinSize * MB,
          close_to_tray: closeToTray,
        },
      });
      setMessage("设置已保存。");
    } catch (error) {
      setMessage(String(error));
    }
  }

  return (
    <PageSurface>
      <ToolStrip>
        <p>调整大文件和重复文件扫描阈值。</p>
        <Button onClick={saveSettings} variant="default">
          <Save size={16} />
          保存设置
        </Button>
      </ToolStrip>

      {message ? <InlineMessage kind="info">{message}</InlineMessage> : null}

      <div className="overflow-visible rounded-md border border-[#e5e5e5] bg-white">
        <div className={settingsRowClass}>
          <Field className={fieldClass} orientation="horizontal">
            <Settings className="row-span-2 self-start" size={18} />
            <FieldContent>
              <FieldTitle className="text-sm">大文件阈值</FieldTitle>
              <FieldDescription className="text-xs text-[#6f6f6f]">
                扫描大文件时只返回不小于该大小的文件。
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
            <Settings className="row-span-2 self-start" size={18} />
            <FieldContent>
              <FieldTitle className="text-sm">重复文件阈值</FieldTitle>
              <FieldDescription className="text-xs text-[#6f6f6f]">
                重复文件扫描会忽略小于该大小的文件。
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

        <div className={settingsRowClass}>
          <Field className={fieldClass} orientation="horizontal">
            <Settings className="row-span-2 self-start" size={18} />
            <FieldContent>
              <FieldTitle className="text-sm">关闭窗口时最小化到托盘</FieldTitle>
              <FieldDescription className="text-xs text-[#6f6f6f]">
                开启后点击关闭按钮会隐藏窗口，关闭后点击关闭按钮会退出应用。
              </FieldDescription>
            </FieldContent>
          </Field>
          <div className="flex items-center justify-end max-[720px]:justify-start">
            <Switch
              aria-label="关闭窗口时最小化到托盘"
              checked={closeToTray}
              onCheckedChange={setCloseToTray}
            />
          </div>
        </div>
      </div>
    </PageSurface>
  );
}
