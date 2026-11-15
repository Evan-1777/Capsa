# Tasks：Web 管理台 Material Design 3 重写与应用外壳解耦

**关联 Plan**：`Plan.md` —— Web 管理台 Material Design 3 重写与应用外壳解耦 v1.1  
**总计 Task**：8 个  
**状态**：DONE  
**完成日期**：2026-11-15  
**回归测试结论**：前端 `cd web && npm run build` 零错误通过；`go build -o bin/capsa ./cmd/capsa` 成功；`go test ./...` 全部通过且 `cmd/`、`internal/`、`tests/` 下 Go 源码零改动；Playwright `npm run test:e2e` 13/13 全绿（含新增的 MD3 主题亮暗切换与窄屏模态抽屉断点解锁断言）；旧令牌正则门禁（`acrylic|backdrop-blur|shadow-card|shadow-dialog|ease-fluent|Segoe UI|0078D4|--color-|bg-background|text-foreground|fill-foreground|text-muted|text-subtle|border-stroke|divide-stroke|bg-stroke|(bg|text|border|ring|accent)-brand|(bg|text|border|ring)-danger|\btext-(body|caption)(?![-a-z])`）在 `web/src/` 与 `web/tailwind.config.js` 上 0 匹配。  

<div style="border:1px solid #d4d4d8;border-radius:12px;padding:16px;margin:14px 0;background:#fafafa;color:#18181b;font-family:system-ui,-apple-system,sans-serif;font-size:12px;line-height:1.5">
  <div style="font-weight:600;color:#52525b;margin-bottom:10px">原子任务执行拓扑与落点矩阵</div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
    <div style="border:1px solid #6750A4;border-radius:8px;padding:10px;background:#ffffff">
      <div style="font-weight:700;color:#6750A4;margin-bottom:4px">Phase 1 · 设计基座</div>
      <div><strong>TASK-001</strong> (P0)<br><span style="color:#71717a;font-size:11px">MD3 令牌与 Tailwind 配置</span></div>
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid #f4f4f5"><strong>TASK-002</strong> (P0 · 依赖 001)<br><span style="color:#71717a;font-size:11px">精炼领域中立 UI 原语库</span></div>
    </div>
    <div style="border:1px solid #a1a1aa;border-radius:8px;padding:10px;background:#ffffff">
      <div style="font-weight:700;color:#3f3f46;margin-bottom:4px">Phase 2 · 外壳解耦</div>
      <div><strong>TASK-003</strong> (P0 · 依赖 002)<br><span style="color:#71717a;font-size:11px">单向受控 AppShell / TopBar / Nav / Login</span></div>
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid #f4f4f5"><strong>TASK-004</strong> (P0 · 依赖 003)<br><span style="color:#71717a;font-size:11px">App.tsx 守卫与 MemoryApp 状态机</span></div>
    </div>
    <div style="border:1px solid #a1a1aa;border-radius:8px;padding:10px;background:#ffffff">
      <div style="font-weight:700;color:#3f3f46;margin-bottom:4px">Phase 3 · 业务视图</div>
      <div><strong>TASK-005</strong> (P0 · 依赖 004)<br><span style="color:#71717a;font-size:11px">工作台、详情、Markdown 与侧边抽屉</span></div>
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid #f4f4f5"><strong>TASK-006</strong> (P0 · 依赖 005)<br><span style="color:#71717a;font-size:11px">其余四视图重写与旧令牌彻底清零</span></div>
    </div>
    <div style="border:1px solid #a1a1aa;border-radius:8px;padding:10px;background:#ffffff">
      <div style="font-weight:700;color:#3f3f46;margin-bottom:4px">Phase 4 · 回归与文档</div>
      <div><strong>TASK-007</strong> (P0 · 依赖 006)<br><span style="color:#71717a;font-size:11px">静态构建、Go 重编测试与 E2E 验收</span></div>
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid #f4f4f5"><strong>TASK-008</strong> (P1 · 依赖 007)<br><span style="color:#71717a;font-size:11px">文档同步与历史临时文件清理</span></div>
    </div>
  </div>
</div>

---

## Phase 1：MD3 语义令牌与领域中立基础原语重构

