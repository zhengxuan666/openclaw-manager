import { useEffect, useState } from "react";
import { invokeCommand as invoke } from "../../lib/invoke";
import {
  User,
  Shield,
  Save,
  Loader2,
  FolderOpen,
  FileCode,
  Trash2,
  AlertTriangle,
  X,
} from "lucide-react";

interface InstallResult {
  success: boolean;
  message: string;
  error?: string;
}

interface SettingsProps {
  onEnvironmentChange?: () => void;
}

export function Settings({ onEnvironmentChange }: SettingsProps) {
  const [identity, setIdentity] = useState({
    botName: "Clawd",
    userName: "主人",
    timezone: "Asia/Shanghai",
  });
  const [saving, setSaving] = useState(false);
  const [showUninstallConfirm, setShowUninstallConfirm] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [uninstallResult, setUninstallResult] = useState<InstallResult | null>(
    null
  );

  const [agentsListText, setAgentsListText] = useState("[]");
  const [bindingsText, setBindingsText] = useState("[]");
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configMessage, setConfigMessage] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    try {
      // TODO: 保存身份配置
      await new Promise((resolve) => setTimeout(resolve, 500));
      alert("设置已保存！");
    } catch (e) {
      console.error("保存失败:", e);
    } finally {
      setSaving(false);
    }
  };

  const openConfigDir = async () => {
    try {
      const home = await invoke<{ config_dir: string }>("get_system_info");
      const configPath = home.config_dir;

      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        const { open } = await import("@tauri-apps/plugin-shell");
        await open(configPath);
      } else {
        await navigator.clipboard.writeText(configPath);
        alert("配置目录路径已复制：" + configPath);
      }
    } catch (e) {
      console.error("打开目录失败:", e);
    }
  };

  const handleUninstall = async () => {
    setUninstalling(true);
    setUninstallResult(null);
    try {
      const result = await invoke<InstallResult>("uninstall_openclaw");
      setUninstallResult(result);
      if (result.success) {
        // 通知环境状态变化，触发重新检查
        onEnvironmentChange?.();
        // 卸载成功后关闭确认框
        setTimeout(() => {
          setShowUninstallConfirm(false);
        }, 2000);
      }
    } catch (e) {
      setUninstallResult({
        success: false,
        message: "卸载过程中发生错误",
        error: String(e),
      });
    } finally {
      setUninstalling(false);
    }
  };

  useEffect(() => {
    const loadAgentAndBindingConfig = async () => {
      setConfigLoading(true);
      setConfigError(null);

      try {
        const [agentsList, bindings] = await Promise.all([
          invoke<unknown>("get_agents_list"),
          invoke<unknown>("get_bindings"),
        ]);

        setAgentsListText(JSON.stringify(agentsList ?? [], null, 2));
        setBindingsText(JSON.stringify(bindings ?? [], null, 2));
      } catch (e) {
        console.error("加载 agents.list / bindings 失败:", e);
        setConfigError(String(e));
      } finally {
        setConfigLoading(false);
      }
    };

    loadAgentAndBindingConfig();
  }, []);

  const saveAgentAndBindingConfig = async () => {
    setConfigLoading(true);
    setConfigError(null);
    setConfigMessage(null);

    try {
      const parsedAgentsList = JSON.parse(agentsListText);
      const parsedBindings = JSON.parse(bindingsText);

      await invoke<string>("save_agents_list", {
        agentsList: parsedAgentsList,
      });
      await invoke<string>("save_bindings", { bindings: parsedBindings });

      setConfigMessage("agents.list 与 bindings 已保存");
    } catch (e) {
      console.error("保存 agents.list / bindings 失败:", e);
      setConfigError(String(e));
    } finally {
      setConfigLoading(false);
    }
  };

  return (
    <div className="module-page-shell">
      <div className="max-w-2xl space-y-6">
        {/* 身份配置 */}
        <div className="bg-dark-700 rounded-2xl p-6 border border-dark-500">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-claw-500/20 flex items-center justify-center">
              <User size={20} className="text-claw-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">身份配置</h3>
              <p className="text-xs text-gray-500">设置 AI 助手的名称和称呼</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                AI 助手名称
              </label>
              <input
                type="text"
                value={identity.botName}
                onChange={(e) =>
                  setIdentity({ ...identity, botName: e.target.value })
                }
                placeholder="Clawd"
                className="input-base"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">
                你的称呼
              </label>
              <input
                type="text"
                value={identity.userName}
                onChange={(e) =>
                  setIdentity({ ...identity, userName: e.target.value })
                }
                placeholder="主人"
                className="input-base"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">时区</label>
              <select
                value={identity.timezone}
                onChange={(e) =>
                  setIdentity({ ...identity, timezone: e.target.value })
                }
                className="input-base"
              >
                <option value="Asia/Shanghai">Asia/Shanghai (北京时间)</option>
                <option value="Asia/Hong_Kong">
                  Asia/Hong_Kong (香港时间)
                </option>
                <option value="Asia/Tokyo">Asia/Tokyo (东京时间)</option>
                <option value="America/New_York">
                  America/New_York (纽约时间)
                </option>
                <option value="America/Los_Angeles">
                  America/Los_Angeles (洛杉矶时间)
                </option>
                <option value="Europe/London">Europe/London (伦敦时间)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
          </div>
        </div>

        {/* 安全设置 */}
        <div className="bg-dark-700 rounded-2xl p-6 border border-dark-500">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
              <Shield size={20} className="text-amber-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">安全设置</h3>
              <p className="text-xs text-gray-500">权限和访问控制</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-dark-600 rounded-lg">
              <div>
                <p className="text-sm text-white">启用白名单</p>
                <p className="text-xs text-gray-500">只允许白名单用户访问</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" />
                <div className="w-11 h-6 bg-dark-500 peer-focus:ring-2 peer-focus:ring-claw-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-claw-500"></div>
              </label>
            </div>

            <div className="flex items-center justify-between p-4 bg-dark-600 rounded-lg">
              <div>
                <p className="text-sm text-white">文件访问权限</p>
                <p className="text-xs text-gray-500">允许 AI 读写本地文件</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" />
                <div className="w-11 h-6 bg-dark-500 peer-focus:ring-2 peer-focus:ring-claw-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-claw-500"></div>
              </label>
            </div>
          </div>
        </div>

        {/* 高级设置 */}
        <div className="bg-dark-700 rounded-2xl p-6 border border-dark-500">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
              <FileCode size={20} className="text-purple-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">高级设置</h3>
              <p className="text-xs text-gray-500">配置文件和目录</p>
            </div>
          </div>

          <div className="space-y-3">
            <button
              onClick={openConfigDir}
              className="w-full flex items-center gap-3 p-4 bg-dark-600 rounded-lg hover:bg-dark-500 transition-colors text-left"
            >
              <FolderOpen size={18} className="text-gray-400" />
              <div className="flex-1">
                <p className="text-sm text-white">打开配置目录</p>
                <p className="text-xs text-gray-500">~/.openclaw</p>
              </div>
            </button>
          </div>
        </div>

        {/* Agent 与 Binding 配置 */}
        <div className="bg-dark-700 rounded-2xl p-6 border border-dark-500">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center">
              <FileCode size={20} className="text-cyan-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">
                Agent 与 Binding 配置
              </h3>
              <p className="text-xs text-gray-500">
                使用 JSON 文本编辑 agents.list 与 bindings
              </p>
            </div>
          </div>

          {configError && (
            <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-800 text-sm text-red-300">
              {configError}
            </div>
          )}
          {configMessage && !configError && (
            <div className="mb-4 p-3 rounded-lg bg-green-900/30 border border-green-800 text-sm text-green-300">
              {configMessage}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                agents.list (JSON)
              </label>
              <textarea
                value={agentsListText}
                onChange={(e) => setAgentsListText(e.target.value)}
                rows={8}
                className="input-base font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">
                bindings (JSON)
              </label>
              <textarea
                value={bindingsText}
                onChange={(e) => setBindingsText(e.target.value)}
                rows={8}
                className="input-base font-mono text-xs"
              />
            </div>

            <div className="flex justify-end">
              <button
                onClick={saveAgentAndBindingConfig}
                disabled={configLoading}
                className="btn-secondary flex items-center gap-2"
              >
                {configLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Save size={16} />
                )}
                保存 agents.list / bindings
              </button>
            </div>
          </div>
        </div>

        {/* 危险操作 */}
        <div className="bg-dark-700 rounded-2xl p-6 border border-red-900/30">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
              <AlertTriangle size={20} className="text-red-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">危险操作</h3>
              <p className="text-xs text-gray-500">
                以下操作不可撤销，请谨慎操作
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => setShowUninstallConfirm(true)}
              className="w-full flex items-center gap-3 p-4 bg-red-950/30 rounded-lg hover:bg-red-900/40 transition-colors text-left border border-red-900/30"
            >
              <Trash2 size={18} className="text-red-400" />
              <div className="flex-1">
                <p className="text-sm text-red-300">卸载 OpenClaw</p>
                <p className="text-xs text-red-400/70">
                  从系统中移除 OpenClaw CLI 工具
                </p>
              </div>
            </button>
          </div>
        </div>

        {/* 卸载确认对话框 */}
        {showUninstallConfirm && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-dark-700 rounded-2xl p-6 border border-dark-500 max-w-md w-full mx-4 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
                    <AlertTriangle size={20} className="text-red-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-white">确认卸载</h3>
                </div>
                <button
                  onClick={() => {
                    setShowUninstallConfirm(false);
                    setUninstallResult(null);
                  }}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {!uninstallResult ? (
                <>
                  <p className="text-gray-300 mb-4">
                    确定要卸载 OpenClaw 吗？此操作将：
                  </p>
                  <ul className="text-sm text-gray-400 mb-6 space-y-2">
                    <li className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-red-400 rounded-full"></span>
                      停止正在运行的服务
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-red-400 rounded-full"></span>
                      移除 OpenClaw CLI 工具
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full"></span>
                      配置文件将被保留在 ~/.openclaw
                    </li>
                  </ul>

                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowUninstallConfirm(false)}
                      className="flex-1 px-4 py-2.5 bg-dark-600 hover:bg-dark-500 text-white rounded-lg transition-colors"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleUninstall}
                      disabled={uninstalling}
                      className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {uninstalling ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          卸载中...
                        </>
                      ) : (
                        <>
                          <Trash2 size={16} />
                          确认卸载
                        </>
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <div
                  className={`p-4 rounded-lg ${
                    uninstallResult.success
                      ? "bg-green-900/30 border border-green-800"
                      : "bg-red-900/30 border border-red-800"
                  }`}
                >
                  <p
                    className={`text-sm ${
                      uninstallResult.success
                        ? "text-green-300"
                        : "text-red-300"
                    }`}
                  >
                    {uninstallResult.message}
                  </p>
                  {uninstallResult.error && (
                    <p className="text-xs text-red-400 mt-2 font-mono">
                      {uninstallResult.error}
                    </p>
                  )}
                  {uninstallResult.success && (
                    <p className="text-xs text-gray-400 mt-3">
                      对话框将自动关闭...
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 保存按钮 */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary flex items-center gap-2"
          >
            {saving ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Save size={16} />
            )}
            保存设置
          </button>
        </div>
      </div>
    </div>
  );
}
