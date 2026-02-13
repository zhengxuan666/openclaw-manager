# OpenClaw Manager Web 部署说明（单服务一体化）

本文档说明如何在 VPS / 1Panel 中用**一个后端进程**同时提供：

- 前端页面（静态资源）
- 后端 API（`/api/*`）

不需要额外启动前端 Node 服务。

## 1. 构建

在项目根目录执行：

```bash
npm ci
npm run web:build
```

构建产物：

- 前端：`dist/`
- 后端二进制：`src-tauri/target/release/web-server`

## 2. 启动方式（推荐脚本）

### 2.1 守护启动（默认）

```bash
bash scripts/1panel_web_start.sh
```

默认会：

- 后台守护启动 `web-server`
- 自动写入 PID 文件
- 自动写入日志文件

### 2.2 前台调试（打印日志）

```bash
bash scripts/1panel_web_start.sh --no-daemon
```

或：

```bash
bash scripts/1panel_web_start.sh -f
```

### 2.3 停止服务

```bash
bash scripts/1panel_web_stop.sh
```

## 3. 运行文件路径

默认路径如下：

- 日志文件：`/home/openclaw-manager/logs/web-server.log`
- PID 文件：`/home/openclaw-manager/run/web-server.pid`

## 4. 关键环境变量

- `PROJECT_DIR`：项目目录（默认 `/home/openclaw-manager`）
- `OPENCLAW_WEB_HOST`：监听地址（默认 `0.0.0.0`）
- `OPENCLAW_WEB_PORT`：监听端口（默认 `17890`）
- `OPENCLAW_WEB_STATIC_DIR`：前端静态目录（默认 `$PROJECT_DIR/dist`）
- `OPENCLAW_WEB_COOKIE_SECURE`：Cookie 是否加 `Secure`（HTTPS 建议 `true`）
- `OPENCLAW_WEB_LOG_FILE`：守护模式日志文件路径
- `OPENCLAW_WEB_PID_FILE`：守护模式 PID 文件路径
- `FORCE_BUILD`：置为 `1` 时强制构建

如果你需要管理 `root` 用户下的 OpenClaw 配置，建议设置：

- `HOME=/root`

## 5. 1Panel 推荐配置

创建一个运行环境进程即可：

- 源码目录：`/home/openclaw-manager`
- 启动命令：`bash /home/openclaw-manager/scripts/1panel_web_start.sh`
- 应用端口：`17890`

可选停止命令：

- `bash /home/openclaw-manager/scripts/1panel_web_stop.sh`

然后在 1Panel 网站中将域名反向代理到 `127.0.0.1:17890`（整站转发即可，不需要再单独配置前端静态目录）。

## 6. 健康检查与排障

### 健康检查

```bash
curl http://127.0.0.1:17890/api/health
```

### 查看日志

```bash
tail -f /home/openclaw-manager/logs/web-server.log
```

### 常见问题

- 提示 `cargo: not found`：说明当前运行环境没有 Rust，需在宿主机安装 Rust，或先在宿主机完成构建。
- 提示静态文件不存在：确认 `dist/index.html` 已生成（执行 `npm run web:build`）。

## 7. 首次登录

首次访问会进入管理员初始化页面：

1. 设置管理员用户名
2. 设置密码（至少 8 位）
3. 初始化完成后进入管理后台

认证配置文件：`~/.openclaw/manager-web-auth.json`