### TASK-001：建立 MD3 亮暗双模式 CSS 令牌体系与 Tailwind 映射配置

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：无
- **Executor**：主线
- **Description**：重写 `web/index.html`、`web/src/styles/index.css` 与 `web/tailwind.config.js`，建立完整的 Material Design 3 亮色与暗色（`data-theme="light" | "dark"`）CSS 变量体系、圆角阶梯、排版字阶与交互状态层，并保留带明确注释的过渡兼容别名至 `TASK-006` 收口删除，确保分步执行期间全站始终可编译且样式完好可运行。
- **Details**：
  - 在 `web/index.html` 首帧脚本中显式写入 `document.documentElement.dataset.theme = isDark ? "dark" : "light"`，保证首帧即挂载明确的 `light` 或 `dark` 属性。
  - 在 `web/src/styles/index.css` 中按 `:root, [data-theme="light"]`（含 `color-scheme: light;`）与 `[data-theme="dark"]`（含 `color-scheme: dark;`，确保原生 `<input type="date">` 与 `<select>` 暗色自适应反色）定义实际消费的 MD3 令牌（不预置零消费的 `tertiary-*`、`inverse-*`、`surface-dim/bright` 与 `elevation-1`）：
    - 色彩角色（统一以 `--md-sys-color-*` 为前缀）：`--md-sys-color-primary` / `on-primary` / `primary-container` / `on-primary-container`、`--md-sys-color-secondary` / `on-secondary` / `secondary-container` / `on-secondary-container`、`--md-sys-color-error` / `on-error` / `error-container` / `on-error-container`、`--md-sys-color-surface` / `on-surface` / `on-surface-variant`、五级容器 `--md-sys-color-surface-container-lowest` / `surface-container-low` / `surface-container` / `surface-container-high` / `surface-container-highest`、`--md-sys-color-outline` / `outline-variant`、`--md-sys-color-scrim`，以及协调扩展状态色 `--md-sys-color-warning` / `on-warning` / `warning-container` / `on-warning-container` 与 `--md-sys-color-success` / `on-success` / `success-container` / `on-success-container`。
    - 圆角阶梯（`--md-sys-shape-corner-*`）：`none` (0px)、`extra-small` (4px)、`small` (8px)、`medium` (12px)、`large` (16px)、`extra-large` (28px)、`full` (9999px)。
    - 排版字阶（`--md-sys-typescale-*`）与语义排版工具类：`text-headline-small` (24px/32px)、`text-title-large` (22px/28px)、`text-title-medium` (16px/24px/500)、`text-title-small` (14px/20px/500)、`text-body-large` (16px/24px)、`text-body-medium` (14px/20px)、`text-body-small` (12px/16px)、`text-label-large` (14px/20px/500)、`text-label-medium` (12px/16px/500)、`text-label-small` (11px/16px/500)，`body` 默认应用 `--md-sys-color-surface`、`--md-sys-color-on-surface` 与 `Roboto, "Noto Sans SC", "PingFang SC", system-ui, -apple-system, sans-serif` 字体栈。
    - 动效与悬浮按钮分离阴影：定义 `--md-sys-motion-easing-standard` (`cubic-bezier(0.2, 0, 0, 1)`)、`--md-sys-motion-easing-emphasized-decelerate` (`cubic-bezier(0.05, 0.7, 0.1, 1)`) 与 `--md-sys-elevation-3`（仅 Extended FAB 使用），保留 `prefers-reduced-motion` 无障碍降级规则。
    - 交互状态层辅助类 `.md-state-layer`：基于伪元素与 `currentColor` 提供 MD3 标准 8% hover / 12% active 状态层叠加。
  - 在 `web/tailwind.config.js` 中完整映射上述 `--md-sys-color-*`、`borderRadius`（`none/xs/sm/md/lg/xl/full`）、`boxShadow.elevation-3`、`transitionTimingFunction` 与 `fontFamily`。
  - 过渡期兼容块（在 `index.css` 与 `tailwind.config.js` 尾部以独立注释块隔离，于 `TASK-006` 完整删除）：将旧键名（`background`、`foreground`、`fill-foreground`、`muted`、`subtle`、`stroke`、`brand`、`danger`、`.text-body`、`.text-caption`）映射至对应 `--md-sys-*` 变量，使尚未迁移的视图在 `TASK-001`～`TASK-005` 期间不出现透明背景或字色丢失；立即删除 `acrylic`、`shadow-card`、`shadow-dialog`、`ease-fluent` 与 `Segoe UI`。
