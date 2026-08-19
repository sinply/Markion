# Markion Feature Backlog

功能差距清单:以 Obsidian / 语雀 / Typora 为参照,对比 Markion 现状得出的
**已实现** 与 **待实现** 功能记录。新会话先读此文件再动手,避免重复实现。

## 已实现功能(勿重复做)

### 对齐 Obsidian 的核心功能
- 实时预览(光标行源码 + 其余渲染)、编辑/预览双模式
- wikilink:`[[target]]` 渲染、点击跳转、未解析创建、输入补全、`![[note#heading]]` 嵌入
- Callouts(`> [!type]` 卡片)
- 关系图谱(可点击跳转)、大纲、反链面板
- 标签面板(点击筛选出所有带该标签的笔记)、全文搜索 + 正则替换
- 命令面板、heading 折叠、KaTeX 公式、Mermaid(含别名,gantt 等)、GFM 表格/任务列表/删除线
- 190+ 语言代码高亮(lowlight)
- **重命名自动更新引用**(v0.11.4):文件/文件夹重命名时全库 `[[旧名]]` -> `[[新名]]`,
  基于增量链接索引(Rust `rename_with_links`),反链已去重
- **模板系统 + 每日笔记**(v0.11.4):可配模板文件夹(默认 `Templates`)、插入模板对话框、
  打开今日笔记(自动套用 `Daily.md` 模板)
- **斜杠命令**(v0.11.4):`/` 弹出 19 种 markdown 构件
- **聚焦模式**(v0.11.4):当前行高亮 + 打字机式居中
- **导出**(v0.11.4):HTML(自包含,KaTeX/高亮/图片 base64 内联)、纯 Markdown、PDF(系统打印对话框)

### 对齐语雀 / 通用编辑器
- 文档树:嵌套、拖拽排序/移动、右键菜单(新建/重命名/删除->回收站)、隐藏 dotfiles
- 自动保存(1s 防抖)、外部变更冲突对话框、外部删除文件对话框(v0.11.3)
- 超大文件(>5MB)打开前警告(v0.11.3)
- 主题 ×11、字体 ×5、中英双语、快捷键、最近文件、字数统计、YAML frontmatter 预览卡片
- **图片粘贴/拖拽插入**(审计补记):`media.ts::imagePasteDropExtension` + `saveImage`,
  自动存 assets、`assets_strategy`/`path_style` 可配
- **编辑器内查找替换**(审计补记):Ctrl+F / Ctrl+H(CM6 `searchKeymap` 内置)
- **外部 URL 点击**(审计补记):`livePreview.ts` `openUrl` 调系统打开

## 待实现功能(按优先级;2026-08-18 审计更新,v0.11.5 已完成全部 🔴 高优先级)

### 🔴 高优先级(全部已完成,2026-08-18)
- [x] **属性面板编辑(Properties)**(v0.11.5)
  - 命令面板"编辑属性"打开弹窗:列出/增删 frontmatter 键值,保存写回
    CM6(可撤销 + 自动保存);`src/lib/frontmatter.ts` + `PropertiesDialog.tsx`
- [x] **`[[note#heading]]` 锚点解析 + 跳转**(v0.11.5,含 bug)
  - `resolveWikiLink` 剥离 `#heading`(不再误判未解析/误创建文件);Ctrl+点击
    `[[note#Sec]]` 打开后滚动到该标题(`openNote` 带 heading,复用 pendingJump)
- [x] **多光标 / 列选择**(v0.11.5)
  - `EditorState.allowMultipleSelections.of(true)` + `drawSelection()`;
    Alt+点击加光标,Shift+Alt+拖拽列选择
- [x] **脚注 `[^1]`、高亮 `==text==`、上下标**(v0.11.5)
  - markdown-it-footnote/mark/sup/sub 插件(预览);live preview `==text==`
    cm-mark 装饰
- [x] **粘贴 URL 自动转 markdown 链接**(v0.11.5)
  - 剪贴板纯 URL 时粘贴为 `[选中文本](url)` 或 `[url](url)`;
    `media.ts::urlFromClipboard`/`urlToMarkdown` + paste handler

### 🟡 中优先级
- [ ] **代码块复制按钮 + 行号**
  - 预览中的代码块右上角加"复制"按钮;可选行号
- [ ] **目录 TOC 插入**
  - 命令面板/斜杠命令插入基于大纲的目录列表(斜杠命令现有 19 项,无 TOC)
  - 方案:复用大纲 hook 生成 `- [标题](#锚点)` 列表
- [ ] **编辑器内右键菜单**(审计新增)
  - 现状:仅 FileTree 有 ContextMenu,编辑器右键无菜单(搜 `contextmenu` 零命中)
  - 方案:`codemirror.ts` 加 `domEventHandlers.contextmenu`,复用
    `ContextMenu.tsx`,接 cut/copy/paste 命令
