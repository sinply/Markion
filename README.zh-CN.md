**[English](README.md) | [简体中文](README.zh-CN.md)**

# Markion

一款快速、**本地优先**的 **Windows** Markdown 编辑器。它融合 Obsidian 风格的实时预览与语雀式的多级文档树，所有笔记以普通 `.md` 文件存于磁盘——无私有数据库、无锁定，可轻松备份，并配合你已有的任意同步方式使用。macOS 与 Linux 版本规划中（应用基于跨平台的 Tauri 2 构建）。

![MIT License](https://img.shields.io/badge/license-MIT-green)
![Tauri 2](https://img.shields.io/badge/Shell-Tauri%202-blue)
![Rust](https://img.shields.io/badge/Rust-1.97-orange)
![React 18](https://img.shields.io/badge/UI-React%2018-61dafb)
![CodeMirror 6](https://img.shields.io/badge/Editor-CodeMirror%206-0f9d58)

> ⚡ 边写边渲染，语法标记自动隐藏——让 Markdown 像在纸上书写一样自然。你的笔记永远是你自己的普通文件。

![Markion 首次启动](assets/markion-screenshot.png)

---

## 特性

### ✍️ 写作与编辑

| | |
|---|---|
| 🪄 **实时预览（Live Preview）** | Obsidian 风格——输入即渲染，光标所在行显示 Markdown 源码以便直接编辑，其余行实时渲染。支持编辑 ⇄ 预览模式切换。 |
| 🖱️ **多光标 / 列选择** | Alt+点击添加光标，Shift+Alt+拖拽进行列选择。 |
| 🎯 **`[[note#heading]]` 锚点跳转** | 带 `#heading` 锚点的 wiki 链接正确解析，打开后自动滚动定位到对应标题。 |
| 🧘 **聚焦模式** | 当前行高亮 + 打字机式居中（Typora 风格）。 |
| 📑 **标题折叠** | 折叠槽 + 快捷键收起/展开章节。 |
| 🎛️ **编辑器右键菜单** | 右键即用：剪切 / 复制 / 粘贴 / 全选。 |

### 📄 Markdown 渲染

| | |
|---|---|
| ✅ **GFM + 扩展** | 表格、任务列表、删除线、脚注 `[^1]`、高亮 `==text==`、上标 `^x^` / 下标 `~x~`。 |
| 📊 **Mermaid 图表** | 完整图表支持：`mermaid`、`gantt`、`sequenceDiagram`、`flowchart`、`classDiagram`、`erDiagram`、`pie`、`journey`、`mindmap` 等；点击图可切回源码。 |
| 🧮 **KaTeX 公式** | 块级 `$$..$$` 与行内 `$..$`。 |
| 💬 **Callouts 标注** | `> [!note]` / `[!tip]` / `[!warning]` / … 共 16 种类型渲染为彩色卡片。 |
| 🎨 **代码高亮** | 190+ 语言（highlight.js）。 |
| 🔗 **粘贴 URL 转链接** | 粘贴纯 URL 自动变成 `[选中文本](url)`。 |

### 🗂️ 笔记与组织

| | |
|---|---|
| 🌲 **多级文档树** | 语雀式嵌套文件夹，拖拽排序/跨文件夹移动，右键菜单（新建/重命名/删除→回收站），隐藏 dotfiles。 |
| 🏷️ **标签系统** | 编辑器内可点击 `#tag` 高亮 + 标签面板按标签筛选笔记。 |
| 🧭 **大纲 / 反链 / 关系图谱** | 可切换右侧面板：实时大纲（可拖拽标题排序）、`[[wikilink]]` 反链、可缩放的关系图谱。 |
| 🏢 **多知识库** | 文件菜单切换最近打开的知识库。 |
| 🔤 **智能重命名** | 重命名文件/文件夹时全库重写 `[[wikilink]]` 引用。 |
| 📑 **标签页管理** | 拖拽标签页排序，恢复最近关闭的标签（Ctrl+Shift+T）。 |

### ⚙️ 效率工具

| | |
|---|---|
| ⌨️ **命令面板** | 所有操作可搜索（Ctrl+P）。 |
| ✨ **斜杠命令** | `/` 弹出 19 种 markdown 构件插入。 |
| 📝 **模板与每日笔记** | 可配置模板文件夹 + "打开今日笔记"（自动套用每日模板）。 |
| 🏷️ **属性面板** | YAML frontmatter 可视化编辑（标题/标签/日期/自定义键值）。 |
| 📋 **目录 TOC 插入** | 一键插入按标题层级生成的、可点击跳转的目录。 |
| 🔧 **快捷键自定义** | 偏好设置中任意重绑快捷键，按知识库存储、即时生效。 |
| 🔍 **查找与替换** | 编辑器内 Ctrl+F/H + 全库正则搜索与替换。 |
| 🗑️ **应用内回收站** | 删除的文件进入 `.markion/trash`，可从"最近删除"恢复。 |
| 🖱️ **表格操作** | 表格工具条增删行列 + "格式化表格"命令。 |

### 📤 导出

| | |
|---|---|
| 🌐 **HTML** | 自包含：内联 KaTeX/高亮样式，本地图片 base64 内联。 |
| 📄 **PDF** | 直接导出 PDF 文件（canvas 渲染），或走系统打印对话框。 |
| 🖼️ **PNG** | 将笔记导出为图片。 |
| 📄 **Markdown** | 原始源码导出。 |

### 🎨 外观与语言

| | |
|---|---|
| 🎨 **主题与字体** | 11 种主题（Light/Dark/Sepia/Eye-care/Nord/Dracula/Solarized/Tokyo/Catppuccin/Gruvbox/System）+ 5 种字体选择。 |
| 🌐 **双语界面** | 中文 / English UI，内置文档（F1）与快捷键速览。 |
| 📁 **本地优先** | 磁盘上的普通 `.md` 文件，无私有数据库。自动保存、外部变更检测、默认仓库自动打开。 |
| ⚡ **快速轻量** | CodeMirror 6 编辑器内核 + Rust（Tauri 2）后端，体积小、启动秒开。 |

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
│   ├── components/           # UI 组件（Layout / FileTree / EditorPane / Outline / Graph …）
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

## 许可

[MIT](LICENSE)
