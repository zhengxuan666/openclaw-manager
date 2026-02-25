import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  invokeCommand as invoke,
  getWebAuthStatus,
  loginWebAdmin,
  setupWebAdmin,
  logoutWebAdmin,
} from "./lib/invoke";
import { Sidebar } from "./components/Layout/Sidebar";
import { Header } from "./components/Layout/Header";
import { Dashboard } from "./components/Dashboard";
import { AgentCenter } from "./components/AgentCenter";
import { useAgentCenterData } from "./components/AgentCenter/useAgentCenterData";
import { AIConfig } from "./components/AIConfig";
import { Channels } from "./components/Channels";
import { Settings } from "./components/Settings";
import { Testing } from "./components/Testing";
import { Logs } from "./components/Logs";
import { appLogger } from "./lib/logger";
import { isTauri } from "./lib/tauri";
import { Download, X, Loader2, CheckCircle, AlertCircle } from "lucide-react";

export type PageType =
  | "dashboard"
  | "testingCenter"
  | "agent"
  | "ai"
  | "channels"
  | "logs"
  | "settings";

export type AgentViewMode = "list" | "workspace";

export interface EnvironmentStatus {
  node_installed: boolean;
  node_version: string | null;
  node_version_ok: boolean;
  openclaw_installed: boolean;
  openclaw_version: string | null;
  config_dir_exists: boolean;
  ready: boolean;
  os: string;
}

interface ServiceStatus {
  running: boolean;
  pid: number | null;
  port: number;
}

interface UpdateInfo {
  update_available: boolean;
  current_version: string | null;
  latest_version: string | null;
  error: string | null;
}

interface UpdateResult {
  success: boolean;
  message: string;
  error?: string;
}

const WEB_AUTH_USERNAME_CACHE_KEY = "OPENCLAW_WEB_USERNAME";

const readCachedUsername = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const cachedUsername = window.localStorage.getItem(
      WEB_AUTH_USERNAME_CACHE_KEY
    );
    if (!cachedUsername) {
      return null;
    }

    const normalizedUsername = cachedUsername.trim();
    return normalizedUsername.length > 0 ? normalizedUsername : null;
  } catch (error) {
    console.warn("读取登录用户名缓存失败", error);
    return null;
  }
};

const writeCachedUsername = (nextUsername: string): void => {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedUsername = nextUsername.trim();
  if (!normalizedUsername) {
    return;
  }

  try {
    window.localStorage.setItem(
      WEB_AUTH_USERNAME_CACHE_KEY,
      normalizedUsername
    );
  } catch (error) {
    console.warn("写入登录用户名缓存失败", error);
  }
};

