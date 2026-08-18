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
- **重命名自动更新引用**(v0.11.4):文件/文件夹重命名时全库 `[[旧名]]` → `[[新名]]`,
  基于增量链接索引(Rust `rename_with_links`),反链已去重
- **模板系统 + 每日笔记**(v0.11.4):可配模板文件夹(默认 `Templates`)、插入模板对话框、
  打开今日笔记(自动套用 `Daily.md` 模板)
- **斜杠命令**(v0.11.4):`/` 弹出 19 种 markdown 构件
- **聚焦模式**(v0.11.4):当前行高亮 + 打字机式居中
- **导出**(v0.11.4):HTML(自包含,KaTeX/高亮/图片 base64 内联)、纯 Markdown、PDF(系统打印对话框)

### 对齐语雀 / 通用编辑器
- 文档树:嵌套、拖拽排序/移动、右键菜单(新建/重命名/删除→回收站)、隐藏 dotfiles
- 自动保存(1s 防抖)、外部变更冲突对话框、外部删除文件对话框(v0.11.3)
- 超大文件(>5MB)打开前警告(v0.11.3)
- 主题 ×11、字体 ×5、中英双语、快捷键、最近文件、字数统计、YAML frontmatter 预览卡片

## 待实现功能(按优先级)

### 🔴 高优先级
- [ ] **属性面板编辑(Properties)**
  - 现状:预览模式已把 YAML frontmatter 渲染成卡片,但编辑模式无可视化编辑
  - 方案:新建属性编辑弹窗(标题/标签/日期/自定义键值),读写文档头部 YAML;
    或参考 Obsidian 右侧 Properties 面板,CM6 内嵌
- [ ] **粘贴 URL 自动转 markdown 链接**
  - 剪贴板内容是纯 URL 时,粘贴自动变成 `[text](url)`(或 `[url](url)`)
  - 方案:CM6 `handlePaste` 拦截 + 解析剪贴板文本

### 🟡 中优先级
- [ ] **代码块复制按钮 + 行号**
  - 预览中的代码块右上角加"复制"按钮;可选行号
- [ ] **目录 TOC 插入**
  - 命令面板/斜杠命令插入基于大纲的目录列表
  - 方案:复用大纲 hook 生成 `- [标题](#锚点)` 列表
- [ ] **最近关闭标签页**
  - uiStore 记录关闭的 tab,菜单/快捷键恢复

### 🔴 大工程(单独评估,工作量大的功能)
- [ ] **Canvas 无限画布**(Obsidian Canvas)
- [ ] **发布 / 多端同步**(Obsidian Publish/Sync,需要服务端)
- [ ] **文档即容器 index.md**(语雀核心:文件夹可绑定一个 index 笔记,打开文件夹显示其内容)
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
