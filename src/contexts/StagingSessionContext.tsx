import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { invokeCommand } from "../lib/invoke";
import type {
  StagedPreviewResponse,
  ApplyConfigResponse,
  ConfigDiffSummary,
} from "../components/shared/ConfigChangePreviewDialog";

// 后端返回类型
interface StagingChangeResult {
  session_id: string;
  change_count: number;
  change_labels: string[];
  instant_diff_summary: ConfigDiffSummary | null;
}

interface StagingSessionStatus {
  active: boolean;
  session_id: string | null;
  change_count: number;
  change_labels: string[];
  created_at: string | null;
  updated_at: string | null;
}

// Context 状态
interface StagingSessionState {
  active: boolean;
  sessionId: string | null;
  changeCount: number;
  changeLabels: string[];
  updatedAt: string | null;
  previewOpen: boolean;
  previewData: StagedPreviewResponse | null;
  applying: boolean;
  discarding: boolean;
}

// Context 操作
interface StagingSessionActions {
  applyChange: (
    operation: string,
    args: Record<string, unknown>,
    label: string
  ) => Promise<StagingChangeResult>;
  openPreview: () => Promise<void>;
  closePreview: () => void;
  applySession: () => Promise<ApplyConfigResponse>;
  discardSession: () => Promise<void>;
  refreshStatus: () => Promise<void>;
}

export type StagingSessionContextType = StagingSessionState &
  StagingSessionActions;

const StagingSessionContext = createContext<StagingSessionContextType | null>(
  null
);

export function useStagingSession(): StagingSessionContextType {
  const ctx = useContext(StagingSessionContext);
  if (!ctx)
    throw new Error(
      "useStagingSession must be used within StagingSessionProvider"
    );
  return ctx;
}

export function StagingSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StagingSessionState>({
    active: false,
    sessionId: null,
    changeCount: 0,
    changeLabels: [],
    updatedAt: null,
    previewOpen: false,
    previewData: null,
    applying: false,
    discarding: false,
  });
  const refreshInFlightRef = useRef(false);

  // 启动时恢复 session 状态，并定期与后端状态对齐
  const refreshStatus = useCallback(async () => {
    if (refreshInFlightRef.current) {
      return;
    }

    refreshInFlightRef.current = true;
    try {
      const status = await invokeCommand<StagingSessionStatus>(
        "staging_session_status"
      );
      setState((prev) => ({
        ...prev,
        active: status.active,
        sessionId: status.session_id,
        changeCount: status.change_count,
        changeLabels: status.change_labels,
        updatedAt: status.updated_at,
      }));
    } catch (e) {
      console.error("获取 staging session 状态失败:", e);
    } finally {
      refreshInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void refreshStatus();

    const intervalId = setInterval(() => {
      void refreshStatus();
    }, 1500);

    return () => {
      clearInterval(intervalId);
    };
  }, [refreshStatus]);

  const applyChange = useCallback(
    async (operation: string, args: Record<string, unknown>, label: string) => {
      const result = await invokeCommand<StagingChangeResult>(
        "staging_session_apply_change",
        { operation, args, label }
      );
      setState((prev) => ({
        ...prev,
        active: true,
        sessionId: result.session_id,
        changeCount: result.change_count,
        changeLabels: result.change_labels,
        updatedAt: new Date().toISOString(),
      }));
      return result;
    },
    []
  );

  const openPreview = useCallback(async () => {
    const preview = await invokeCommand<StagedPreviewResponse>(
      "staging_session_preview"
    );
    setState((prev) => ({ ...prev, previewOpen: true, previewData: preview }));
  }, []);

  const closePreview = useCallback(() => {
    setState((prev) => ({ ...prev, previewOpen: false, previewData: null }));
  }, []);

  const applySession = useCallback(async () => {
    setState((prev) => ({ ...prev, applying: true }));
    try {
      const result = await invokeCommand<ApplyConfigResponse>(
        "staging_session_apply"
      );
      setState({
        active: false,
        sessionId: null,
        changeCount: 0,
        changeLabels: [],
        updatedAt: null,
        previewOpen: false,
        previewData: null,
        applying: false,
        discarding: false,
      });
      return result;
    } catch (e) {
      setState((prev) => ({ ...prev, applying: false }));
      throw e;
    }
  }, []);

  const discardSession = useCallback(async () => {
    setState((prev) => ({ ...prev, discarding: true }));
    try {
      await invokeCommand<string>("staging_session_discard");
      setState({
        active: false,
        sessionId: null,
        changeCount: 0,
        changeLabels: [],
        updatedAt: null,
        previewOpen: false,
        previewData: null,
        applying: false,
        discarding: false,
      });
    } catch (e) {
      setState((prev) => ({ ...prev, discarding: false }));
      throw e;
    }
  }, []);

  const contextValue: StagingSessionContextType = {
    ...state,
    applyChange,
    openPreview,
    closePreview,
    applySession,
    discardSession,
    refreshStatus,
  };

  return (
    <StagingSessionContext.Provider value={contextValue}>
      {children}
    </StagingSessionContext.Provider>
  );
}
