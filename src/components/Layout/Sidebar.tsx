import { motion } from "framer-motion";
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

const menuItems: { id: PageType; label: string; icon: React.ElementType }[] = [
  { id: "dashboard", label: "概览", icon: LayoutDashboard },
  { id: "ai", label: "AI 配置", icon: Bot },
  { id: "channels", label: "消息渠道", icon: MessageSquare },
  { id: "testing", label: "测试诊断", icon: FlaskConical },
  { id: "logs", label: "应用日志", icon: ScrollText },
  { id: "settings", label: "设置", icon: Settings },
];

export function Sidebar({
  currentPage,
  onNavigate,
  serviceStatus,
}: SidebarProps) {
  const isRunning = serviceStatus?.running ?? false;
  return (
    <aside className="w-full border-b border-dark-600 bg-dark-800 md:h-full md:w-64 md:border-b-0 md:border-r md:flex md:flex-col">
      {/* Logo 区域（macOS 标题栏拖拽） */}
      <div className="titlebar-drag flex h-14 items-center border-b border-dark-600 px-4 md:px-6">
        <div className="titlebar-no-drag flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-claw-400 to-claw-600">
            <span className="text-lg">🦞</span>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white">OpenClaw</h1>
            <p className="text-xs text-gray-500">Manager</p>
          </div>
        </div>
      </div>

      {/* 导航菜单 */}
      <nav className="overflow-x-auto px-3 py-2 md:flex-1 md:overflow-y-auto md:overflow-x-hidden md:py-4">
        <ul className="flex gap-1 md:block md:space-y-1 md:gap-0">
          {menuItems.map((item) => {
            const isActive = currentPage === item.id;
            const Icon = item.icon;

            return (
              <li key={item.id} className="shrink-0 md:shrink">
                <button
                  onClick={() => onNavigate(item.id)}
                  className={clsx(
                    "relative flex min-h-[44px] items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all md:w-full md:gap-3 md:px-4 md:py-2.5",
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
                  <Icon size={18} className={isActive ? "text-claw-400" : ""} />
                  <span className="whitespace-nowrap">{item.label}</span>
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
              className={clsx("status-dot", isRunning ? "running" : "stopped")}
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
  );
}
