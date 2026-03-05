# AGENTS.md

## 项目名称

OpenClaw Manager — 🦞 高性能跨平台 AI 助手配置与服务管理工具

## 概述

OpenClaw Manager 是一款高性能的跨平台 AI 助手管理工具，提供图形化界面用于配置和管理 AI 助手服务。它支持实时服务状态监控、灵活的 AI 提供商配置以及多渠道即时通讯集成。应用前端采用现代 Web 技术栈（React + TypeScript + TailwindCSS），后端使用 Rust 构建，通过 Tauri 2.0 框架实现跨平台原生应用封装，兼具高性能与低资源占用。

本项目旨在简化多个 AI 模型的管理及其与各类通讯平台的集成，帮助用户轻松部署和控制 AI 助手服务。同时支持桌面端（Tauri）和 Web 端两种部署模式。

## 技术栈

- **语言/运行时**
  - Rust（后端 / 系统层）
  - TypeScript / JavaScript（前端）
- **框架**
  - Tauri 2.0 — 跨平台桌面应用框架
  - React 18 — 用户界面
  - Vite 6 — 前端构建工具
- **核心依赖**
  - `@tauri-apps/api`、`@tauri-apps/plugin-shell`、`@tauri-apps/plugin-fs`、`@tauri-apps/plugin-process`、`@tauri-apps/plugin-notification` — Tauri 插件
  - `zustand` — 轻量级状态管理
  - `tailwindcss` — 原子化 CSS 框架
  - `framer-motion` — 流畅动画
  - `lucide-react` — 图标库
  - `clsx` — 条件类名拼接
  - `serde`、`serde_json`、`tokio`、`chrono`、`thiserror` — Rust 后端核心库
- **构建工具**
  - `npm` / `pnpm`
  - `Vite`
  - `Tauri CLI`
  - `Cargo`（Rust 构建系统）

## 项目结构

```
openclaw-manager/
├── src-tauri/                 # Rust 后端 & Tauri 配置
│   ├── src/
│   │   ├── main.rs            # Tauri 应用入口
│   │   ├── web_server.rs      # Web 服务器入口（独立二进制）
│   │   ├── commands/          # Tauri Commands
│   │   │   ├── service.rs     # 服务管理
│   │   │   ├── config.rs      # 配置管理
│   │   │   ├── process.rs     # 进程管理
│   │   │   └── diagnostics.rs # 诊断功能
│   │   ├── models/            # 数据模型
│   │   └── utils/             # 工具函数
│   ├── Cargo.toml             # Rust 依赖清单
│   └── tauri.conf.json        # Tauri 应用配置
│
├── src/                       # React 前端
│   ├── App.tsx                # 主组件
│   ├── components/
│   │   ├── Layout/            # 布局组件（侧边栏、头部等）
│   │   ├── Dashboard/         # 仪表盘
│   │   ├── AgentCenter/       # Agent 管理中心
│   │   ├── AIConfig/          # AI 配置（Provider / Model）
│   │   ├── Channels/          # 消息渠道配置
│   │   ├── Service/           # 服务管理
│   │   ├── Testing/           # 测试诊断
│   │   ├── Settings/          # 应用设置
│   │   └── shared/            # 共享组件（ConfigChangePreviewDialog 等）
│   └── styles/
│       └── globals.css        # 全局样式
│
├── scripts/                   # 部署脚本（1panel 等）
├── docs/                      # 项目文档（初始化说明、开发规范、Web 部署说明）
├── pic/                       # 界面截图
├── package.json               # 前端依赖 & 脚本
├── vite.config.ts             # Vite 配置
├── tailwind.config.js         # TailwindCSS 配置
├── tsconfig.json              # TypeScript 配置
├── tsconfig.node.json         # Node.js 环境 TS 配置
└── README.md                  # 项目说明文档
```

## 核心功能

- **📊 仪表盘**：实时监控服务状态（端口、进程 ID、内存、运行时间），一键启动/停止/重启，实时日志查看。
- **🤖 AI 配置**：支持 14+ AI 提供商（Anthropic、OpenAI、DeepSeek、Moonshot、Gemini 等），自定义 API 端点，一键切换主模型。
- **📱 消息渠道**：集成 Telegram、Discord、Slack、飞书、微信、iMessage、钉钉、WhatsApp 等通讯平台。
- **⚡ 服务管理**：后台服务控制、实时日志、开机自启。
- **🧪 测试诊断**：系统环境检查、AI 连接测试、渠道连通性测试。
- **🌐 跨平台**：支持 macOS、Windows、Linux。
- **🎨 暗色主题 UI**：毛玻璃效果、流畅动画、响应式设计。

## 快速开始

### 环境要求

- **Node.js** >= 18.0
- **Rust** >= 1.70
- **pnpm**（推荐）或 npm
- macOS：`xcode-select --install`
- Windows：Microsoft C++ Build Tools + WebView2
- Linux（Ubuntu/Debian）：`sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`

### 安装

```bash
# 克隆项目
git clone https://github.com/miaoxworld/openclaw-manager.git
cd openclaw-manager

# 安装前端依赖
npm install
```

### 使用

