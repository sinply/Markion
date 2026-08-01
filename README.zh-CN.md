**[English](README.md) | [简体中文](README.zh-CN.md)**

# Markion

一款快速、**本地优先**的 Markdown 编辑器，支持 Windows、macOS、Linux。Obsidian 风格实时预览 + 语雀式多级文档树，数据直接以普通 `.md` 文件存于磁盘，可无缝配合你已有的任何同步工具。

![MIT License](https://img.shields.io/badge/license-MIT-green)
![Tauri 2](https://img.shields.io/badge/Shell-Tauri%202-blue)
![Rust](https://img.shields.io/badge/Rust-1.97-orange)
![React 18](https://img.shields.io/badge/UI-React%2018-61dafb)
![CodeMirror 6](https://img.shields.io/badge/Editor-CodeMirror%206-0f9d58)

> ⚡ 边写边渲染，语法标记自动隐藏——让 Markdown 像在纸上书写一样自然。你的笔记永远是你自己的普通文件。

![Markion 首次启动](assets/markion-screenshot.png)

---

## 特性

| | |
|---|---|
| 🪄 **实时预览（Live Preview）** | Obsidian 风格——输入即渲染，`**粗体**`、`# 标题`、表格、代码块、任务列表、引用实时显示，Markdown 标记自动隐藏，光标移入显现。可在设置中开关。 |
| 🌲 **多级文档树** | 语雀式文件树，按文件夹层级缩进展示，支持折叠/展开、拖拽排序、跨目录移动。 |
| 🧭 **大纲面板** | 右侧实时显示当前文档的标题树，点击标题即可跳转到对应章节。 |
| ✅ **GFM 支持** | 表格、任务列表、删除线、GitHub 风格配色的代码块语法高亮。 |
| 📁 **本地优先** | 直接读写磁盘上的 `.md` 文件，无私有数据库、无锁定——可配合 Dropbox、Syncthing 或任何同步工具使用。 |
| ⚡ **快速轻量** | CodeMirror 6 编辑器内核 + Rust（Tauri 2）后端，体积小、内存低、启动秒开。 |

---

## 快速开始

### 环境要求

- **Node.js** ≥ 20
- **Rust** 稳定工具链（`rustup`）
- **Windows**：MSVC C++ Build Tools（Visual Studio Build Tools 的 "使用 C++ 的桌面开发" 工作负载）
- **macOS/Linux**：Xcode Command Line Tools / `build-essential`

### 运行

```bash
# 安装依赖
npm install

# 开发模式（热重载，打开桌面窗口）
npm run tauri dev

# 仅启动前端（浏览器预览，默认 http://localhost:5173，无 Tauri 功能）
npm run dev
```

> Vite 开发服务器默认运行在 **5173** 端口。

### 构建与测试

```bash
npx tsc --noEmit         # TypeScript 类型检查
npx vitest run           # 前端单元测试

cd src-tauri
cargo check              # Rust 类型检查
cargo test               # Rust 单元测试

cd ..
npm run tauri build      # 生产构建 → src-tauri/target/release/
```

---

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | [Tauri 2](https://tauri.app) — Rust 后端 + WebView 前端 |
| 编辑器 | [CodeMirror 6](https://codemirror.net) + @lezer/markdown + markdown-it + lowlight |
| UI | React 18 + react-arborist + react-resizable-panels + Zustand |
| 后端 | Rust（serde、notify、sha2、pathdiff、walkdir） |
| 测试 | vitest + jsdom（前端）、`#[cfg(test)]` + tempfile（Rust） |

---

## 项目结构

```
Markion/
├── src/                      # 前端 (React + TypeScript)
│   ├── components/           # UI 组件（Layout / FileTree / EditorPane / Outline …）
│   ├── editor/               # CodeMirror 6 编辑器内核
│   │   ├── livePreview.ts    #   实时预览装饰（标题/粗体/表格/代码块/任务）
│   │   ├── widgets.ts        #   块级 widget（代码块/表格/任务勾选）
│   │   └── markdown.ts       #   markdown-it + lowlight 渲染
│   ├── stores/               # Zustand 状态（vaultStore / docStore / settingsStore）
│   └── lib/                  # IPC 封装 + 共享类型
├── src-tauri/                # Rust 后端 (Tauri)
│   ├── src/
│   │   ├── file_io.rs        #   原子读写
│   │   ├── tree_index.rs     #   文档树（FS + 索引混合模型）
│   │   ├── image.rs          #   图片哈希/去重/路径
│   │   ├── watcher.rs        #   文件监听
│   │   └── commands.rs       #   Tauri 命令
├── assets/                   # 截图与媒体
└── docs/superpowers/         # 设计规格与实施计划
```

## 文档树模型

文件系统是**唯一事实来源**（source of truth），`.markion/index.json` 仅记录文件夹的自定义排序与折叠状态：

- **同文件夹内拖拽重排** → 只更新索引
- **跨文件夹移动** → 移动真实文件 + 更新两个文件夹的索引
- **外部删除/改名** → 索引自动清理，不阻塞

---

## 路线图

**已完成**
- [x] 实时预览（标题/粗体/斜体/行内代码/链接/表格/任务列表/代码块/引用）
- [x] 多级文件树 + 拖拽
- [x] 大纲面板 + 点击跳转
- [x] 图片粘贴/拖拽后端（`save_image` 已就绪，UI 接入待完成）

**进行中**
- [ ] 图片粘贴 UI 接入
- [ ] 外部文件变更监听（后端已就绪，事件接线待完成）

**规划中**
- [ ] 数学公式（KaTeX）、Mermaid 图表
- [ ] 设置持久化（`.markion/config.json`）
- [ ] `index.md` 作为层级容器正文
- [ ] 双向链接 / 反链面板

---

## 许可

[MIT](LICENSE)
