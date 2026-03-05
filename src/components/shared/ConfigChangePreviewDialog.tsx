import { useState, useCallback } from "react";
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  X,
  Save,
  FileWarning,
} from "lucide-react";
import { invokeCommand } from "../../lib/invoke";

// ─── Shared Type Definitions (canonical source) ───────────────────────────

export interface ConfigValidationIssue {
  path: string;
  message: string;
  variable?: string;
}

export interface ConfigValidationResult {
  valid: boolean;
  issues: ConfigValidationIssue[];
}

export interface ConfigDiffItem {
  kind: "added" | "modified" | "removed";
  path: string;
  before?: unknown;
  after?: unknown;
  masked: boolean;
}

export interface ConfigDiffSummary {
  added: number;
  modified: number;
  removed: number;
  changes: ConfigDiffItem[];
}

export interface StagedPreviewResponse {
  staging_id: string;
  diff_summary: ConfigDiffSummary;
  validation: ConfigValidationResult;
}

export interface ApplyConfigResponse {
  backup_path: string;
  applied_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const MAX_DIFF_DISPLAY = 200;

function formatValuePreview(value: unknown): string {
  if (value === undefined || value === null) return "(空)";
  if (typeof value === "string") {
    return value.length > 60 ? value.slice(0, 57) + "..." : value;
  }
  if (typeof value === "object") {
    try {
      const str = JSON.stringify(value);
      return str.length > 60 ? str.slice(0, 57) + "..." : str;
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function formatValidationIssue(issue: ConfigValidationIssue): string {
  if (issue.variable) {
    return `${issue.path}：${issue.message}（${issue.variable}）`;
  }
  return `${issue.path}：${issue.message}`;
}

const KIND_STYLES: Record<string, string> = {
  added: "text-green-400",
  modified: "text-cyan-300",
  removed: "text-red-400",
};

const KIND_LABELS: Record<string, string> = {
  added: "新增",
  modified: "修改",
  removed: "删除",
};

// ─── Component ────────────────────────────────────────────────────────────

export interface ConfigChangePreviewDialogProps {
  open: boolean;
  preview: StagedPreviewResponse;
  title?: string;
  onApply?: () => Promise<ApplyConfigResponse>;
  onApplied: (result: ApplyConfigResponse) => void;
  onCancelled: () => void;
}

export function ConfigChangePreviewDialog({
  open,
  preview,
  title = "配置变更预览",
  onApply,
  onApplied,
  onCancelled,
}: ConfigChangePreviewDialogProps) {
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { diff_summary, validation } = preview;
  const hasChanges = diff_summary.changes.length > 0;
  const canApply = validation.valid && hasChanges;

  const handleApply = useCallback(async () => {
    setError(null);
    setApplying(true);
    try {
      const result = onApply
        ? await onApply()
        : await invokeCommand<ApplyConfigResponse>("apply_staged_config", {
            stagingId: preview.staging_id,
          });
      onApplied(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }, [preview.staging_id, onApply, onApplied]);

  const handleCancel = useCallback(async () => {
    try {
      await invokeCommand<string>("discard_staged_config", {
        stagingId: preview.staging_id,
      });
    } catch {
      // Ignore discard errors — best effort cleanup
    }
    onCancelled();
  }, [preview.staging_id, onCancelled]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
    >
      <div className="bg-dark-800 border border-dark-500 rounded-2xl p-6 max-w-xl w-full max-h-[80vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Save size={18} className="text-blue-400" />
            {title}
          </h2>
          <button
            onClick={handleCancel}
            className="text-gray-400 hover:text-white transition-colors"
            disabled={applying}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-auto space-y-4 min-h-0">
          {/* Diff summary */}
          <div className="text-sm text-gray-300">
            预览差异：
            <span className="text-green-400">新增 {diff_summary.added}</span>，
            <span className="text-cyan-300">修改 {diff_summary.modified}</span>
            ，<span className="text-red-400">删除 {diff_summary.removed}</span>
          </div>

          {/* Validation status */}
          <div className="text-sm flex items-center gap-1.5">
            {validation.valid ? (
              <>
                <CheckCircle size={15} className="text-green-400" />
                <span className="text-green-400">校验通过</span>
              </>
            ) : (
              <>
                <AlertTriangle size={15} className="text-amber-400" />
                <span className="text-amber-400">
                  校验失败（{validation.issues.length} 项）
                </span>
              </>
            )}
          </div>

          {/* Validation issues */}
          {!validation.valid && validation.issues.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-900/20 p-3 space-y-1">
              {validation.issues.map((issue, idx) => (
                <div
                  key={`issue-${idx}`}
                  className="text-xs text-amber-300 flex items-start gap-1.5"
                >
                  <FileWarning size={13} className="mt-0.5 shrink-0" />
                  <span>{formatValidationIssue(issue)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Diff items */}
          {hasChanges ? (
            <div className="max-h-64 overflow-auto rounded-lg border border-dark-500 p-2 bg-dark-700/60 space-y-1">
              {diff_summary.changes
                .slice(0, MAX_DIFF_DISPLAY)
                .map((item, idx) => (
                  <div key={`${item.path}-${idx}`} className="text-xs">
                    <span className={KIND_STYLES[item.kind] ?? "text-gray-400"}>
                      [{KIND_LABELS[item.kind] ?? item.kind}]
                    </span>{" "}
                    <span className="text-gray-300">{item.path}</span>
                    <span className="text-gray-500"> | </span>
                    <span className="text-gray-400">
                      {formatValuePreview(item.before)} →{" "}
                      {formatValuePreview(item.after)}
                    </span>
                    {item.masked && (
                      <span className="text-amber-300">（敏感字段已掩码）</span>
                    )}
                  </div>
                ))}
              {diff_summary.changes.length > MAX_DIFF_DISPLAY && (
                <div className="text-xs text-gray-500 pt-1">
                  … 还有 {diff_summary.changes.length - MAX_DIFF_DISPLAY}{" "}
                  项未显示
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-gray-500 text-center py-4">
              无配置差异
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-900/20 p-3 text-xs text-red-300 flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>应用失败：{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t border-dark-500">
          <button
            className="btn-secondary px-4 py-2 text-sm"
            onClick={handleCancel}
            disabled={applying}
          >
            取消
          </button>
          <button
            className="btn-primary px-4 py-2 text-sm flex items-center gap-2"
            onClick={handleApply}
            disabled={!canApply || applying}
          >
            {applying ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Save size={15} />
            )}
            确认应用
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfigChangePreviewDialog;
