# Markion 编辑器设计规格

- **日期**：2026-07-31
- **状态**：设计待审阅
- **作者**：与用户协作（brainstorming）

## 1. 目标与范围

构建一个桌面端 Markdown 编辑器，定位介于 Typora 与 Obsidian 之间：

- Obsidian 式实时预览（源码与渲染同区，块级元素实时渲染，源码始终可见可编辑）
- 语雀风格的多级嵌套文档树（左栏）
- Obsidian 式可移植性（磁盘上是真实 `.md` 文件，能用其他编辑器打开）
- 打开本地文件夹作为工作区（vault），读写本地 markdown 文件
- 不卡顿、快、实时渲染

### v1 范围

- GFM 扩展：表格、任务列表、删除线、代码块语法高亮
- 图片粘贴/拖拽，落盘到可配置的 assets 目录，相对/绝对路径可配置
- 文档树：文件 + 索引混合模型，同文件夹拖拽重排、跨文件夹移动
- 外部文件变更监听与冲突处理（简单二选一）

### v1 不做（后期再加）

- `index.md` 作为层级容器正文（文档同时是容器）
- 数学公式（KaTeX）、Mermaid 图表
- 双向链接 / 反链面板
- 完整命令面板（v1 只做 `Ctrl+P` 快速打开文件）
- 外部变更对比视图（v1 只做"保留我的 / 加载磁盘"二选一）
- 数学/图表等扩展

## 2. 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 应用壳 | Tauri 2 | 小包体、低内存、原生性能；Rust 后端管文件系统 |
| 编辑器内核 | CodeMirror 6 + @lezer/markdown | Obsidian 同款；装饰 API 天生为实时预览设计；自带视口虚拟化 |
| Markdown 渲染 | markdown-it + markdown-it-gfm + markdown-it-task-lists | 快、插件多；Obsidian 同款 |
| 代码高亮 | lowlight（highlight.js） | 在代码块 widget 内高亮 |
| UI 框架 | React | 生态复利（react-arborist / react-resizable-panels / Radix）；编辑器性能不受影响 |
| 状态管理 | Zustand | 轻量，避免 Redux 样板 |
| 后端语言 | Rust | Tauri 2 原生；文件 I/O、监听、图片处理 |

**解析器长远策略**：v1 用 markdown-it + Lezer 树。未来需要 AST 能力（重命名标题改锚链、lint、导出转换、喂 AI）时，再加 remark 作为独立依赖按需调用，不影响实时预览热路径。这是增量依赖，不是重写。

## 3. 整体架构

### 3.1 进程模型

- **Rust 后端**（`src-tauri/`）：所有文件系统操作。Webview 无直接磁盘访问，全部走 Tauri command。
- **前端 Webview**（`src/`）：React + CodeMirror 6。UI 壳用 React，编辑器是 CM6 自管 DOM，包在 React 组件里通过 ref 挂载。

### 3.2 前端分层

| 层 | 职责 | 选型 |
|---|---|---|
| UI 壳 | 文件树、三栏布局、命令面板、设置 | React + react-resizable-panels + react-arborist |
| 编辑器 | 实时预览、编辑、装饰 | CodeMirror 6 + @lezer/markdown |
| 渲染 | 块级元素转 HTML | markdown-it |
| 状态 | 打开文档列表、活动文档、树状态 | Zustand |
| IPC | 调 Rust、接收 FS 事件 | Tauri invoke + event listen |

### 3.3 后端模块（Rust）

- `file_io`：原子写（写临时文件再 rename，防崩溃损坏）
- `watcher`：`notify` crate 监听 vault 目录变化，事件推给前端（防抖合并 ~200ms）
- `tree_index`：读写 `.markion/index.json`，与 FS 扫描结果合并（FS 是真相，索引补排序/折叠等元信息）
- `image`：粘贴图片落盘到 assets 目录，返回相对/绝对路径

### 3.4 Vault 概念

用户"打开文件夹"= 选定一个根目录作为工作区。该目录下生成 `.markion/` 存 `index.json` 和应用配置。多 vault 切换由前端状态管理。

### 3.5 关键约束

**文件系统是 source of truth，索引只存元信息。** FS 与索引冲突时以 FS 为准（文件被外部删除/改名时，索引自动清理对应条目）。

## 4. 编辑器核心：CM6 实时预览管线

源码始终是单一真相，渲染只是装饰（decoration），不替换文本。

### 4.1 更新管线（每次按键）