- **Acceptance Criteria**：
  - `:root, [data-theme="light"]` 与 `[data-theme="dark"]` 均含 `color-scheme` 声明、`--md-sys-color-*` 前缀的五级 `surface-container-*` 及全部核心色彩角色。
  - `web/src/styles/index.css` 与 `web/tailwind.config.js` 中已无 `acrylic`、`fluent`、`Segoe UI`、`0078D4`、`shadow-card`、`shadow-dialog`。
  - 执行 `cd web && npm run build` 编译通过，存量视图此时仍具备正常底色与可读文字。

### TASK-002：重写领域中立且无死分支的 MD3 基础 UI 原语组件库

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-001
- **Executor**：主线
- **Description**：重写 `web/src/components/ui/` 下的 `Button.tsx`、`Inputs.tsx`、`FormField.tsx`、`Card.tsx`、`Badge.tsx`、`Dialog.tsx`、`States.tsx` 及导出入口 `index.ts`，实现对齐 MD3 状态层与无障碍规范的精炼通用原语，并同步修正 `web/src/components/KeyManager.tsx` 中单处旧徽章变体名。
- **Details**：
  - `Button.tsx`：
    - `Button`：全圆角胶囊造型（`rounded-full`），支持变体 `primary`（Filled：`bg-primary text-on-primary`）、`tonal`（Filled Tonal：`bg-secondary-container text-on-secondary-container`）、`secondary`（Outlined：`border border-outline bg-transparent text-on-surface`）、`text`（Text：`bg-transparent text-primary`）、`danger`（Error Filled：`bg-error text-on-error`）、`warning`（Warning Container：`bg-warning-container text-on-warning-container`），尺寸 `sm` (32px 高) 与 `md` (40px 高)，接入 `.md-state-layer`、`focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`、`disabled:opacity-[0.38]` 与 `aria-busy`。
    - 新增导出 `IconButton`：40×40px 圆形按钮（`rounded-full`），仅定义实际使用的 `variant?: "standard" | "tonal"` 与切换态 `selected?: boolean`（当 `selected` 为真时应用 `bg-secondary-container text-on-secondary-container`，满足置顶切换等 Toggle IconButton 场景），透传 `aria-label` 与 `aria-pressed`。
  - `Inputs.tsx`（`Input`、`Textarea`、`Select`）：采用 MD3 Outlined Text Field 规范（`rounded-sm` 8px 圆角、`border-outline`、`bg-surface-container-lowest`、`text-body-medium text-on-surface placeholder:text-on-surface-variant`、聚焦态 `border-primary ring-1 ring-primary`、无效态 `border-error focus:border-error focus:ring-error`、透传 `aria-invalid={invalid || undefined}`）。
  - `FormField.tsx`：标签采用 `text-label-large text-on-surface`；计数器在 `counter.over` 为真时附加 `aria-invalid="true"` 与 `text-error font-semibold`；辅助说明采用 `text-body-small text-on-surface-variant`；错误消息保持 `role="alert"` 与 `text-error`。
  - `Card.tsx`：多态容器（`as?: "div" | "article" | "section" | "ul" | "ol" | "li"`），采用 `rounded-md` (12px)，仅定义实际消费的 `variant?: "outlined" | "filled"`（默认 `outlined`：`bg-surface-container-low border border-outline-variant`；`filled`：`bg-surface-container`，均无阴影）。
  - `Badge.tsx`：采用 MD3 色调标签（`rounded-sm` 8px，`text-label-small`），仅定义实际消费的 `variant?: "neutral" | "primary" | "success" | "warning"`（同步将 `KeyManager.tsx` 第 128 行的 `variant="brand"` 更新为 `variant="primary"`）。
  - `Dialog.tsx`：
    - `Dialog`：原生 `<dialog>` + `showModal()`，根节点固定包含 `fixed inset-0 m-0 flex h-screen w-screen max-h-none max-w-none items-center justify-center border-0 bg-scrim/40 p-4 z-50`（移除 `backdrop-blur-sm`），居中面板采用 Layer 3 `rounded-xl bg-surface-container-high text-on-surface p-6`，保留焦点记忆还原、Esc 取消与遮罩点击关闭。
    - 新增导出 `SideSheet`：基于原生 `<dialog>` + `showModal()` 封装侧边模态抽屉，支持 `side?: "left" | "right"`（默认 `right`）；`<dialog>` 根节点固定为 `fixed inset-0 m-0 flex h-screen w-screen max-h-none max-w-none border-0 bg-scrim/40 p-0 z-50`（`right` 配 `justify-end`，`left` 配 `justify-start`），**不套额外中间 `<div>`**，直接渲染 `children`（业务侧 `<form>` 或 `<aside>` 统一采用 Layer 3 `bg-surface-container-high` 底色并各自控制宽度），确保 `event.target === event.currentTarget` 遮罩点击关闭成立且窄屏右侧表单宽度严格等于视口宽度。
  - `States.tsx`：重写 `Skeleton`（`aria-label="加载中"`，`bg-surface-container-highest rounded-md`）、`EmptyState`、`ErrorBanner`（`role="alert"`，`bg-error-container text-on-error-container`）与 `UnauthorizedState`，全部保持领域中立。
