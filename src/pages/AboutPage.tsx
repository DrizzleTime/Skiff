import { openUrl } from "@tauri-apps/plugin-opener";
import skiffLogo from "../assets/skiff-logo.svg";
import { useI18n } from "../lib/i18n";

const GITHUB_URL = "https://github.com/DrizzleTime/Skiff";

function GitHubMark() {
  return (
    <svg
      aria-hidden="true"
      className="size-[18px] shrink-0"
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="M12 2C6.48 2 2 6.58 2 12.24c0 4.52 2.86 8.35 6.84 9.7.5.09.68-.22.68-.49v-1.72c-2.78.62-3.37-1.37-3.37-1.37-.46-1.2-1.11-1.52-1.11-1.52-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.56 2.35 1.11 2.92.85.09-.66.35-1.11.63-1.37-2.22-.26-4.55-1.14-4.55-5.06 0-1.12.39-2.03 1.03-2.74-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 6.95c.85 0 1.7.12 2.5.35 1.9-1.33 2.74-1.05 2.74-1.05.55 1.4.2 2.44.1 2.7.64.71 1.03 1.62 1.03 2.74 0 3.93-2.34 4.8-4.57 5.05.36.32.68.94.68 1.9v2.81c0 .27.18.59.69.49A10.1 10.1 0 0 0 22 12.24C22 6.58 17.52 2 12 2Z" />
    </svg>
  );
}

export function AboutPage() {
  const { t } = useI18n();

  return (
    <section className="grid min-h-full min-w-0 place-items-center bg-[linear-gradient(180deg,rgb(255_255_255_/_92%),rgb(255_255_255_/_100%)),radial-gradient(circle_at_50%_20%,rgb(0_0_0_/_7%),transparent_34%)] px-6 py-11 max-[720px]:items-start max-[720px]:px-[18px] max-[720px]:py-[54px]">
      <div className="grid w-[min(100%,560px)] justify-items-center gap-[22px] text-center">
        <div className="grid size-24 place-items-center rounded-3xl border border-[#e5e5e5] bg-white text-[#101010] shadow-[0_18px_44px_rgb(0_0_0_/_10%),inset_0_1px_0_rgb(255_255_255_/_88%)] max-[720px]:size-[82px] max-[720px]:rounded-[20px]">
          <img
            className="block size-[54px] max-[720px]:size-[46px]"
            src={skiffLogo}
            alt=""
            aria-hidden="true"
          />
        </div>

        <div className="grid justify-items-center gap-3">
          <h1 className="text-[42px] font-[850] leading-none tracking-normal text-[#101010] max-[720px]:text-[34px]">
            Skiff
          </h1>
          <p className="max-w-[520px] text-[15px] leading-[1.8] text-[#555555] max-[720px]:text-sm">
            {t("about.description")}
          </p>
        </div>

        <button
          className="inline-flex min-h-10 items-center justify-center gap-[9px] rounded-full border border-[#d9d9d9] bg-[#111111] px-[18px] text-[13px] font-[720] text-white hover:bg-[#242424] [&_span]:leading-none"
          onClick={() => void openUrl(GITHUB_URL)}
          type="button"
        >
          <GitHubMark />
          <span>DrizzleTime/Skiff</span>
        </button>
      </div>
    </section>
  );
}
