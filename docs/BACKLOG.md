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

## 待实现功能(按优先级;2026-08-18 审计更新,v0.11.5/0.11.6 已完成 🔴 高优先级全部 + 🟡 + 🟢)

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

### 🟡 中优先级(全部已完成,v0.11.6)
- [x] **代码块复制按钮 + 行号**(v0.11.6)
  - 编辑/预览模式代码块右上角复制按钮;编辑模式代码块左侧行号
- [x] **目录 TOC 插入**(v0.11.6)
  - 命令面板 "Insert Table of Contents":按标题层级生成 `- [[doc#标题]]`
    列表(点击可锚点跳转,斜杠命令除外)
- [x] **编辑器内右键菜单**(v0.11.6)
  - `domEventHandlers.contextmenu` + ContextMenu:剪切/复制/粘贴/全选
    (cut/copy/paste 走浏览器剪贴板)
- [x] **标签页拖拽重排**(v0.11.6)
  - HTML5 拖拽重排 `docStore.openDocs`(reorderDocs)
- [x] **快捷键自定义**(v0.11.6)
  - config.rs `shortcuts: HashMap` + `src/lib/shortcuts.ts`(默认绑定表)+
    ShortcutsDialog 可编辑(修改/重置);useCommands 表驱动 keydown
- [x] **侧栏/面板折叠 + 状态记忆**(v0.11.6)
  - Layout 左右折叠按钮(«/»),折叠态 localStorage 持久化
- [x] **图片点击放大预览**(v0.11.6)
  - 编辑/预览模式点击图片开 lightbox(`openLightbox`,Esc/点击关闭)
- [x] **拖拽非图片文件到编辑器插入链接**(v0.11.6)
  - `.md` 拖入插 `[[wikilink]]`,其他文件插 `[name](name)`
- [x] **全屏 / 禅模式**(v0.11.6)
  - 命令面板 "Toggle Fullscreen"(Tauri `setFullscreen`)
- [x] **最近关闭标签页**(v0.11.6)
  - uiStore `recentlyClosed` 栈(10 条)+ Ctrl+Shift+T / 命令恢复
- [x] **workspaces / 布局记忆**(v0.11.6)
  - Group `defaultLayout` + `onLayoutChanged` 存 localStorage(面板尺寸跨会话)

### 🟢 低优先级(全部已完成,v0.11.6)
- [x] **应用内回收站**:删除移入 vault 内 `.markion/trash/`(保留相对路径,
  重名加后缀),右键菜单"最近删除"打开 TrashDialog 恢复(Rust
  trash_path/list_trash/restore_trash)
- [x] **wiki 补全保留原始大小写**:索引额外存原始 stem,`MyNote.md` 补全为
  `MyNote`(匹配仍大小写不敏感)
- [x] **大纲面板拖拽移动标题**:拖拽标题块(含子内容)到目标后,两次 dispatch
  写回文档(`moveHeadingBlock`)
- [x] **表格对齐/格式化命令**:命令面板 "Format Table" 重排光标所在表格
  (parse+serialize)
- [x] **PDF 直接导出免打印对话框**:html2canvas 渲染 + jsPDF 分页,保存对话框
  直接写 PDF 文件(Rust `write_file_base64`);原打印对话框流程保留在
  `exportActivePdf`
- [x] **导出为图片**:html2canvas 渲染笔记为 PNG 保存

### 🔴 大工程(单独评估,工作量大的功能)
- [ ] **Canvas 无限画布**(Obsidian Canvas)
- [ ] **发布 / 多端同步**(Obsidian Publish/Sync,需要服务端)
- [ ] **文档即容器 index.md**(语雀核心):已有雏形--单击含 index.md 的文件夹
  打开它、双击展开;v0.11.6 加了右键"创建 index 文档"入口(自动创建并打开);
  仍缺容器 UI(正文下方列子文档)与展开联动
- [ ] **多知识库管理**(v0.11.6 已完成基础版):文件菜单"知识库…"列出最近
  vault(最近 8 个,localStorage),点击切换(树/设置/监视器重建、关闭旧标签);
  缺应用内多 vault 并存视图
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