- **Acceptance Criteria**：
  - `web/src/components/ui/` 下所有文件零“记忆 / Memory”业务词汇，零 `backdrop-blur`、`shadow-card`、`shadow-dialog`、`brand`、`stroke` 或零消费变体（无 `elevated` Card、无 `outlined` IconButton）。
  - `SideSheet` 的 `<dialog>` 含 `max-h-none max-w-none border-0 p-0 m-0 h-screen w-screen` 且无多余中间包裹层。
  - 执行 `cd web && npm run build` 编译通过。

---

## Phase 2：全局应用外壳解耦与自适应导航骨架

### TASK-003：创建单向受控的全局应用外壳模块（AppShell / TopBar / Navigation / Login）

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-002
- **Executor**：主线
- **Description**：在 `web/src/shell/` 下创建 `TopBar.tsx`、`Navigation.tsx`、`AppShell.tsx`、`Login.tsx` 与 `index.ts`，采用纯单向受控 Props 实现符合 MD3 规范且与业务解耦的全局应用外壳（不引入任何反向同步 Context）。
- **Details**：
  - `web/src/shell/TopBar.tsx`：
    - 高度 64px（`h-16`），采用 Layer 2 色调表面 `bg-surface-container text-on-surface border-b border-outline-variant/60`，无 `backdrop-blur`。
    - 左侧弹性容器（`flex min-w-0 items-center gap-2 sm:gap-3`）：当传入 `onOpenMobileNav` 时在窄屏渲染菜单 `IconButton`（`aria-label="打开导航菜单"`，`md:hidden`）+ 应用徽标与 `Capsa Studio` 标识 + 可选当前区域名（`<span>` 承载，不占用 `<h1>`）。
    - 右侧全局操作弹性容器（`flex shrink-0 items-center gap-1.5 sm:gap-2`）：当前管理员凭据胶囊（`ShieldCheck` + `info.name`）、主题切换 `IconButton`（`aria-label` 随 `theme` 切换“切换至浅色模式”/“切换至深色模式”）、退出 `Button`（含“退出”文本）。严禁放置任何未实现的占位入口。
  - `web/src/shell/Navigation.tsx`：
    - 定义通用导航项接口 `NavItem<T extends string = string>`（`id`、`label`、`icon`）。
    - 宽屏（`hidden md:flex`）渲染 MD3 **Navigation Rail**（宽 `88px`，`bg-surface-container border-r border-outline-variant/60`，内含 `<nav aria-label="主视图">`；导航项为 `<button type="button">`，配 `56×32px` 胶囊指示器 `rounded-full`，激活态 `bg-secondary-container text-on-secondary-container` 与 `aria-current="page"`）。
    - 窄屏打开态（`mobileOpen === true`）使用 `SideSheet`（`side="left"`）直接包裹 `<aside className="flex h-full w-72 max-w-[85vw] flex-col rounded-r-lg bg-surface-container-high text-on-surface">`（内含标题栏、`aria-label="关闭导航菜单"` 的 `IconButton`、`<nav aria-label="主视图">` 全宽圆角胶囊按钮列表及底部管理员 `Badge`）。
    - **断点模态锁释放**：不在已 `showModal()` 的 `<dialog>` 上施加 `md:hidden`；当 `mobileOpen` 为真时通过 `useEffect` 监听 `window.matchMedia("(min-width: 768px)")`，一旦进入桌面断点（或初始即为桌面宽度）立即调用 `onCloseMobile()` 退出原生模态态，杜绝隐形模态框锁死页面。
  - `web/src/shell/AppShell.tsx`：
    - 纯单向受控组件，Props 为 `info`、`theme`、`onToggleTheme`、`onSignOut`、`currentTitle?: string`、可选导航配置 `navItems?: NavItem[]`、`activeNavId?: string`、`onSelectNav?: (id: string) => void` 与 `children`；内部仅维护窄屏抽屉布尔开关 `mobileOpen`，无 Context 与反向 `useEffect`。
  - `web/src/shell/Login.tsx`：
    - 基于 `bg-surface` 画布与 MD3 `Card`（`variant="outlined"`，`rounded-xl p-6 sm:p-8`）重写管理员登录页，完整保留 `sessionStorage` 写入、`api.me()` 探活、`FORBIDDEN` 时清空凭据并提示“管理台仅支持管理员凭据登录（需 *:rw 权限）”、`aria-label="API Key"`、副标题“输入管理员 API Key 以继续”及提交按钮“连接”。
