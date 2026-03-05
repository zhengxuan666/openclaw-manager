import { useCallback, useState } from "react";
import { motion } from "framer-motion";

declare const __BUILD_VERSION__: string;
import {
  LayoutDashboard,
  Bot,
  Sparkles,
  MessageSquare,
  ScrollText,
  Settings,
  Eye,
  Save,
  Undo2,
  History,
  Loader2,
  ChevronDown,
  AlertCircle,
  X,
  RotateCcw,
} from "lucide-react";
import { PageType } from "../../App";
import clsx from "clsx";
import { invokeCommand as invoke } from "../../lib/invoke";
import { useStagingSession } from "../../contexts/StagingSessionContext";
import {
  ConfigChangePreviewDialog,
  type ApplyConfigResponse,
} from "../shared/ConfigChangePreviewDialog";

interface ServiceStatus {
  running: boolean;
  pid: number | null;
  port: number;
}

interface ConfigBackupItem {
  path: string;
  createdAt: string;
  size: number;
}

interface RollbackConfigResponse {
  restored_path: string;
  restored_at: string;
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
  { id: "agent", label: "智能体", mobileLabel: "Agent", icon: Bot },
  { id: "ai", label: "AI 配置", mobileLabel: "AI", icon: Sparkles },
  {
    id: "channels",
    label: "消息渠道",
    mobileLabel: "渠道",
    icon: MessageSquare,
  },
  { id: "logs", label: "应用日志", mobileLabel: "日志", icon: ScrollText },
  { id: "settings", label: "设置", mobileLabel: "设置", icon: Settings },
];

