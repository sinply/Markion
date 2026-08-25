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
- [x] **文档即容器 index.md**(v0.11.7 完整版):单击含 index.md 的文件夹打开
  它并自动展开该文件夹(展开联动);打开 index.md 时编辑器下方显示
  "本文件夹内容"列表(容器 UI,点击子笔记即打开);右键文件夹可
  创建/打开 index.md(创建入口)
- [x] **Canvas 无限画布**:用户明确不做(2026-08-19)
- [ ] **发布 / 多端同步**(Obsidian Publish/Sync,需要服务端,本地应用无法实现)
- [x] **多知识库管理**(v0.11.7 管理对话框):文件菜单"知识库…"快速切换 +
  "管理知识库…"对话框(列出最近 vault、打开/移除/设为默认);
  多 vault 并存单窗视图仍未做(架构上 vaultRoot 单一)
- [ ] **数据表 / 思维导图 / 幻灯片**:幻灯片已完成(v0.11.8);交互式导图未做
- [x] **Obsidian Base 风格数据库基础版**(v0.11.8):`.base` 文件定义字段 +
  数据源文件夹,以笔记为行(列值来自 frontmatter),表格视图 + 排序 + 筛选 +
  单元格编辑写回 frontmatter;命令面板 "Open Database…"
- [x] **语雀式体验重构**(v0.12.0):
  - **文档化显示层**:`src/lib/docTitle.ts`(docTitle/titleForPath)——全 UI
    不再出现 .md 扩展名;index.md 显示为所在文件夹名;FolderContainer 容器
    判定改用 path
  - **SQLite 只读投影**(架构决策:md 是唯一真相源,DB 只是可重建缓存,
    拒绝双向同步):`src-tauri/src/docdb.rs` + `.markion/cache.db`
    (documents/properties/tags 表),写入钩子(write/trash/delete/rename)+ 
    watcher 事件双向增量维护,损坏自愈(删库重建)
  - **知识库首页 LibraryHome**:启动无文档时自动显示;卡片网格(标题/
    摘要/相对时间/字数/标签)+ 搜索 + 文件夹筛选;菜单/命令可随时回到
  - **文件夹表格视图**:右键文件夹"以表格查看"→ 列=frontmatter 键并集
    自动推断类型(number/date/tags/text),排序/筛选/双击改单元格写回;
    共享 TableView 抽到 BaseTable.tsx(.base 与 folder table 共用)
  - **阅读排版语雀化**:正文限宽居中 48em、行高 1.75、标题阶梯、代码块
    卡片化、引用块着色、表格斑马纹

### 🟢 明确不做(桌面本地工具不适配)
- 团队协作评论、@提及、关注订阅(需要账号体系)
- 白板实时协同

## 已实现功能(v0.12.1 → v0.15.2 补记,2026-08-25)

### 体验与交互
- **语雀式单一视图定稿**(v0.12.x~v0.14.x):移除编辑/预览双模式与知识库首页;
  行内语法改为**节点粒度**渲染——光标在某个语法节点内才露源码,移开立即成型
  (Typora 式);装饰 StateField 每事务无条件重算(修复"### 残留到下一次点击")
- **专注模式重做**(v0.13.0,更名"聚焦"→"专注"):光标段落清晰+主题色侧条,
  其余可见行淡出至 30%,两侧面板自动收起/恢复;此前只是挂了个无样式类名
- **frontmatter 属性卡片**(v0.13.0/v0.14.1):打开即渲染 Obsidian 式 Properties
  卡片;`skipFrontmatterCursor` 让新开文档光标落在正文(否则永远看到裸 YAML);
  点击卡片区域露出可编辑 YAML;YAML `null` 值显示为空
- **Dataview 表格查询**(v0.15.0):```dataview 块执行 DQL(`table <列> AS "别名"
  / from "文件夹"(递归) / sort 字段 asc|desc`)渲染结果表,行点击打开笔记;
  后端 `query_dataview_rows`(递归+跳过隐藏+mtime/size);DQL 解析在
  `src/editor/dataview.ts`
- 导出子菜单、最近文件子菜单、每日笔记入口开关(设置)、隐藏 dotfiles 开关
- 启动零空白:index.html 内联纯 CSS splash 第一帧即显示,React 接管后移除
  (JS 包大——190 个 hljs 语法全量打包)

### 渲染正确性(v0.14.0 全语法审计 + 后续)
- ~~删除线~~此前从未实现(标记永久裸露);==高亮==的 == 标记不隐藏;
  ^上标^/~下标~ 缺 Lezer 扩展(Superscript/Subscript);--- 无渲染处理
  ——均已补齐并加用户可见级断言测试(inlineSyntaxRegression +
  fullSyntaxAudit:挂载真实视图检查最终 DOM 文本)
- 链接 URL 不再作为文字出现(光标敏感范围含整个节点含 URL 部分)
- SystemVerilog/sv/sv→verilog 别名(highlight.js Verilog 官方别名为空!)
- 编辑态围栏代码高亮:`markdown({ codeLanguages })` + @codemirror/language-data
  (~140 语言按需加载),别名归一表在 codemirror.ts

### 数据与持久化
- **设置持久化双端修复**(v0.13.0):前端 settingsStore.save 从未被调用(改动
  只在内存);Rust Settings 缺 serde(rename_all = camelCase)(read_config 返回
  snake_case 键被前端忽略)且缺 show_daily_note 字段——两头都断,已修并测试
- 保存/自动保存/导出的数据丢失修复 + 路径逃逸 + 解析器边界(v0.15.1,另一会话)
- frontmatter 文档标题/代码/表格消失、--- 误判、长文档 >100 行裸源码
  (scanBlocks 前 100 行 head 截断相关,v0.15.1 后续,另一会话)

## 技术备忘(踩坑记录)(续)

- **Tauri 返回值不会自动转 camelCase**:invoke 参数会(snake↔camel 自动),
  返回值走原生 serde——struct 必须显式 `#[serde(rename_all = "camelCase")]`,
  否则前端拿到 snake_case 键静默丢弃(config.rs 曾因此整条读配置链路失效)。
- **PowerShell 管道改写 UTF-8 源文件会写坏编码**(Set-Content 默认 GBK):
  改文件一律用文件编辑工具,不用 shell 内联替换。
- **RangeSetBuilder 排序/重叠冲突会炸掉整个装饰集**:块级 replace 装饰重叠
  (如 hr 与 frontmatter 双替换)表现为全部 live preview 失效裸奔;
  scanBlocks 对 frontmatter 先检测并隔离内部所有解析。
- **Lezer 没有 frontmatter 概念**:首尾 --- 会被解析为 HorizontalRule,
  自定义块扫描必须先于语法树处理排除。
- **vitest 并发 flaky 治理**:jsdom+CM6 在满负荷 worker 池下时序竞争,
  maxWorkers=2 + fileParallelism=false + timeout 20s 后连续全绿;
  测试断言要查"用户可见结果"(过滤 .cm-hidden 后的 textContent),
  jsdom 不做布局,opacity:0 元素仍在 textContent 里。
- **i18n 双语改名必须两边同步并有 MenuBar 渲染级回归测试**
  (menuBar.test.tsx),否则漏改的语言只有用户会发现。
- **版本 bump 四件套**(package.json / Cargo.toml / tauri.conf.json /
  AboutDialog):曾因替换模式笔误漏改两个文件导致构建产物版本错位;
  bump 后用 grep 校验四处一致。

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
