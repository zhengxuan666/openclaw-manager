import { motion } from "framer-motion";

declare const __BUILD_VERSION__: string;
import {
  LayoutDashboard,
  Bot,
  MessageSquare,
  FlaskConical,
  ScrollText,
  Settings,
} from "lucide-react";
import { PageType } from "../../App";
import clsx from "clsx";

interface ServiceStatus {
  running: boolean;
  pid: number | null;
  port: number;
}

interface SidebarProps {
  currentPage: PageType;
  onNavigate: (page: PageType) => void;
  serviceStatus: ServiceStatus | null;
}

const menuItems: {
  id: PageType;
  label: string;
  mobileLabel: string;
  icon: React.ElementType;
}[] = [
  {
    id: "dashboard",
    label: "概览",
    mobileLabel: "概览",
    icon: LayoutDashboard,
  },
  { id: "ai", label: "AI 配置", mobileLabel: "AI", icon: Bot },
  {
    id: "channels",
    label: "消息渠道",
    mobileLabel: "渠道",
    icon: MessageSquare,
  },
  { id: "testing", label: "测试诊断", mobileLabel: "测试", icon: FlaskConical },
  { id: "logs", label: "应用日志", mobileLabel: "日志", icon: ScrollText },
  { id: "settings", label: "设置", mobileLabel: "设置", icon: Settings },
];

export function Sidebar({
  currentPage,
  onNavigate,
  serviceStatus,
}: SidebarProps) {
  const isRunning = serviceStatus?.running ?? false;

  return (
    <>
      <aside className="relative z-20 hidden h-full min-h-0 w-64 shrink-0 border-r border-dark-600 bg-dark-800 pointer-events-auto md:flex md:flex-col">
        {/* Logo 区域（macOS 标题栏拖拽） */}
        <div className="titlebar-drag flex h-14 items-center border-b border-dark-600 px-4 md:px-6">
          <div className="titlebar-no-drag flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-claw-400 to-claw-600">
              <span className="text-lg">🦞</span>
            </div>
            <div>
              <h1 className="text-sm font-semibold text-white">OpenClaw</h1>
              <div className="flex items-center gap-2">
                <p className="text-xs text-gray-500">Manager</p>
                <span className="text-[10px] text-gray-500">
                  {__BUILD_VERSION__}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 桌面端导航菜单 */}
        <nav className="hidden md:block md:flex-1 md:min-h-0 md:overflow-y-auto md:px-3 md:py-4">
          <ul className="space-y-1">
            {menuItems.map((item) => {
              const isActive = currentPage === item.id;
              const Icon = item.icon;

              return (
                <li key={item.id}>
                  <button
                    onClick={() => onNavigate(item.id)}
                    className={clsx(
                      "relative flex min-h-[44px] w-full items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition-all",
                      isActive
                        ? "bg-dark-600 text-white"
                        : "text-gray-400 hover:bg-dark-700 hover:text-white"
                    )}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="activeIndicator"
                        className="absolute left-0 top-1/2 hidden h-6 w-1 -translate-y-1/2 rounded-r-full bg-claw-500 md:block"
                        transition={{
                          type: "spring",
                          stiffness: 300,
                          damping: 30,
                        }}
                      />
                    )}
                    <Icon
                      size={18}
                      className={isActive ? "text-claw-400" : ""}
                    />
                    <span>{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* 底部信息 */}
        <div className="hidden border-t border-dark-600 p-4 md:block">
          <div className="rounded-lg bg-dark-700 px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
              <div
                className={clsx(
                  "status-dot",
                  isRunning ? "running" : "stopped"
                )}
              />
              <span className="text-xs text-gray-400">
                {isRunning ? "服务运行中" : "服务未启动"}
              </span>
            </div>
            <p className="text-xs text-gray-500">
              端口: {serviceStatus?.port ?? 18789}
            </p>
          </div>
        </div>
      </aside>

      {/* 移动端固定导航，确保任意页面都可切换 */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-dark-600 bg-dark-800/95 backdrop-blur md:hidden">
        <ul className="grid grid-cols-6 gap-1 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2">
          {menuItems.map((item) => {
            const isActive = currentPage === item.id;
            const Icon = item.icon;

            return (
              <li key={item.id}>
                <button
                  onClick={() => onNavigate(item.id)}
                  className={clsx(
                    "flex min-h-[52px] w-full flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-medium transition-colors",
                    isActive
                      ? "bg-dark-600 text-white"
                      : "text-gray-400 hover:bg-dark-700 hover:text-white"
                  )}
                >
                  <Icon size={16} className={isActive ? "text-claw-400" : ""} />
                  <span className="leading-none">{item.mobileLabel}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