export function Sidebar({
  currentPage,
  onNavigate,
  serviceStatus,
}: SidebarProps) {
  const staging = useStagingSession();
  const isRunning = serviceStatus?.running ?? false;
  const hasPendingChanges = staging.changeCount > 0;

  const [showLabels, setShowLabels] = useState(false);
  const [showRollbackDialog, setShowRollbackDialog] = useState(false);
  const [backupOptions, setBackupOptions] = useState<ConfigBackupItem[]>([]);
  const [selectedBackupPath, setSelectedBackupPath] = useState("");
  const [backupListLoading, setBackupListLoading] = useState(false);
  const [rollbackLoading, setRollbackLoading] = useState(false);

  const handleSessionApply =
    useCallback(async (): Promise<ApplyConfigResponse> => {
      const result = await staging.applySession();
      // 清理 preview 生成的 staged 文件
      if (staging.previewData) {
        try {
          await invoke<string>("discard_staged_config", {
            stagingId: staging.previewData.staging_id,
          });
        } catch {
          // 忽略清理错误
        }
      }
      return result;
    }, [staging]);

  const handleSessionPreviewCancel = useCallback(async () => {
    // 清理 preview 生成的 staged 文件但保留 session
    if (staging.previewData) {
      try {
        await invoke<string>("discard_staged_config", {
          stagingId: staging.previewData.staging_id,
        });
      } catch {
        // 忽略清理错误
      }
    }
    staging.closePreview();
  }, [staging]);

  const handleDirectSessionApply = useCallback(async () => {
    if (!hasPendingChanges) {
      return;
    }

    const confirmed = window.confirm("确定要保存当前 Session 的全部变更吗？");
    if (!confirmed) {
      return;
    }

    try {
      await handleSessionApply();
      window.location.reload();
    } catch (e) {
      console.error("保存 session 失败:", e);
      window.alert(`保存失败: ${String(e)}`);
    }
  }, [handleSessionApply, hasPendingChanges]);

  const handleSessionDiscard = useCallback(async () => {
    if (!hasPendingChanges) {
      return;
    }

    if (
      !window.confirm("确定要撤销所有未保存的 Session 变更吗？此操作不可撤销。")
    ) {
      return;
    }

    try {
      await staging.discardSession();
    } catch (e) {
      console.error("撤销 session 失败:", e);
      window.alert(`撤销失败: ${String(e)}`);
    }
  }, [hasPendingChanges, staging]);

  const handleOpenRollbackDialog = useCallback(async () => {
    setBackupListLoading(true);
    try {
      const backups = await invoke<ConfigBackupItem[]>("list_config_backups");
      if (!Array.isArray(backups) || backups.length === 0) {
        window.alert("未找到可用备份，请先应用一次配置生成备份");
        return;
      }

      setBackupOptions(backups);
      setSelectedBackupPath(backups[0]?.path ?? "");
      setShowRollbackDialog(true);
    } catch (e) {
      console.error("获取备份列表失败:", e);
      window.alert(`获取备份列表失败: ${String(e)}`);
    } finally {
      setBackupListLoading(false);
    }
  }, []);

  const handleConfirmRollback = useCallback(async () => {
    if (!selectedBackupPath) {
      window.alert("请先选择要回滚的备份版本");
      return;
    }

    if (!window.confirm("确定要回滚到所选备份吗？当前配置会被覆盖。")) {
      return;
    }

    setRollbackLoading(true);
    try {
      await invoke<RollbackConfigResponse>("rollback_config", {
        backupPath: selectedBackupPath,
      });
      setShowRollbackDialog(false);
      window.location.reload();
    } catch (e) {
      console.error("回滚失败:", e);
      window.alert(`回滚失败: ${String(e)}`);
    } finally {
      setRollbackLoading(false);
    }
  }, [selectedBackupPath]);

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
          <div className="space-y-3">
            <div className="rounded-lg border border-dark-500 bg-dark-700/50 p-3">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-gray-400">Session 全局操作</p>
                  <p
                    className={clsx(
                      "mt-1 text-sm font-medium",
                      hasPendingChanges ? "text-amber-300" : "text-gray-500"
                    )}
                  >
                    {hasPendingChanges
                      ? `${staging.changeCount} 项待保存`
                      : "暂无待保存变更"}
                  </p>
                </div>
                {hasPendingChanges && staging.changeLabels.length > 0 && (
                  <button
                    onClick={() => setShowLabels((prev) => !prev)}
                    className="inline-flex min-h-[28px] items-center gap-1 rounded-md border border-dark-500 px-2 text-[11px] text-gray-300 transition-colors hover:border-dark-400 hover:text-white"
                  >
                    详情
                    <ChevronDown
                      size={12}
                      className={clsx("transition-transform", {
                        "rotate-180": showLabels,
                      })}
                    />
                  </button>
                )}
              </div>

              {showLabels &&
                hasPendingChanges &&
                staging.changeLabels.length > 0 && (
                  <ul className="mb-3 max-h-24 space-y-1 overflow-y-auto rounded-md border border-dark-500 bg-dark-800/70 p-2">
                    {staging.changeLabels.map((label, index) => (
                      <li
                        key={`${label}-${index}`}
                        className="truncate rounded bg-dark-600 px-1.5 py-1 text-xs text-gray-300"
                      >
                        {label}
                      </li>
                    ))}
                  </ul>
                )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => void staging.openPreview()}
                  disabled={
                    !hasPendingChanges || staging.applying || staging.discarding
                  }
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-claw-500/40 bg-claw-500/10 px-2 py-2 text-xs font-medium text-claw-300 transition-colors hover:bg-claw-500/20 disabled:opacity-50"
                >
                  <Eye size={13} />
                  预览差异
                </button>

                <button
                  onClick={handleDirectSessionApply}
                  disabled={
                    !hasPendingChanges || staging.applying || staging.discarding
                  }
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-claw-600 px-2 py-2 text-xs font-medium text-white transition-colors hover:bg-claw-500 disabled:opacity-50"
                >
                  {staging.applying ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Save size={13} />
                  )}
                  保存
                </button>

                <button
                  onClick={handleSessionDiscard}
                  disabled={
                    !hasPendingChanges || staging.applying || staging.discarding
                  }
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-dark-500 px-2 py-2 text-xs font-medium text-gray-300 transition-colors hover:border-red-500/50 hover:text-red-300 disabled:opacity-50"
                >
                  {staging.discarding ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Undo2 size={13} />
                  )}
                  撤销
                </button>

                <button
                  onClick={handleOpenRollbackDialog}
                  disabled={backupListLoading || rollbackLoading}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-2 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
                >
                  {backupListLoading ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <History size={13} />
                  )}
                  备份回滚
                </button>
              </div>
            </div>

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
        </div>
      </aside>

      {hasPendingChanges && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom)+0.5rem)] z-50 px-2 md:hidden">
          <div className="pointer-events-auto rounded-xl border border-amber-500/30 bg-dark-800/95 p-2 shadow-xl backdrop-blur">
            <div className="mb-2 flex items-center gap-1.5 text-xs text-amber-300">
              <AlertCircle size={14} />
              <span>Session 待保存 {staging.changeCount} 项</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => void staging.openPreview()}
                disabled={staging.applying || staging.discarding}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-claw-500/40 bg-claw-500/10 px-3 py-2 text-sm font-medium text-claw-300 transition-colors hover:bg-claw-500/20 disabled:opacity-50"
              >
                <Eye size={14} />
                预览
              </button>
              <button
                onClick={handleDirectSessionApply}
                disabled={staging.applying || staging.discarding}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-claw-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-claw-500 disabled:opacity-50"
              >
                {staging.applying ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                保存
              </button>
            </div>
          </div>
        </div>
      )}

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

      {staging.previewOpen && staging.previewData && (
        <ConfigChangePreviewDialog
          open={staging.previewOpen}
          preview={staging.previewData}
          title="应用所有配置变更"
          onApply={handleSessionApply}
          onApplied={() => {
            staging.closePreview();
            window.location.reload();
          }}
          onCancelled={handleSessionPreviewCancel}
        />
      )}

      {showRollbackDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-dark-500 bg-dark-700 p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">选择回滚版本</h3>
              <button
                onClick={() => setShowRollbackDialog(false)}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-gray-400 transition-colors hover:text-white"
                disabled={rollbackLoading}
              >
                <X size={18} />
              </button>
            </div>

            <p className="mb-4 text-sm text-gray-300">
              请选择要还原的备份版本，然后确认执行回滚。
            </p>

            <div className="mb-5 max-h-72 space-y-2 overflow-auto">
              {backupOptions.map((item) => {
                const selected = selectedBackupPath === item.path;
                return (
                  <label
                    key={item.path}
                    className={clsx(
                      "block cursor-pointer rounded-lg border p-3 transition-colors",
                      selected
                        ? "border-claw-500 bg-claw-500/10"
                        : "border-dark-500 bg-dark-600 hover:bg-dark-500"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="radio"
                        name="sidebar-rollback-backup"
                        checked={selected}
                        onChange={() => setSelectedBackupPath(item.path)}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-white">{item.createdAt}</p>
                        <p className="mt-1 break-all text-xs text-gray-400">
                          {item.path}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          {(item.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowRollbackDialog(false)}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-lg bg-dark-600 px-4 py-2.5 text-white transition-colors hover:bg-dark-500"
                disabled={rollbackLoading}
              >
                取消
              </button>
              <button
                onClick={handleConfirmRollback}
                disabled={rollbackLoading || !selectedBackupPath}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-white transition-colors hover:bg-amber-500 disabled:opacity-50"
              >
                {rollbackLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <RotateCcw size={16} />
                )}
                {rollbackLoading ? "回滚中..." : "确认回滚"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
