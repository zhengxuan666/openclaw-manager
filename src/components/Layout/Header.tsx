import { useState } from "react";
import { PageType } from "../../App";
import { RefreshCw, ExternalLink, Loader2 } from "lucide-react";
import { invokeCommand as invoke } from "../../lib/invoke";
import { isTauri } from "../../lib/tauri";

interface HeaderProps {
  currentPage: PageType;
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

export function Header({ currentPage }: HeaderProps) {
  const { title, description } = pageTitles[currentPage];
  const [opening, setOpening] = useState(false);

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
    <header className="titlebar-drag border-b border-dark-600 bg-dark-800/50 px-4 py-2 backdrop-blur-sm md:flex md:h-14 md:items-center md:justify-between md:px-6 md:py-0">
      <div className="titlebar-no-drag min-w-0">
        <h2 className="text-base font-semibold text-white md:text-lg">
          {title}
        </h2>
        <p className="hidden text-xs text-gray-500 sm:block">{description}</p>
      </div>

      <div className="titlebar-no-drag mt-2 flex items-center justify-end gap-2 md:mt-0">
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
          <span className="hidden sm:inline">Dashboard</span>
        </button>
      </div>
    </header>
  );
}
