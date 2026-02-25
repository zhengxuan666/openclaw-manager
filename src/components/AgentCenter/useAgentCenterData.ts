import { useCallback, useEffect, useState } from "react";
import { invokeCommand as invoke } from "../../lib/invoke";
import { createLogger } from "../../lib/logger";
import {
  type AgentCenterDataActions,
  type AgentCenterDataState,
  type BindingsPayload,
  buildAgentsPayload,
  cloneVisualAgents,
  parseAgentsList,
  parseBindings,
  parseDefaultScopeKeys,
  parseGatewaySummary,
  normalizeVisualAgents,
  type VisualAgent,
} from "./index";

const agentLogger = createLogger("Agent");

const createInitialDataState = (): AgentCenterDataState => ({
  loading: true,
  refreshing: false,
  saving: false,
  error: null,
  message: null,
  warnings: [],
  agents: [],
  baselineAgents: [],
  bindingsMap: {},
  gatewaySummary: parseGatewaySummary({}),
  defaultScopeKeys: [],
});

interface UseAgentCenterDataResult {
  dataState: AgentCenterDataState;
  dataActions: AgentCenterDataActions;
}

export function useAgentCenterData(): UseAgentCenterDataResult {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [agents, setAgents] = useState<VisualAgent[]>([]);
  const [baselineAgents, setBaselineAgents] = useState<VisualAgent[]>([]);
  const [bindingsMap, setBindingsMap] = useState<Record<string, string>>({});
  const [gatewaySummary, setGatewaySummary] = useState(parseGatewaySummary({}));
  const [defaultScopeKeys, setDefaultScopeKeys] = useState<string[]>([]);

  const reload = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError(null);
    agentLogger.info("加载智能体中心数据");

    try {
      const [agentsResult, bindingsResult, configResult] =
        await Promise.allSettled([
          invoke<unknown>("get_agents_list"),
          invoke<BindingsPayload>("get_bindings"),
          invoke<Record<string, unknown>>("get_config"),
        ]);

      const nextWarnings: string[] = [];

      const nextAgentsRaw =
        agentsResult.status === "fulfilled" ? agentsResult.value : [];
      if (agentsResult.status === "rejected") {
        nextWarnings.push("获取 agents.list 失败，已降级为空");
        agentLogger.warn("获取 agents.list 失败", agentsResult.reason);
      }

      let nextConfigRaw: unknown = {};
      if (configResult.status === "fulfilled") {
        nextConfigRaw = configResult.value;
      } else {
        agentLogger.warn("获取 get_config 失败", configResult.reason);

        try {
          nextConfigRaw = await invoke<Record<string, unknown>>("get_config");
          agentLogger.info("获取 get_config 重试成功");
        } catch (retryError) {
          nextWarnings.push("获取全局配置失败，作用域摘要已降级");
          agentLogger.warn(
            "获取 get_config 重试失败，作用域摘要已降级",
            retryError
          );
        }
      }

      let nextBindingsRaw: unknown = [];
      if (bindingsResult.status === "fulfilled") {
        nextBindingsRaw = bindingsResult.value;
      } else {
        agentLogger.warn("获取 bindings 失败", bindingsResult.reason);

        try {
          nextBindingsRaw = await invoke<BindingsPayload>("get_bindings");
          agentLogger.info("获取 bindings 重试成功");
        } catch (retryError) {
          const fallbackBindings =
            typeof nextConfigRaw === "object" &&
            nextConfigRaw !== null &&
            "bindings" in nextConfigRaw
              ? (nextConfigRaw as { bindings?: unknown }).bindings
              : undefined;

          if (fallbackBindings !== undefined) {
            nextBindingsRaw = fallbackBindings;
            agentLogger.warn(
              "获取 bindings 重试失败，已回退使用 get_config.bindings",
              retryError
            );
          } else {
            nextWarnings.push("获取 bindings 失败，已降级为空");
            agentLogger.warn("获取 bindings 重试失败，已降级为空", retryError);
          }
        }
      }

      const nextAgents = normalizeVisualAgents(parseAgentsList(nextAgentsRaw));
      const nextBindingsMap = parseBindings(nextBindingsRaw);

      setAgents(cloneVisualAgents(nextAgents));
      setBaselineAgents(cloneVisualAgents(nextAgents));
      setBindingsMap(nextBindingsMap);
      setGatewaySummary(parseGatewaySummary(nextConfigRaw));
      setDefaultScopeKeys(parseDefaultScopeKeys(nextConfigRaw));
      setWarnings(nextWarnings);
      setMessage(null);

      agentLogger.state("智能体中心摘要", {
        agentsCount: nextAgents.length,
        bindingsCount: Object.keys(nextBindingsMap).length,
        defaultScopeKeys: parseDefaultScopeKeys(nextConfigRaw),
      });
    } catch (loadError) {
      setError(`加载 Agent 模块失败: ${String(loadError)}`);
      agentLogger.error("加载智能体中心失败", loadError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const persistAgents = useCallback(async (nextAgents: VisualAgent[]) => {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const normalizedAgents = normalizeVisualAgents(nextAgents);
      const payload = buildAgentsPayload(normalizedAgents);

      await invoke<string>("save_agents_list", {
        agentsList: payload,
      });
      setMessage(`已保存 ${normalizedAgents.length} 个 Agent 变更`);
      agentLogger.info("已持久化 AgentCenter 变更", {
        agentsCount: normalizedAgents.length,
      });
    } catch (saveError) {
      setError(`保存 Agent 变更失败: ${String(saveError)}`);
      agentLogger.error("保存 Agent 变更失败", saveError);
      throw saveError;
    } finally {
      setSaving(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const dataState: AgentCenterDataState = {
    loading,
    refreshing,
    saving,
    error,
    message,
    warnings,
    agents,
    baselineAgents,
    bindingsMap,
    gatewaySummary,
    defaultScopeKeys,
  };

  const dataActions: AgentCenterDataActions = {
    setError,
    setMessage,
    setAgents,
    setBaselineAgents,
    reload,
    persistAgents,
  };

  return { dataState, dataActions };
}

export { createInitialDataState };
