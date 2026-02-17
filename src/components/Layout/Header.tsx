import { useEffect, useRef, useState } from "react";
import { PageType } from "../../App";
import { RefreshCw, ExternalLink, Loader2 } from "lucide-react";
import { invokeCommand as invoke } from "../../lib/invoke";
import { isTauri } from "../../lib/tauri";

declare const __BUILD_VERSION__: string;

interface HeaderProps {
  currentPage: PageType;
  webMode?: boolean;
  onLogout?: () => void;
}

const pageTitles: Record<PageType, { title: string; description: string }> = {
  dashboard: { title: "概览", description: "服务状态、日志与快捷操作" },
  ai: { title: "AI 模型配置", description: "配置 AI 提供商和模型" },
  channels: {
    title: "消息渠道",
    description: "配置 Telegram、Discord、飞书等",
  },
  testing: { title: "测试诊断", description: "系统诊断与问题排查" },
  logs: { title: "应用日志", description: "查看 Manager 应用的控制台日志" },
  settings: { title: "设置", description: "身份配置与高级选项" },
};

export function Header({
  currentPage,
  webMode = false,
  onLogout,
}: HeaderProps) {
  const { title, description } = pageTitles[currentPage];
  const [opening, setOpening] = useState(false);
  const mobileHeaderRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    const headerEl = mobileHeaderRef.current;

    if (!headerEl) {
      return;
    }

    const updateMobileHeaderHeight = () => {
      if (window.matchMedia("(min-width: 768px)").matches) {
        root.style.setProperty("--mobile-header-height", "0px");
        return;
      }

      const nextHeight = Math.ceil(headerEl.getBoundingClientRect().height);
      root.style.setProperty("--mobile-header-height", `${nextHeight}px`);
    };

    updateMobileHeaderHeight();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => updateMobileHeaderHeight())
        : null;

    if (resizeObserver) {
      resizeObserver.observe(headerEl);
    }

    window.addEventListener("resize", updateMobileHeaderHeight);

    return () => {
      window.removeEventListener("resize", updateMobileHeaderHeight);
      resizeObserver?.disconnect();
    };
  }, [currentPage, webMode]);

  const handleOpenDashboard = async () => {
    setOpening(true);
    try {
      if (isTauri()) {
        const url = await invoke<string>("get_dashboard_url");
        const { open } = await import("@tauri-apps/plugin-shell");
        await open(url);
      } else {
        const token = await invoke<string>("get_or_create_gateway_token");
        const baseUrl =
          import.meta.env.VITE_GATEWAY_BASE_URL ||
          `${window.location.protocol}//${window.location.hostname}:18789`;
        window.open(`${baseUrl}?token=${token}`, "_blank");
      }
    } catch (e) {
      console.error("打开 Dashboard 失败:", e);
      if (!isTauri()) {
        const fallbackBase =
          import.meta.env.VITE_GATEWAY_BASE_URL ||
          `${window.location.protocol}//${window.location.hostname}:18789`;
        window.open(fallbackBase, "_blank");
      } else {
        window.open("http://localhost:18789", "_blank");
      }
    } finally {
      setOpening(false);
    }
  };

  return (
    <header
      ref={mobileHeaderRef}
      className="fixed inset-x-0 top-0 z-40 shrink-0 border-b border-dark-600 bg-dark-800/95 backdrop-blur-sm md:static md:z-auto md:h-14 md:bg-dark-800/50"
    >
      <div className="titlebar-no-drag flex flex-col px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.5rem)] md:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-claw-400 to-claw-600">
              <span className="text-lg">🦞</span>
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold leading-tight text-white">
                OpenClaw
              </h1>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>Manager</span>
                <span className="text-[10px]">
                  {import.meta.env.PACKAGE_VERSION ?? __BUILD_VERSION__}
                </span>
              </div>
            </div>
          </div>

          {webMode && onLogout && (
            <button
              onClick={onLogout}
              className="inline-flex min-h-[44px] shrink-0 items-center rounded-lg px-3 text-sm text-gray-300 transition-colors hover:bg-dark-600 hover:text-white"
              title="退出登录"
            >
              退出登录
            </button>
          )}
        </div>

        <div className="mt-2 min-w-0">
          <h2 className="truncate text-base font-semibold text-white">
            {title}
          </h2>
          <p className="truncate text-xs text-gray-500">{description}</p>
        </div>
      </div>

      <div className="titlebar-drag hidden h-full items-center justify-between px-6 md:flex">
        <div className="titlebar-no-drag min-w-0">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <p className="text-xs text-gray-500">{description}</p>
        </div>

        <div className="titlebar-no-drag flex items-center gap-2">
          {webMode && (
            <span className="inline-flex items-center rounded-md border border-dark-500 bg-dark-700/70 px-3 py-1 text-xs text-gray-300">
              Web 管理模式
            </span>
          )}
          <button
            onClick={() => window.location.reload()}
            className="icon-button text-gray-400 hover:text-white"
            title="刷新"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={handleOpenDashboard}
            disabled={opening}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-dark-600 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-dark-500 hover:text-white disabled:opacity-50"
            title="打开 Web Dashboard"
          >
            {opening ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <ExternalLink size={14} />
            )}
            <span>Dashboard</span>
          </button>
          {webMode && onLogout && (
            <button
              onClick={onLogout}
              className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm text-gray-300 transition-colors hover:bg-dark-600 hover:text-white"
              title="退出登录"
            >
              退出登录
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
