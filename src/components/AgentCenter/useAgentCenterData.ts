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
  parseModelProviderGroups,
  type VisualAgent,
} from "./index";

const agentLogger = createLogger("Agent");

const DEPENDENCY_ANALYSIS_WARNING_PREFIX = "保存前依赖分析：";
const BINDING_KEY_SEPARATOR = "::";

interface DependencyAnalysisIssue {
  section: "bindings";
  message: string;
}

function formatBindingKeyForDisplay(bindingKey: string): string {
  const separatorIndex = bindingKey.indexOf(BINDING_KEY_SEPARATOR);
  if (
    separatorIndex <= 0 ||
    separatorIndex >= bindingKey.length - BINDING_KEY_SEPARATOR.length
  ) {
    return bindingKey;
  }

  return `${bindingKey.slice(0, separatorIndex)}/${bindingKey.slice(
    separatorIndex + BINDING_KEY_SEPARATOR.length
  )}`;
}

function formatBindingSample(bindingKeys: string[]): string {
  if (bindingKeys.length === 0) {
    return "无";
  }

  const displayedKeys = bindingKeys.map((bindingKey) =>
    formatBindingKeyForDisplay(bindingKey)
  );
  const sample = displayedKeys.slice(0, 3).join("、");
  return displayedKeys.length > 3 ? `${sample} ...` : sample;
}