- **Acceptance Criteria**：
  - `web/src/shell/` 不导入任何记忆业务组件或分组模型，不含 React Context。
  - 窄屏导航抽屉监听 `(min-width: 768px)` 自动调用关闭回调，不在模态 `<dialog>` 上使用 `md:hidden`。
  - 执行 `cd web && npm run build` 编译通过。

### TASK-004：解耦根组件 App.tsx 并建立带完整状态机的 MemoryApp

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-003
- **Executor**：主线
- **Description**：新增 `web/src/memory/MemoryApp.tsx` 自治管理传统记忆模式的 5 项导航配置、分组数据流（含加载/错误重试/就绪三态）与五大视图分发，并精简 `web/src/App.tsx` 使其仅承担全局鉴权会话守卫与主题持久化。
- **Details**：
  - 在 `web/src/memory/MemoryApp.tsx` 中声明 `MEMORY_NAV_ITEMS`（`记忆工作台`、`分类管理`、`凭据管理`、`时效复核`、`回收站`），接收 `info`、`theme`、`onToggleTheme`、`onSignOut` 并直接渲染单向受控的 `<AppShell>`：
    - **分组首屏加载态**：渲染 `<AppShell info={info} theme={theme} onToggleTheme={onToggleTheme} onSignOut={onSignOut} currentTitle="记忆工作台">`（不传 `navItems`，使顶栏稳定可见且暂不挂载 `navigation[name="主视图"]` 地标），主槽位渲染 `<Skeleton rows={3} />`。
    - **分组首屏失败态**（非 401 错误；401 由全局守卫接管）：同样渲染持久 `<AppShell>`（顶栏退出与主题切换完全可用），主槽位渲染 `<ErrorBanner message={groupsError} onRetry={loadGroups} />`，杜绝异常时永久停留在骨架屏。
    - **分组就绪态**：向 `<AppShell>` 单向传入 `navItems={MEMORY_NAV_ITEMS}`、`activeNavId={view}`、`onSelectNav` 与 `currentTitle={currentViewItem.label}`，主槽位分发渲染 5 个记忆业务视图。确保端到端测试在观测到 `navigation[name="主视图"]` 可见后立即打开“新建记忆”抽屉时，`groups` 已 100% 就绪。
  - 重写 `web/src/App.tsx`：移除 `groups` 状态、`VIEWS` 常量及 5 个记忆视图的导入；仅保留 `sessionStorage` 初始凭据核验（仅调 `api.me()`）、`setUnauthorizedHandler` 401 锁屏跳转、`data-theme` 与 `localStorage("capsa_theme")` 同步、未登录渲染 `<Login />` / `<UnauthorizedState />`，已登录渲染 `<MemoryApp />`。删除已被替代的旧 `web/src/components/Login.tsx`、`TopBar.tsx` 与 `Sidebar.tsx`。
- **Acceptance Criteria**：
  - `web/src/App.tsx` 零记忆视图导入、零 `groups` 状态、零导航项硬编码。
  - `MemoryApp` 完整覆盖 `groups` 首屏加载、非 401 错误重试与就绪三态。
  - 旧 `Login.tsx`、`TopBar.tsx`、`Sidebar.tsx` 已从 `web/src/components/` 删除，执行 `cd web && npm run build` 编译通过。