function App() {
  const [currentPage, setCurrentPage] = useState<PageType>("dashboard");
  const [isReady, setIsReady] = useState<boolean | null>(null);
  const [envStatus, setEnvStatus] = useState<EnvironmentStatus | null>(null);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus | null>(
    null
  );
  const [agentCenterDirty, setAgentCenterDirty] = useState(false);
  const [agentViewMode, setAgentViewMode] = useState<AgentViewMode>("list");
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const {
    dataState: agentCenterDataState,
    dataActions: agentCenterDataActions,
  } = useAgentCenterData();

  const webMode = !isTauri();
  const [authChecked, setAuthChecked] = useState(!webMode);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [authenticated, setAuthenticated] = useState(!webMode);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [username, setUsername] = useState(() =>
    webMode ? readCachedUsername() ?? "admin" : "admin"
  );
  const [password, setPassword] = useState("");

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null);
  const mainScrollRef = useRef<HTMLElement | null>(null);

  const refreshAuthStatus = useCallback(async () => {
    if (!webMode) {
      return;
    }

    try {
      const status = await getWebAuthStatus();
      setNeedsSetup(status.needs_setup);
      setAuthenticated(status.authenticated);
      if (status.username) {
        setUsername(status.username);
        writeCachedUsername(status.username);
      }
      setAuthChecked(true);
    } catch (error) {
      setAuthError(String(error));
      setAuthChecked(true);
      setAuthenticated(false);
    }
  }, [webMode]);

  const checkEnvironment = useCallback(async () => {
    appLogger.info("开始检查系统环境...");
    try {
      const status = await invoke<EnvironmentStatus>("check_environment");
      appLogger.info("环境检查完成", status);
      setEnvStatus(status);
      setIsReady(true);
    } catch (e) {
      appLogger.error("环境检查失败", e);
      setIsReady(true);
    }
  }, []);

  const checkUpdate = useCallback(async () => {
    appLogger.info("检查 OpenClaw 更新...");
    try {
      const info = await invoke<UpdateInfo>("check_openclaw_update");
      appLogger.info("更新检查结果", info);
      setUpdateInfo(info);
      if (info.update_available) {
        setShowUpdateBanner(true);
      }
    } catch (e) {
      appLogger.error("检查更新失败", e);
    }
  }, []);

  const handleUpdate = async () => {
    setUpdating(true);
    setUpdateResult(null);
    try {
      const result = await invoke<UpdateResult>("update_openclaw");
      setUpdateResult(result);
      if (result.success) {
        await checkEnvironment();
        setTimeout(() => {
          setShowUpdateBanner(false);
          setUpdateResult(null);
        }, 3000);
      }
    } catch (e) {
      setUpdateResult({
        success: false,
        message: "更新过程中发生错误",
        error: String(e),
      });
    } finally {
      setUpdating(false);
    }
  };

  useEffect(() => {
    appLogger.info("🦞 App 组件已挂载");
    refreshAuthStatus();
  }, [refreshAuthStatus]);

  useEffect(() => {
    if (!authChecked) {
      return;
    }

    if (webMode && !authenticated) {
      setIsReady(true);
      return;
    }

    checkEnvironment();
  }, [authChecked, authenticated, webMode, checkEnvironment]);

  useEffect(() => {
    if (!authChecked) {
      return;
    }

    if (webMode && !authenticated) {
      return;
    }

    const timer = setTimeout(() => {
      checkUpdate();
    }, 2000);

    return () => clearTimeout(timer);
  }, [checkUpdate, authChecked, authenticated, webMode]);

  useEffect(() => {
    if (webMode && !authenticated) {
      return;
    }

    const fetchServiceStatus = async () => {
      try {
        const status = await invoke<ServiceStatus>("get_service_status");
        setServiceStatus(status);
      } catch {
        // 静默处理轮询错误
      }
    };

    fetchServiceStatus();
    const interval = setInterval(fetchServiceStatus, 3000);
    return () => clearInterval(interval);
  }, [webMode, authenticated]);

  // 兜底：页面切换后重置主滚动容器，避免某些子页面滚动逻辑污染首屏位置
  useEffect(() => {
    const mainEl = mainScrollRef.current;
    if (!mainEl) {
      return;
    }

    mainEl.scrollTo({ top: 0, behavior: "auto" });
  }, [currentPage]);

  const handleSetupComplete = useCallback(() => {
    appLogger.info("安装向导完成");
    checkEnvironment();
  }, [checkEnvironment]);

  const openAgentList = useCallback(() => {
    setAgentViewMode("list");
    setActiveAgentId(null);
  }, []);

  const openAgentWorkspace = useCallback((agentId: string) => {
    setAgentViewMode("workspace");
    setActiveAgentId(agentId);
  }, []);

  const handleNavigate = (page: PageType) => {
    if (currentPage === "agent" && page !== "agent" && agentCenterDirty) {
      const isConflictProneTarget = page === "settings" || page === "channels";
      const confirmed = window.confirm(
        isConflictProneTarget
          ? "智能体模块存在未保存草稿。即将进入 Settings/Channels（同样可能写入 agents.list、agents.defaults 与 bindings），继续操作可能产生跨模块配置冲突。建议先在智能体模块应用或撤销后再跳转。确认继续吗？未保存草稿会保留在当前会话。"
          : "智能体模块存在未保存草稿，确认离开当前页面吗？未保存草稿会保留在当前会话。"
      );
      if (!confirmed) {
        return;
      }
    }

    if (page === "agent") {
      if (currentPage === "agent" && agentViewMode === "workspace") {
        if (agentCenterDirty) {
          const confirmed = window.confirm(
            "当前 Agent 详情存在未保存变更，确认返回列表并保留草稿吗？"
          );
          if (!confirmed) {
            return;
          }
        }
        openAgentList();
        return;
      }

      if (currentPage !== "agent") {
        openAgentList();
      }
    }

    appLogger.action("页面切换", { from: currentPage, to: page });
    setCurrentPage(page);
  };

  const handleAuthSubmit = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      if (needsSetup) {
        await setupWebAdmin(username, password);
      } else {
        await loginWebAdmin(username, password);
      }
      writeCachedUsername(username);
      setPassword("");
      await refreshAuthStatus();
    } catch (error) {
      setAuthError(String(error));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logoutWebAdmin();
    } catch (error) {
      console.error("退出登录失败", error);
    } finally {
      setAuthenticated(false);
      setNeedsSetup(false);
      await refreshAuthStatus();
    }
  };

  const renderPage = () => {
    const pages: Record<PageType, JSX.Element> = {
      dashboard: (
        <Dashboard
          envStatus={envStatus}
          onSetupComplete={handleSetupComplete}
          onOpenTestingCenter={() => handleNavigate("testingCenter")}
        />
      ),
      agent: (
        <AgentCenter
          onOpenSettings={() => handleNavigate("settings")}
          onOpenChannels={() => handleNavigate("channels")}
          onDirtyChange={setAgentCenterDirty}
          viewMode={agentViewMode}
          activeAgentId={activeAgentId}
          onOpenWorkspace={openAgentWorkspace}
          onBackToList={openAgentList}
          dataState={agentCenterDataState}
          dataActions={agentCenterDataActions}
        />
      ),
      ai: <AIConfig />,
      channels: <Channels />,
      testingCenter: <Testing />,
      logs: <Logs />,
      settings: <Settings onEnvironmentChange={checkEnvironment} />,
    };

    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={currentPage}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
          className="h-full"
        >
          {pages[currentPage]}
        </motion.div>
      </AnimatePresence>
    );
  };

  if (!authChecked || isReady === null) {
    return (
      <div className="app-viewport-height flex bg-dark-900 items-center justify-center">
        <div className="fixed inset-0 bg-gradient-radial pointer-events-none" />
        <div className="relative z-10 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-gradient-to-br from-brand-500 to-purple-600 mb-4 animate-pulse">
            <span className="text-3xl">🦞</span>
          </div>
          <p className="text-dark-400">正在启动...</p>
        </div>
      </div>
    );
  }

  if (webMode && !authenticated) {
    return (
      <div className="app-viewport-height flex bg-dark-900 items-center justify-center px-4">
        <div className="w-full max-w-md bg-dark-700 rounded-2xl border border-dark-500 p-6 space-y-4">
          <h2 className="text-white text-xl font-semibold">
            OpenClaw Manager Web
          </h2>
          <p className="text-sm text-gray-400">
            {needsSetup
              ? "首次使用，请初始化管理员账号"
              : "请登录后访问管理后台"}
          </p>

          <div>
            <label className="block text-sm text-gray-400 mb-2">用户名</label>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="input-base"
              placeholder="admin"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">密码</label>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="input-base"
              placeholder="请输入密码"
            />
          </div>

          {authError && <p className="text-sm text-red-400">{authError}</p>}

          <button
            onClick={handleAuthSubmit}
            disabled={authBusy}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {authBusy ? <Loader2 size={16} className="animate-spin" /> : null}
            {needsSetup ? "初始化并登录" : "登录"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-viewport-height flex flex-col bg-dark-900 overflow-hidden md:flex-row">
      <div className="fixed inset-0 bg-gradient-radial pointer-events-none" />

      <AnimatePresence>
        {showUpdateBanner && updateInfo?.update_available && (
          <motion.div
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className="fixed left-0 right-0 z-50 top-[calc(var(--mobile-header-height)+0.25rem)] bg-gradient-to-r from-claw-600 to-purple-600 shadow-lg md:top-0"
          >
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                {updateResult?.success ? (
                  <CheckCircle size={20} className="mt-0.5 text-green-300" />
                ) : updateResult && !updateResult.success ? (
                  <AlertCircle size={20} className="mt-0.5 text-red-300" />
                ) : (
                  <Download size={20} className="mt-0.5 text-white" />
                )}
                <div>
                  {updateResult ? (
                    <p
                      className={`text-sm font-medium ${
                        updateResult.success ? "text-green-100" : "text-red-100"
                      }`}
                    >
                      {updateResult.message}
                    </p>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-white">
                        发现新版本 OpenClaw {updateInfo.latest_version}
                      </p>
                      <p className="text-xs text-white/70">
                        当前版本: {updateInfo.current_version}
                      </p>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                {!updateResult && (
                  <button
                    onClick={handleUpdate}
                    disabled={updating}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-white/20 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/30 disabled:opacity-50"
                  >
                    {updating ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        更新中...
                      </>
                    ) : (
                      <>
                        <Download size={14} />
                        立即更新
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowUpdateBanner(false);
                    setUpdateResult(null);
                  }}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-1.5 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Sidebar
        currentPage={currentPage}
        onNavigate={handleNavigate}
        serviceStatus={serviceStatus}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Header
          currentPage={currentPage}
          webMode={webMode}
          onLogout={webMode ? handleLogout : undefined}
        />
        <main
          ref={mainScrollRef}
          className="flex-1 min-h-0 min-w-0 overflow-hidden px-4 pb-[var(--mobile-bottom-nav-height)] pt-[calc(var(--mobile-header-height)+0.75rem)] md:p-6 md:pb-6 md:pt-6"
        >
          {renderPage()}
        </main>
      </div>
    </div>
  );
}

export default App;