function analyzeBindingsDependencies(
  bindingsMap: Record<string, string>,
  nextAgentIds: Set<string>,
  removedAgentIds: Set<string>
): DependencyAnalysisIssue[] {
  const invalidBindings = Object.entries(bindingsMap).filter(
    ([, agentId]) => !nextAgentIds.has(agentId)
  );

  if (invalidBindings.length === 0) {
    return [];
  }

  const removedBindings = invalidBindings.filter(([, agentId]) =>
    removedAgentIds.has(agentId)
  );
  const staleBindings = invalidBindings.filter(
    ([, agentId]) => !removedAgentIds.has(agentId)
  );

  const issues: DependencyAnalysisIssue[] = [];

  if (removedBindings.length > 0) {
    const removedIds = Array.from(
      new Set(removedBindings.map(([, agentId]) => agentId))
    );
    issues.push({
      section: "bindings",
      message: `检测到 ${
        removedBindings.length
      } 条 bindings 仍引用本次删除的 Agent（${removedIds.join(
        "、"
      )}），示例：${formatBindingSample(
        removedBindings.map(([bindingKey]) => bindingKey)
      )}。请先在 Channels 解除引用后再应用。`,
    });
  }

  if (staleBindings.length > 0) {
    issues.push({
      section: "bindings",
      message: `检测到 ${
        staleBindings.length
      } 条 bindings 引用了当前草稿中不存在的 Agent，示例：${formatBindingSample(
        staleBindings.map(([bindingKey]) => bindingKey)
      )}。请先在 Channels 修复绑定或恢复对应 Agent。`,
    });
  }

  return issues;
}

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
  modelProviderGroups: [],
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
  const [modelProviderGroups, setModelProviderGroups] = useState<
    AgentCenterDataState["modelProviderGroups"]
  >([]);

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

      const configRecord =
        typeof nextConfigRaw === "object" && nextConfigRaw !== null
          ? (nextConfigRaw as Record<string, unknown>)
          : null;

      const modelsRecord =
        configRecord &&
        typeof configRecord.models === "object" &&
        configRecord.models !== null
          ? (configRecord.models as Record<string, unknown>)
          : null;

      const agentsRecord =
        configRecord &&
        typeof configRecord.agents === "object" &&
        configRecord.agents !== null
          ? (configRecord.agents as Record<string, unknown>)
          : null;

      const defaultsRecord =
        agentsRecord &&
        typeof agentsRecord.defaults === "object" &&
        agentsRecord.defaults !== null
          ? (agentsRecord.defaults as Record<string, unknown>)
          : null;

      const modelProviderGroups = parseModelProviderGroups(
        modelsRecord?.providers,
        defaultsRecord?.models
      );

      setAgents(cloneVisualAgents(nextAgents));
      setBaselineAgents(cloneVisualAgents(nextAgents));
      setBindingsMap(nextBindingsMap);
      setGatewaySummary(parseGatewaySummary(nextConfigRaw));
      setDefaultScopeKeys(parseDefaultScopeKeys(nextConfigRaw));
      setModelProviderGroups(modelProviderGroups);
      setWarnings(nextWarnings);
      setMessage(null);

      agentLogger.state("智能体中心摘要", {
        agentsCount: nextAgents.length,
        bindingsCount: Object.keys(nextBindingsMap).length,
        defaultScopeKeys: parseDefaultScopeKeys(nextConfigRaw),
        modelProviderGroups: modelProviderGroups.length,
      });
    } catch (loadError) {
      setError(`加载 Agent 模块失败: ${String(loadError)}`);
      agentLogger.error("加载智能体中心失败", loadError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const persistAgents = useCallback(
    async (nextAgents: VisualAgent[]) => {
      setSaving(true);
      setError(null);
      setMessage(null);

      try {
        const normalizedAgents = normalizeVisualAgents(nextAgents);
        const payload = buildAgentsPayload(normalizedAgents);

        const nextAgentIds = new Set(normalizedAgents.map((agent) => agent.id));
        const baselineAgentIds = new Set(
          baselineAgents.map((agent) => agent.id)
        );
        const removedAgentIds = new Set(
          Array.from(baselineAgentIds).filter(
            (agentId) => !nextAgentIds.has(agentId)
          )
        );

        let latestBindingsMap: Record<string, string> | null = null;
        const dependencyWarnings: string[] = [];

        try {
          const latestBindings = await invoke<BindingsPayload>("get_bindings");
          latestBindingsMap = parseBindings(latestBindings);
        } catch (bindingsError) {
          agentLogger.warn(
            "保存前依赖分析获取 bindings 失败，准备重试",
            bindingsError
          );

          try {
            const retryBindings = await invoke<BindingsPayload>("get_bindings");
            latestBindingsMap = parseBindings(retryBindings);
            agentLogger.info("保存前依赖分析获取 bindings 重试成功");
          } catch (retryError) {
            agentLogger.warn(
              "保存前依赖分析获取 bindings 重试失败",
              retryError
            );

            if (Object.keys(bindingsMap).length > 0) {
              latestBindingsMap = { ...bindingsMap };
              dependencyWarnings.push(
                `${DEPENDENCY_ANALYSIS_WARNING_PREFIX}获取 bindings 失败，已回退使用本地快照执行依赖检查`
              );
            } else {
              dependencyWarnings.push(
                `${DEPENDENCY_ANALYSIS_WARNING_PREFIX}获取 bindings 失败且无本地快照，已跳过 bindings 依赖检查`
              );
            }
          }
        }

        const dependencyIssues =
          latestBindingsMap === null
            ? []
            : analyzeBindingsDependencies(
                latestBindingsMap,
                nextAgentIds,
                removedAgentIds
              );

        setWarnings((current) => {
          const retainedWarnings = current.filter(
            (item) => !item.startsWith(DEPENDENCY_ANALYSIS_WARNING_PREFIX)
          );
          return dependencyWarnings.length > 0
            ? [...retainedWarnings, ...dependencyWarnings]
            : retainedWarnings;
        });

        if (dependencyIssues.length > 0) {
          const issueMessage = dependencyIssues
            .map((issue) => `[${issue.section}] ${issue.message}`)
            .join("；");
          throw new Error(`保存前依赖分析未通过：${issueMessage}`);
        }

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
    },
    [baselineAgents, bindingsMap]
  );

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
    modelProviderGroups,
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