---

## Phase 3：传统记忆业务五大存量视图重写与旧令牌收口清零

### TASK-005：按 MD3 重写记忆工作台、详情面板、Markdown 表面与侧边编辑抽屉

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-004
- **Executor**：主线
- **Description**：将工作台链路组件迁入 `web/src/memory/`（`MemoryWorkspace.tsx`、`MemoryDetailPane.tsx`、`Markdown.tsx`、`EditDrawer.tsx`）并全面重写为 MD3 色调表面与交互形态，移除 `web/src/components/` 下对应旧文件。
- **Details**：
  - `web/src/memory/MemoryWorkspace.tsx`：
    - 桌面端双栏布局 `md:grid-cols-[340px_1fr]`、移动端列表/详情单栏切换；左侧列表栏（`aria-label="记忆列表"`）采用 `bg-surface-container-low` 与右侧 `md:border-r md:border-outline-variant`，筛选头部采用 `bg-surface-container`（无 `backdrop-blur`）。
    - 检索框采用 MD3 Search Bar 圆角胶囊造型（`rounded-full bg-surface-container-high`，保留 `aria-label="检索记忆"`）；置顶筛选采用 `<IconButton variant="tonal" selected={pinnedOnly} aria-pressed={pinnedOnly} aria-label="只看置顶" title="只看置顶">`；分组筛选胶囊采用 MD3 Filter Chip（`rounded-sm` 8px，激活态 `bg-secondary-container text-on-secondary-container`，未激活态 `border-outline text-on-surface-variant`，保留 `aria-pressed`）；分类管理快捷入口采用 `<IconButton aria-label="管理分类" title="管理分类">`。
    - 列表项按钮采用色调高亮（选中态 `bg-secondary-container/70` 配左侧 3px `bg-primary` 指示条），保留置顶图标 `aria-label="已置顶"`、过期 `Badge`（`warning`）与标签 `Badge`（`neutral`）。
    - 右下角“新建记忆”按钮重写为 MD3 **Extended FAB**（`rounded-lg` 16px、`h-14 px-4`、`bg-primary-container text-on-primary-container shadow-elevation-3`）。
  - `web/src/memory/MemoryDetailPane.tsx`：
    - 根元素保持 `<article>` 置于 `bg-surface` 主阅读画布；移动端顶部保留“返回列表”按钮（`md:hidden`）；标题采用 `text-headline-small`，操作区为 MD3 `tonal` / `secondary` 胶囊按钮（“编辑”“删除”）；元数据 `<dl>` 保持“分组 / 更新 / 复核 / 标签”及 `2020-01-01 · 已过期` / `未设置` 文本格式；软删除确认区采用 `<Card variant="filled">`（`bg-surface-container`），保留 `aria-label="删除原因"` 与“移入回收站”按钮。
  - `web/src/memory/Markdown.tsx`：
    - 严格保持 `ReactMarkdown` + `skipHtml` + `rehypePlugins={[rehypeSanitize]}` 及外链 `target="_blank" rel="noopener noreferrer"` 不变；代码块、引用块、表格与链接全面切换至 MD3 `surface-container`、`outline-variant` 与 `primary` 令牌。
  - `web/src/memory/EditDrawer.tsx`：
    - 复用 `SideSheet`（`side="right"`）原语直接包裹 `<form className="relative flex h-full w-full flex-col bg-surface-container-high text-on-surface md:w-[560px] md:rounded-l-xl md:border-l md:border-outline-variant">`（对齐 Layer 3 `surface-container-high`，窄屏下零边框全宽 `w-full`）；确保 `<header>` 为 `<form>` 全宽直接子元素且 `<h2>{memory ? "编辑记忆" : "新建记忆"}</h2>` 为 `<header>` 直接子元素，使 375px 视口下 `heading.locator("..")` 的测量宽度严格等于 `375`。
    - 完整保留标题（60）/摘要（200）/正文（64000）实时字数超限校验、分组为空时随 `groups` 自动兜底选中首项、编辑态复核日期与“清除”按钮、相似标题警示卡片（`bg-warning-container text-on-warning-container`）以及 `dirty` 未保存关闭确认。
  - 更新 `MemoryApp.tsx` 引用并删除旧文件 `MemoryList.tsx`、`MemoryDetail.tsx`、`Markdown.tsx`、`EditDrawer.tsx`。
