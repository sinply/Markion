# Markion

一款基于 **Tauri 2** 的本地 Markdown 编辑器——Obsidian 式实时预览 + 语雀式多级文档树。

![MIT License](https://img.shields.io/badge/license-MIT-green)
![Tauri 2](https://img.shields.io/badge/Tauri-2-blue)
![Rust](https://img.shields.io/badge/Rust-1.97-orange)
![React 18](https://img.shields.io/badge/React-18-61dafb)

## 特性

- **实时预览（Live Preview）**：Obsidian 风格——输入即渲染，`**粗体**`、`# 标题`、表格、代码块、任务列表、引用实时显示，Markdown 标记自动隐藏，光标移入显现。可在设置中开关。
- **多级文档树**：左侧文件树按文件夹层级缩进展示，支持折叠/展开、拖拽排序、跨目录移动。
- **大纲面板**：右侧实时显示当前文档的标题树，点击跳转到对应章节。
- **GFM 支持**：表格、任务列表、删除线、代码块语法高亮（GitHub 风格配色）。
- **本地优先**：直接读写磁盘上的 `.md` 文件，可配合任意文件同步工具。
- **快速轻量**：CodeMirror 6 编辑器内核，Tauri 2 后端，小体积低内存。

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | [Tauri 2](https://tauri.app)（Rust 后端） |
| 编辑器 | [CodeMirror 6](https://codemirror.net) + @lezer/markdown + markdown-it + lowlight |
| UI | React 18 + react-arborist + react-resizable-panels + Zustand |
| 测试 | vitest + jsdom（前端）、Rust 单元测试（后端） |

## 环境要求

- **Node.js** ≥ 20
- **Rust** 稳定工具链（rustup）
- **Windows**：MSVC C++ Build Tools 或 LLVM `lld-link`（见下方说明）
- **macOS/Linux**：Xcode Command Line Tools / build-essential

> Windows 下若未安装 VS Build Tools，可用 LLVM 的 `lld-link` 作为链接器：
> 项目已自带 `src-tauri/.cargo/config.toml`（`linker = "lld-link"`），需 `lld-link` 在 PATH 中（如 `C:\Program Files\LLVM\bin`）。

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式（热重载，打开桌面窗口）
npm run tauri dev

# 仅启动前端（浏览器里看 UI，无 Tauri 功能）
npm run dev
```

## 构建与测试

```bash
# TypeScript 类型检查
npx tsc --noEmit

# 前端单元测试
npx vitest run

# Rust 后端检查 + 测试
cd src-tauri
cargo check
cargo test

# 构建可执行文件（产物在 src-tauri/target/release/）
npm run tauri build
```

## 项目结构

```
Markion/
├── src/                  # 前端 (React + TS)
│   ├── components/       # UI 组件（Layout/FileTree/EditorPane/Outline...）
│   ├── editor/           # CodeMirror 6 编辑器内核
│   │   ├── livePreview.ts    # 实时预览装饰（标题/粗体/表格/代码块/任务）
│   │   ├── widgets.ts        # 块级 widget（代码块/表格/任务勾选）
│   │   └── markdown.ts       # markdown-it + lowlight 渲染
│   ├── stores/           # Zustand 状态（vaultStore/docStore/settingsStore）
│   └── lib/              # IPC 封装 + 类型
├── src-tauri/            # Rust 后端 (Tauri)
│   ├── src/
│   │   ├── file_io.rs    # 原子读写
│   │   ├── tree_index.rs # 文档树（FS + 索引混合模型）
│   │   ├── image.rs      # 图片哈希/去重/路径
│   │   ├── watcher.rs    # 文件监听
│   │   └── commands.rs   # Tauri 命令
│   └── .cargo/config.toml # lld-link 配置（可选）
├── docs/superpowers/     # 设计规格与实施计划
└── CLAUDE.md             # Claude Code 开发指引
```

## 文档树模型

文件系统是**唯一事实来源**（source of truth），`.markion/index.json` 仅记录文件夹的自定义排序与折叠状态：

- 同文件夹内拖拽重排 → 只更新索引
- 跨文件夹移动 → 移动真实文件 + 更新索引
- 外部删除/改名 → 索引自动清理，不阻塞

## 路线图

- [x] 实时预览（标题/粗体/斜体/行内代码/链接/表格/任务列表/代码块/引用）
- [x] 多级文件树 + 拖拽
- [x] 大纲面板 + 点击跳转
- [x] 图片粘贴/拖拽（后端 `save_image` 已就绪，UI 待接入）
- [ ] 图片粘贴 UI 接入
- [ ] 外部文件变更监听（watcher 已就绪，事件接线待接入）
- [ ] 数学公式（KaTeX）、Mermaid 图表
- [ ] 设置持久化（`.markion/config.json`）
- [ ] `index.md` 作为层级容器正文
- [ ] 双向链接 / 反链面板

## 许可

MIT