1. 用户输入 -> CM6 更新文档 state -> Lezer 增量解析生成语法树（已内置增量，只重算变化区间）
2. `ViewPlugin` 订阅更新，遍历语法树，按节点类型产出 `Decoration`：
   - **行内元素**（`**粗体**`、`` `code` ``、链接）：`Decoration.mark` 给标记符加样式（隐藏 `**` 或降淡），内容正常渲染
   - **块级元素**（表格、代码块、任务列表）：`Decoration.replace` 把源码替换为渲染后的 HTML widget（`WidgetType`）
3. CM6 把装饰应用到 DOM，只重绘受影响区间（视口内）

### 4.2 性能保障

- 装饰只算视口可见区间 + 少量缓冲（CM6 viewport 机制），超长文档不全量算
- markdown-it 仅在需要生成块级 HTML 时调用（单个表格/代码块），不是整篇重渲染
- 防抖：行内装饰即时，块级 widget 渲染（代码高亮）微任务延后

### 4.3 块级渲染分工

- 代码高亮：`@codemirror/lang-markdown` 代码块 + lowlight 在 widget 内高亮
- 表格：markdown-it 渲染成 `<table>` HTML，塞进 widget
- 任务列表：`- [ ]` / `- [x]` 用 widget 渲染成可勾选 checkbox，勾选时回写源码（替换 `[ ]` -> `[x]`）

### 4.4 编辑器与 React 的边界

CM6 实例由 React 组件通过 `useRef` 持有，props 变化（主题切换）通过 `Compartment` 重配，不重挂载。文档内容、光标、选区都在 CM6 state 内，不进 React 状态，避免 React 重渲染影响编辑器性能。

## 5. 文档树与文件读写

### 5.1 索引文件格式（`.markion/index.json`）

```json
{
  "version": 1,
  "folders": {
    "":       { "order": ["intro.md", "notes", "drafts.md"], "collapsed": false },
    "notes":  { "order": ["a.md", "b.md"], "collapsed": true }
  }
}
```

key 是相对 vault 根的文件夹路径（`""` = 根），`order` 是该层子项的显示顺序，`collapsed` 是折叠状态。树结构本身来自 FS，索引只补排序和折叠态。

### 5.2 合并逻辑（FS 扫描 + 索引）

1. Rust 扫描 FS，拿到每层实际子项
2. 读索引 `order`，过滤掉已不存在的（外部删除）
3. FS 新增的（索引里没有）按字母序追加到末尾
4. 结果 = FS 结构 + 索引排序

FS 永远是真相。

### 5.3 拖拽两种语义

- **同文件夹内重排**：只改索引 `order`，不动文件。原子写 `index.json`。
- **跨文件夹移动**：Rust 真实 `rename` 文件，两个文件夹的 `order` 同步更新。

### 5.4 打开流程

点树节点 -> 前端调 Rust `read_file(path)` -> 返回内容 -> 建 CM6 Doc，标记 clean。

### 5.5 保存流程（自动保存）

防抖（按键后 ~1s）+ 失焦 + 关闭时触发 -> Rust 原子写（`path.tmp` 再 rename）-> 标记 clean。UI 显示未保存小圆点。

### 5.6 外部变更监听

Rust `notify` crate 递归监听 vault。事件分两类：

- **已打开文件被外部改**：clean -> 静默重载；dirty -> 弹"保留我的编辑 / 加载磁盘版本"
- **树结构变**（外部新建/删除/改名）：推事件给前端，重跑合并刷新树

### 5.7 隐藏项

`.markion/` 始终隐藏；`assets/` 和点文件可配置是否显示。

## 6. UI 布局、状态管理与图片处理

### 6.1 三栏布局

`react-resizable-panels`，可拖拽调宽，可折叠。

```
┌─────────────┬──────────────────────────┬────────────┐
│ Vault 切换   │  标签栏 [intro.md] [a.md] │  大纲      │
│ 📁 notes    ├──────────────────────────┤  • H1      │
│  📄 intro   │                          │    • H2    │
│  📁 drafts  │   CodeMirror 6 编辑器     │  • H1      │
│  📄 a.md    │   (实时预览)              │    • H2    │
│             ├──────────────────────────┤    • H3    │
│             │  状态栏: 字数 ●未保存      │            │
└─────────────┴──────────────────────────┴────────────┘
```

- **左**：vault 切换器 + 文件树（react-arborist，拖拽重排/移动、右键新建/重命名/删除）
- **中**：多标签栏（点不同文件保持打开，切回不丢光标和滚动位置）+ CM6 编辑器 + 状态栏
- **右**：大纲面板（当前文档标题树，点击跳转，随编辑实时更新）。v1 只放大纲，结构留扩展位以后加反链等

### 6.2 状态管理（Zustand）