- **Acceptance Criteria**：
  - 工作台、详情、Markdown 与编辑抽屉零旧令牌类名、零 `backdrop-blur`；`Markdown.tsx` 完整保留 `skipHtml` 与 `rehypeSanitize`。
  - 执行 `cd web && npm run build` 编译通过。

### TASK-006：按 MD3 重写其余四视图、清理旧组件并移除过渡兼容样式块

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-005
- **Executor**：主线
- **Description**：将 `GroupManager.tsx`、`KeyManager.tsx`、`ReviewCenter.tsx`、`RecycleBin.tsx` 迁入 `web/src/memory/` 并全面按 MD3 重写，删除 `web/src/components/` 下全部遗留业务文件，同时移除 `index.css` 与 `tailwind.config.js` 中的过渡期兼容别名块并执行全量旧类名清零门禁。
- **Details**：
  - `web/src/memory/GroupManager.tsx`：
    - 顶栏标题 `<h1>分类管理</h1>`（`text-headline-small`）配 MD3 `primary` `Button`“新建分类”；分类网格项保持 `<Card as="li" variant="outlined">`，操作按钮采用 MD3 `tonal` / `secondary` 胶囊按钮；新建/编辑分类与删除确认统一复用 MD3 `Dialog`（`surface-container-high`，28px 圆角），完整保留 `slug` 正则校验、编辑态 `slug` 禁用及非空分类删除 `role="alert"` 错误提示。
  - `web/src/memory/KeyManager.tsx`：
    - 保持 `<h1>凭据管理</h1>` 与“签发 Key”按钮；凭据列表项保持 `<Card as="li" variant="outlined">`，徽章使用 `primary`（当前凭据）、`success`（有效）、`neutral`（已吊销）；当前会话凭据继续显示“当前会话不可操作”防自锁提示。
    - 签发弹窗（`签发新 Key`）：单选控件使用 `accent-primary` 与可点击 `<label>` 包裹（保留“自定义分组权限”“只读”“读写”“无权限”文案及空权限阻断提示“请至少为一个分组授予权限”）。
    - 单次明文披露弹窗（`Key 签发成功`）：警示框使用 `bg-warning-container text-on-warning-container rounded-md`，令牌展示框使用 `bg-surface-container-highest border-outline-variant rounded-sm font-mono select-all`，保留“复制令牌”与“我已保存并关闭”。
    - 吊销（`吊销 Key` / `确认吊销`）与物理删除（`删除 Key` / `确认删除`）确认弹窗对齐 MD3 Dialog 排版。
  - `web/src/memory/ReviewCenter.tsx` 与 `web/src/memory/RecycleBin.tsx`：
    - 保持 `<Card as="ul" role="list" variant="outlined" className="divide-y divide-outline-variant overflow-hidden">` 列表语义，标题统一为 `text-headline-small`，延期按钮（`延期 +30 天` / `延期 +90 天`）与“恢复”按钮采用 MD3 `tonal` / `secondary` 胶囊按钮。
  - 删除 `web/src/components/` 下旧 `GroupManager.tsx`、`KeyManager.tsx`、`ReviewCenter.tsx`、`RecycleBin.tsx`，并删除 `TASK-001` 在 `web/src/styles/index.css` 与 `web/tailwind.config.js` 中暂留的过渡期兼容块。
- **Acceptance Criteria**：
  - `web/src/components/` 下仅存 `ui/` 目录。
  - 在 `web/src/` 与 `web/tailwind.config.js` 中执行正则检索：`acrylic|backdrop-blur|shadow-card|shadow-dialog|ease-fluent|Segoe UI|0078D4|--color-|bg-background|text-foreground|fill-foreground|text-muted|text-subtle|border-stroke|divide-stroke|bg-stroke|(bg|text|border|ring|accent)-brand|(bg|text|border|ring)-danger|\btext-(body|caption)(?![-a-z])`，匹配结果严格为 **0**。
  - 执行 `cd web && npm run build` 编译通过。

---

## Phase 4：全量回归验证、端到端测试补强与文档同步