```bash
# 桌面应用 - 开发模式（热重载）
npm run tauri:dev

# 桌面应用 - 构建发布版本
npm run tauri:build

# Web 模式 - 一体化构建与启动
npm run web:build
bash scripts/1panel_web_start.sh
```

## 开发

### 可用脚本

| 脚本           | 命令                                                      | 说明                           |
| -------------- | --------------------------------------------------------- | ------------------------------ |
| `dev`          | `vite`                                                    | 启动前端开发服务器             |
| `build`        | `tsc && vite build`                                       | 构建前端（类型检查 + 打包）    |
| `preview`      | `vite preview`                                            | 本地预览生产构建               |
| `tauri:dev`    | `tauri dev`                                               | Tauri 开发模式运行（含热重载） |
| `tauri:build`  | `tauri build`                                             | 构建跨平台桌面应用             |
| `web:backend`  | `cargo run --bin web-server`                              | 运行 Rust Web 服务器后端       |
| `web:frontend` | `vite`                                                    | 运行前端开发服务器             |
| `web:build`    | `npm run build && cargo build --release --bin web-server` | 构建前端 + Rust Web 服务器     |
| `web:serve`    | 构建并启动完整 Web 应用                                   | 全流程构建与服务启动           |

### 开发流程

1. 安装依赖：`npm install`
2. 启动开发：`npm run tauri:dev`（完整应用）或 `npm run dev`（仅前端）
3. 修改代码：前端（React/TS/Tailwind）或后端（Rust）
4. Rust 检查：`cd src-tauri && cargo check`
5. Rust 测试：`cd src-tauri && cargo test`
6. 构建发布：`npm run tauri:build`

## 配置

- **Tauri 配置** (`src-tauri/tauri.conf.json`)：应用元数据、窗口设置（1200×800，最小 900×600）、打包目标、图标、安全策略（CSP、Shell 命令白名单、文件访问白名单）。
- **Vite 配置** (`vite.config.ts`)：开发服务器端口 1420、API 代理（`/api` → `http://127.0.0.1:17890`）、路径别名（`@/` → `src/`）、环境变量前缀（`VITE_`、`TAURI_ENV_`）。
- **TailwindCSS 配置** (`tailwind.config.js`)：自定义品牌色（`claw` 龙虾红系列）、暗色主题背景色、强调色、自定义字体、动画与关键帧。
- **TypeScript 配置** (`tsconfig.json`)：目标 ES2020、严格模式、路径别名 `@/*`。
- **环境变量**：应用读取 `~/.openclaw/env` 中的环境变量配置。

## 架构

本项目采用混合架构，支持 **Tauri 桌面模式** 和 **Web 部署模式** 两种运行方式。

> ⚠️ **重要：当前主要开发和使用场景为 Web 模式。** 所有功能变更必须确保 Web 模式可用。

- **前端层**：基于 React 18 的单页应用，使用 TailwindCSS 样式化，Zustand 管理状态，Framer Motion 实现动画。通过 Tauri Commands 与后端通信。
- **后端层**：Rust 应用，由 Tauri 框架管理，负责系统级操作（文件系统访问、进程管理、Shell 命令执行）。同时提供独立的 Web 服务器二进制（`web-server`），支持 Web 部署模式。
- **通信方式**：
  - **Tauri 桌面模式**：前端通过 `@tauri-apps/api` 调用 Rust 端注册的 Tauri Commands（`main.rs` → `tauri::generate_handler![]`）
  - **Web 模式**：前端通过 HTTP API（`/api/invoke`）通信，由 `web_server.rs` → `dispatch_command()` 分发到相同的 Rust 后端函数

### 双入口命令分发（⚠️ 开发关键）

**Tauri 模式和 Web 模式有两套独立的命令注册/分发机制：**

| 模式       | 入口文件                      | 注册方式                        | 调用方式                            |
| ---------- | ----------------------------- | ------------------------------- | ----------------------------------- |
| Tauri 桌面 | `src-tauri/src/main.rs`       | `tauri::generate_handler![...]` | `tauriInvoke(cmd, args)`            |
| Web 部署   | `src-tauri/src/web_server.rs` | `dispatch_command()` match 分支 | `fetch('/api/invoke', {cmd, args})` |

**前端通过 `src/lib/invoke.ts` 的 `invokeCommand()` 自动选择调用方式**（检测 `__TAURI_INTERNALS__` 环境变量）。

> ⚠️ **新增 Rust 命令时，必须同时在 `main.rs` 和 `web_server.rs` 中注册！** 只在 `main.rs` 注册会导致 Web 模式报 "未知命令" 错误。这是最常见的遗漏。

### 构建产物

| 模式     | 构建命令              | 产物                                    |
| -------- | --------------------- | --------------------------------------- |
| Web 部署 | `npm run web:build`   | 前端 `dist/` + Rust `web-server` 二进制 |
| macOS    | `npm run tauri:build` | `.dmg`, `.app`                          |
| Windows  | `npm run tauri:build` | `.msi`, `.exe`                          |
| Linux    | `npm run tauri:build` | `.deb`, `.AppImage`                     |

## 贡献指南

1. Fork 项目
2. 创建功能分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'Add amazing feature'`
4. 推送到分支：`git push origin feature/amazing-feature`
5. 创建 Pull Request

## 许可证

MIT License — 详见 [LICENSE](LICENSE) 文件。