- [ ] **标签页拖拽重排**(审计新增)
  - 现状:`Tabs.tsx` 无 draggable,只有切换/关闭
  - 方案:HTML5 拖拽重排 `docStore.openDocs`
- [ ] **快捷键自定义**(审计新增)
  - 现状:`ShortcutsDialog` 只读展示,键位硬编码在 `useCommands.ts`,config 无存储
  - 方案:config 加 keymap 映射,`keymap.of` 动态构建
- [ ] **侧栏/面板折叠 + 状态记忆**(审计新增)
  - 现状:三栏只能 resize 无折叠;面板宽度不跨会话记忆
  - 方案:Layout 加折叠 toggle,尺寸/折叠态写 settingsStore
- [ ] **图片点击放大预览**(审计新增)
  - 现状:ImageWidget 只渲染,无 lightbox
  - 方案:点击开覆盖层大图或调系统 opener
- [ ] **拖拽非图片文件到编辑器插入链接**(审计新增)
  - 现状:`media.ts` drop 仅 `filter(isImageFile)`,其他文件静默丢弃
  - 方案:drop 分支:非图片文件插入 `[name](path)`
- [ ] **全屏 / 禅模式**(审计新增)
  - 现状:只有聚焦模式(行高亮+打字机),无全屏
  - 方案:命令面板 toggle,调 Tauri `getCurrentWindow().setFullscreen()`
- [ ] **最近关闭标签页**
  - uiStore 记录关闭的 tab,菜单/快捷键恢复
- [ ] **workspaces / 布局记忆**(审计新增)
  - 现状:重启只恢复 recentFiles,打开标签、面板尺寸全部丢失
  - 方案:localStorage 存布局 JSON(面板尺寸+openDocs),启动恢复

### 🟢 低优先级(审计新增)
- [ ] **应用内回收站 / 文件历史版本**:现为系统回收站(`trash::delete`),
  可改 vault 内 `.markion/trash/` + "最近删除"面板;保存快照做版本历史
- [ ] **wiki 补全保留原始大小写**(半 bug):索引 stem 转小写,`MyNote.md`
  补全成 `mynote`;索引需额外保留原始 stem
- [ ] **大纲面板拖拽移动标题**:`Outline.tsx` 仅 onClick 跳转
- [ ] **表格对齐/格式化命令**:有 `detectAlign` 但无"格式化表格"命令
- [ ] **PDF 直接导出免打印对话框**:现为 `printHtml` 系统打印对话框,
  需引入 PDF 生成方案
- [ ] **导出为图片**:html2canvas 截渲染区

### 🔴 大工程(单独评估,工作量大的功能)
- [ ] **Canvas 无限画布**(Obsidian Canvas)
- [ ] **发布 / 多端同步**(Obsidian Publish/Sync,需要服务端)
- [ ] **文档即容器 index.md**(语雀核心):已有雏形--FileTree 双击含
  index.md 的文件夹会直接打开(v0.11.4 审计确认),缺容器 UI/创建入口/展开联动
- [ ] **多知识库管理**(语雀:一个应用管理多个 vault,可切换)
- [ ] **数据表 / 思维导图 / 幻灯片**(语雀特色,均是大工程)

### 🟢 明确不做(桌面本地工具不适配)
- 团队协作评论、@提及、关注订阅(需要账号体系)
- 白板实时协同

## 技术备忘(踩坑记录)

- **CM6 reconfigure 陷阱**:对 `createEditorState` 构建的 state,任何
  Compartment reconfigure 都会抛 "Config merge conflict for field override"
  (静态扩展含多个 config 载体)。动态开关用 **StateField + StateEffect +
  ViewPlugin** 模式(见 `src/editor/codemirror.ts` 聚焦模式实现),不要用
  Compartment reconfigure。
- **两个 `autocompletion()` 不能并存**:合并进一个 `autocompletion({ override:
  [sourceA, sourceB] })`(见 `editorCompletion`)。
- **typewriter 滚动不能在 update 阶段测量 DOM**:`coordsAtPos` 要 setTimeout 0
  延迟,jsdom 下用 try/catch 兜底。
- **vitest CSS import**:`?raw`/`?inline` 在测试里为空,需 `vi.mock`;真实
  vite build 会正确内联(已验证)。
- **重命名引用重写**(`src-tauri/src/link_index.rs::rewrite_links`):按行扫描
  `[[...]]`,跳过 ``` 围栏;匹配大小写不敏感,保留路径前缀与 `|alias`。
- **Rust config 字段**:前端 `Settings` 与 Rust `config.rs::Settings` 必须同步
  (曾漏掉 `show_tags` 导致读配置后被静默重置,已修)。