### TASK-007：产出静态嵌入资源并执行 Go 全量测试与 Playwright E2E 回归验证

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-006
- **Executor**：主线
- **Description**：在 `web/tests/e2e.spec.ts` 中完整保留既有 12 条用例断言不变并新增 1 条 MD3 主题切换、窄屏模态抽屉导航与桌面断点自动解锁验证用例，构建前端静态产物并重编 `bin/capsa`，跑通 Go 全量测试与 Playwright E2E 测试套件。
- **Details**：
  - 在 `web/tests/e2e.spec.ts` 末尾新增用例 `13. MD3 主题亮暗切换与窄屏模态抽屉导航`：
    1. 登录后校验 `document.documentElement.getAttribute("data-theme")` 为 `light` 或 `dark`，点击主题切换按钮断言 `data-theme` 翻转且 `localStorage.getItem("capsa_theme")` 同步更新，读取根节点计算样式确认 `--md-sys-color-surface` 非空生效。
    2. 切换视口至 `375×667`，点击 `打开导航菜单` 唤起模态导航抽屉，点击 `分类管理` 完成跳转且抽屉自动收起，断言 `heading[name="分类管理"]` 可见；再次打开导航抽屉后将视口切回 `1280×720`，断言模态抽屉自动关闭且页面导航按钮仍可正常点击切换（验证无 `inert` 锁死）。
  - 依次串行执行：
    1. `cd web && npm run build`（产出 `internal/server/static/`）
    2. `go build -o bin/capsa ./cmd/capsa`（重编嵌入最新静态产物的二进制供 `serve.sh` 启动）
    3. `go test ./...`（验证后端单元与集成测试零回归，且确认 Go 源码零改动）
    4. `cd web && env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY npm run test:e2e`（验证全部 13 条端到端用例全绿）
- **Acceptance Criteria**：
  - `cd web && npm run build` 零错误完成。
  - `go test ./...` 全量通过，`cmd/`、`internal/`、`tests/` 下 Go 源码零修改。
  - `npm run test:e2e` 13/13 用例全部 PASSED。

### TASK-008：同步更新 Project.md 与 README.md 文档并清理工作区历史临时文件

- **Status**：DONE
- **Priority**：P1
- **Dependencies**：TASK-007
- **Executor**：主线
- **Description**：更新 `.docs/Project.md` 与 `README.md` 中关于 Web 管理台设计体系、目录分层与主题令牌的陈述，并显式清理已废弃的工作区历史临时文件 `temp/capsa-functional-architecture.html`。
- **Details**：
  - 在 `.docs/Project.md` 中：
    - `## 结构` 章节：将 `web/` 描述更新为 `Material Design 3 + React 18 + TypeScript + Tailwind`，记录 `components/ui/`（领域中立基础原语）、`shell/`（全局应用外壳：登录页、弹性顶栏、Navigation Rail / Modal Navigation Drawer）与 `memory/`（传统记忆业务子应用及 5 个视图）的三层解耦结构，同步端到端套件用例数（13 条）。
    - `## 约定` 章节：将前端条目更新为“Material Design 3（MD3）体系以 `--md-sys-*` CSS 变量承载语义色彩、五级色调表面（`surface-container-*`）、圆角与字阶令牌，通过根节点 `data-theme="light" | "dark"` 与 `color-scheme` 切换，以表面明度差替代毛玻璃与重阴影”。
    - `## 约束与决策` 章节：新增一条本次前端切换至 MD3 色调表面及单向受控全局外壳与记忆业务解耦的决策记录（含日期与原因）。
  - 在 `README.md` `## Web 管理台` 段落中，将 Fluent 2 / Mica / Acrylic 描述同步更新为 Material Design 3 设计系统（顶栏 + Navigation Rail / 模态导航抽屉 App Shell、五级色调表面层级与亮暗主题切换）。
  - 对照 `SCOPE.md`“不保留一次性产物”与 `Document Maintenance`“清理临时文件”规则，执行 `git rm temp/capsa-functional-architecture.html` 并删除规划期演示原型 `temp/capsa-md3-demo.html`（一并移除空的 `temp/` 目录），确保 `git status` 无悬空未交代变更与未跟踪临时产物。
- **Acceptance Criteria**：
  - `.docs/Project.md` 与 `README.md` 中无过期的 Fluent 2 / Acrylic / Mica 现态描述，目录结构与实际 `web/src/` 完全吻合。
  - `temp/capsa-functional-architecture.html` 清理意图明确落位，`git diff` 确认无任何后端源码改动。