| store | 内容 |
|---|---|
| `vaultStore` | 当前 vault 根路径、合并后的树数据、展开状态 |
| `docStore` | 打开文档列表、活动文档 id、各文档 dirty 状态 |
| `settingsStore` | assets 目录策略、路径风格、主题、隐藏文件开关 |
| CM6 编辑器 state | 存在 CM6 内部，按 doc id 做 Map 缓存--切标签不重建，光标/选区/滚动都保留 |

### 6.3 图片处理

1. 粘贴/拖入图片 -> 前端拦截 -> 调 Rust `save_image(buf, doc_path)`
2. Rust 按 `settingsStore.assetsDir` 决定目标目录：
   - `vault-assets`（默认）-> `<vault>/assets/`
   - `doc-assets` -> `<docdir>/assets/`
   - `custom` -> 设置里指定路径
3. 文件名：`YYYYMMDD-<hash前6位>.png`，hash 用于去重--相同内容已存在则复用路径不重复落盘
4. 按 `settingsStore.pathStyle` 返回路径：
   - `relative`（默认）：相对**文档文件所在目录**（标准 markdown 约定，例：doc 在 `<vault>/notes/a.md`、图在 `<vault>/assets/x.png` -> 引用为 `../assets/x.png`）
   - `absolute`：绝对路径
5. 前端在光标处插入 `![](path)`

### 6.4 快捷打开

`Ctrl+P` 快速文件名搜索打开。完整命令面板后期加。

## 7. 错误处理

核心原则：**永远不让用户丢内容**。

| 场景 | 处理 |
|---|---|
| 文件读写失败（权限/磁盘满） | toast 提示，文档保持 dirty 不丢内容 |
| 原子写失败 | 回滚，保持 dirty，提示重试 |
| `index.json` 损坏 | 降级为纯 FS 扫描重建树，记录日志，不阻塞用户 |
| 外部删除已打开文件 | clean -> 关标签并提示；dirty -> 弹"另存为" |
| 文件监听事件抖动 | Rust 端防抖合并（~200ms），去重同路径事件 |
| 图片落盘失败 | toast 提示，不插入坏链接 |
| 打开超大文件（>5MB） | 打开前警告确认 |

## 8. 测试策略

### 8.1 Rust 后端（重点测，逻辑密集）

- `tree_index` 合并逻辑：FS 扫描 ∩ 索引、新增追加、删除清理的各种组合（单元测试）
- `file_io` 原子写：写入中模拟失败不产生半截文件
- `image` 去重：相同内容复用、不同内容新建
- 集成测试用 tempdir 造真实目录结构跑全流程

### 8.2 前端

- CM6 装饰：对一组 markdown 输入做装饰输出快照测试（表格/任务/代码块/行内格式）
- markdown-it GFM 渲染：单元测试覆盖表格、任务、删除线、代码高亮
- Zustand store：状态转移单元测试

### 8.3 E2E

v1 只做关键流程冒烟（开 vault、编辑保存、图片粘贴、外部改文件重载），用 Tauri 的测试支持，不铺重型 E2E。

### 8.4 UI 正确性

手动检查清单（布局/主题/拖拽手感这类需要人眼验证的）。

### 8.5 测试优先级

`tree_index` 合并 > 装饰输出 > 文件读写原子性 > 其他。这几个错了会丢用户数据或渲染错乱，优先覆盖。

## 9. 项目结构

```
Markion/
├── src/                      # 前端
│   ├── components/           # React 组件（FileTree, Editor, Outline, Tabs...）
│   ├── editor/               # CM6 封装（ViewPlugin, decorations, widgets）
│   ├── stores/               # Zustand stores
│   ├── lib/                  # markdown-it 配置、IPC 封装
│   └── App.tsx
├── src-tauri/                # Rust 后端
│   └── src/
│       ├── file_io.rs
│       ├── watcher.rs
│       ├── tree_index.rs
│       ├── image.rs
│       └── commands.rs       # Tauri command 注册
├── docs/superpowers/specs/   # 本规格
└── package.json
```

## 10. 关键决策记录

1. **Tauri 2 而非 Electron**：用户愿学少量 Rust，换小包体低内存。
2. **CodeMirror 6 而非 ProseMirror**：Obsidian 式实时预览（非 Typora 式纯 WYSIWYG），CM6 装饰 API 是为这设计的。
3. **React 而非 SolidJS**：编辑器性能与 UI 框架无关（CM6 自管 DOM），React 生态（react-arborist/react-resizable-panels）长远复利。
4. **markdown-it 现在用，remark 以后按需加**：实时预览要快，AST 能力增量补，不重写。
5. **文件 + 索引混合模型**：FS 是真相保可移植，索引补排序/折叠满足语雀式体验。
6. **同文件夹拖拽只动索引，跨文件夹才动文件**：重排是无损的元信息变更，移动才是文件操作。
