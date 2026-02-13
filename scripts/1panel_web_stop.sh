#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/openclaw-manager}"
PID_FILE="${OPENCLAW_WEB_PID_FILE:-$PROJECT_DIR/run/web-server.pid}"

if [[ ! -f "$PID_FILE" ]]; then
  echo "[INFO] 未找到 PID 文件，服务可能未启动: $PID_FILE"
  exit 0
fi

PID="$(cat "$PID_FILE" || true)"
if [[ -z "$PID" ]]; then
  echo "[WARN] PID 文件为空，删除后退出"
  rm -f "$PID_FILE"
  exit 0
fi

if kill -0 "$PID" >/dev/null 2>&1; then
  kill "$PID" >/dev/null 2>&1 || true
  sleep 1
  if kill -0 "$PID" >/dev/null 2>&1; then
    kill -9 "$PID" >/dev/null 2>&1 || true
  fi
  echo "[INFO] 已停止 web-server，PID=$PID"
else
  echo "[INFO] 进程不存在，清理 PID 文件: PID=$PID"
fi

rm -f "$PID_FILE"
