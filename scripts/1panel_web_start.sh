#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/openclaw-manager}"
WEB_HOST="${OPENCLAW_WEB_HOST:-0.0.0.0}"
WEB_PORT="${OPENCLAW_WEB_PORT:-17890}"
WEB_STATIC_DIR="${OPENCLAW_WEB_STATIC_DIR:-$PROJECT_DIR/dist}"
COOKIE_SECURE="${OPENCLAW_WEB_COOKIE_SECURE:-false}"
HOME_DIR="${HOME:-/root}"
FORCE_BUILD="${FORCE_BUILD:-0}"
LOG_FILE="${OPENCLAW_WEB_LOG_FILE:-$PROJECT_DIR/logs/web-server.log}"
PID_FILE="${OPENCLAW_WEB_PID_FILE:-$PROJECT_DIR/run/web-server.pid}"
DAEMON_MODE=1

show_help() {
  cat <<'EOF'
Usage: 1panel_web_start.sh [options]

Options:
  -f, --no-daemon  前台运行（不守护），直接打印日志
  -h, --help       显示帮助

Environment:
  PROJECT_DIR               项目目录（默认 /home/openclaw-manager）
  OPENCLAW_WEB_HOST         监听地址（默认 0.0.0.0）
  OPENCLAW_WEB_PORT         监听端口（默认 17890）
  OPENCLAW_WEB_STATIC_DIR   前端静态目录（默认 $PROJECT_DIR/dist）
  OPENCLAW_WEB_COOKIE_SECURE Cookie Secure（默认 false）
  OPENCLAW_WEB_LOG_FILE     守护模式日志文件（默认 $PROJECT_DIR/logs/web-server.log）
  OPENCLAW_WEB_PID_FILE     守护模式 PID 文件（默认 $PROJECT_DIR/run/web-server.pid）
  FORCE_BUILD               置为 1 时强制构建
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--no-daemon)
      DAEMON_MODE=0
      shift
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      echo "[ERROR] 未知参数: $1" >&2
      show_help
      exit 1
      ;;
  esac
done

needs_build=0
if [[ "$FORCE_BUILD" == "1" ]]; then
  needs_build=1
elif [[ ! -f "$PROJECT_DIR/src-tauri/target/release/web-server" ]] || [[ ! -f "$PROJECT_DIR/dist/index.html" ]]; then
  needs_build=1
fi

cd "$PROJECT_DIR"

if [[ "$needs_build" == "1" ]]; then
  if ! command -v cargo >/dev/null 2>&1; then
    echo "[ERROR] 需要构建，但 cargo 不在 PATH。请先安装 Rust，或先在宿主机完成构建。" >&2
    exit 1
  fi

  if ! command -v npm >/dev/null 2>&1; then
    echo "[ERROR] 需要构建，但 npm 不在 PATH。" >&2
    exit 1
  fi

  npm ci
  npm run build
  cd src-tauri
  cargo build --release --bin web-server
  cd ..
fi

if [[ ! -f "$PROJECT_DIR/src-tauri/target/release/web-server" ]]; then
  echo "[ERROR] 启动失败：未找到二进制 $PROJECT_DIR/src-tauri/target/release/web-server" >&2
  exit 1
fi

if [[ ! -f "$WEB_STATIC_DIR/index.html" ]]; then
  echo "[ERROR] 启动失败：未找到前端静态文件 $WEB_STATIC_DIR/index.html" >&2
  exit 1
fi

export OPENCLAW_WEB_HOST="$WEB_HOST"
export OPENCLAW_WEB_PORT="$WEB_PORT"
export OPENCLAW_WEB_STATIC_DIR="$WEB_STATIC_DIR"
export OPENCLAW_WEB_COOKIE_SECURE="$COOKIE_SECURE"
export HOME="$HOME_DIR"

BIN_PATH="$PROJECT_DIR/src-tauri/target/release/web-server"

if [[ "$DAEMON_MODE" == "0" ]]; then
  echo "[INFO] 前台启动: $BIN_PATH"
  exec "$BIN_PATH"
fi

mkdir -p "$(dirname "$LOG_FILE")" "$(dirname "$PID_FILE")"

if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE" || true)"
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" >/dev/null 2>&1; then
    echo "[INFO] web-server 已在运行，PID=$OLD_PID"
    echo "[INFO] 日志文件: $LOG_FILE"
    exit 0
  fi
fi

nohup "$BIN_PATH" >> "$LOG_FILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" > "$PID_FILE"

sleep 1
if kill -0 "$NEW_PID" >/dev/null 2>&1; then
  echo "[INFO] web-server 已守护启动，PID=$NEW_PID"
  echo "[INFO] 日志文件: $LOG_FILE"
  exit 0
fi

echo "[ERROR] web-server 启动失败，请检查日志: $LOG_FILE" >&2
tail -n 50 "$LOG_FILE" || true
exit 1
