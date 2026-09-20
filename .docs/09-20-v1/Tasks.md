# Tasks：Web 管理台 Fluent 2 完全重写

**关联 Plan**：`Plan.md` —— Web 管理台 Fluent 2 完全重写 v1.0  
**总计 Task**：16 个

> **语义契约（全任务共同前置）**：`web/tests/e2e.spec.ts` 的 12 条用例以角色与可访问名定位元素，重写必须保持其断言强度。**唯一获准的用例改动**：把第 104 行的 `toHaveClass(/text-red-600/)` 改为 `toHaveAttribute("aria-invalid", "true")`——原断言把 Tailwind 类名当作契约，与令牌化后的深色配色互斥；替换后断言强度不降，反而不再耦合实现细节。除此之外任何断言不得放宽或删除。受保护的关键契约：`navigation` 名为「主视图」、按钮名「连接 / 退出 / 新建记忆 / 编辑 / 删除 / 保存 / 创建 / 恢复 / 返回列表 / 新建分类 / 签发 Key / 确认删除 / 确认吊销 / 吊销 / 取消 / 签发 / 复制令牌 / 我已保存并关闭 / 时效复核 / 回收站 / 分类管理 / 记忆工作台`、标签名「API Key / 检索记忆 / 分组 / 标题 / 摘要 / 正文 / 复核时间 / 删除原因 / 分类标识 / 分类名称 / 分类描述 / Key 名称 / 标签」、`article` 承载记忆详情、`li` 承载列表项、`role="alert"` 承载错误文案、抽屉标题「新建记忆」所在的直接父元素宽度等于视口宽度。

---

## Phase 1：设计基座与 App Shell

### TASK-001：定义 Fluent 语义令牌层

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：无
- **Description**：重写 `web/src/styles/index.css`，以 CSS 变量声明 Fluent 2 语义令牌，并在 `web/tailwind.config.js` 中把它们映射为可用的 Tailwind 颜色、圆角与阴影名。
- **Details**：
  - 令牌分组：`background`（Layer 0 画布）、`surface`（Layer 1 卡片）、`acrylic`（Layer 2 半透明框架层）、`stroke`/`stroke-strong`（1px 边框与高光）、`foreground`/`muted`/`subtle`（文本三级）、`brand`/`brand-hover`/`brand-pressed`、`danger`、`warning`、`success`。
  - 阴影令牌：`shadow-card`（Depth 4）、`shadow-flyout`（Depth 8）、`shadow-dialog`（Depth 16）；圆角 `4px / 6px / 8px`；动效时长 `150ms / 250ms` 与标准缓动曲线。
  - 浅色取 Fluent 2 亮色灰阶与 `#0078D4` 品牌蓝；深色取 `#1F1F1F` 至 `#292929` 高阶灰与 `#479EF5`，不使用纯黑纯白。
  - 语义色至少覆盖 `brand` 与 `danger` 两套配对值（浅色 `#D13438` / 深色 `#FF99A4`），供超限提示等状态使用。
  - 深色经根节点 `data-theme="dark"` 切换，令牌值在 CSS 变量层覆盖，组件代码不感知主题。
  - 字体族以 `Segoe UI` 起头，回退到 `system-ui`；引入 Fluent 排版阶（Caption 12 / Body 14 / Subtitle 16 / Title 20）为工具类。
- **Acceptance Criteria**：
  - `cd web && npm run build` 通过。
  - 令牌在 `web/tailwind.config.js` 中完成映射，组件可直接以 `bg-surface`、`text-muted`、`border-stroke`、`shadow-card` 等语义名引用；旧色阶类的清零在 TASK-014 统一收口，本任务不作要求。
  - 切换 `data-theme` 后 `brand` 与 `danger` 两组值均随之改变。
  - 切换 `data-theme` 后画布、卡片、文本、边框四类颜色全部随之改变。

### TASK-002：建立 UI 原语层

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-001
- **Description**：新建 `web/src/components/ui/` 目录，交付 Button、FormField、Input/Textarea/Select、Card、Badge、Dialog、States 原语，供全部视图复用。
- **Details**：
  - `Button`：`variant` 取 `primary | secondary | subtle | danger | warning`，`size` 取 `sm | md`；统一 `focus-visible` 焦点环、`disabled` 态、`aria-busy` 与进行中文案（如「正在签发...」）。
  - `FormField`：只承载标签、可选计数器与错误位的镀铬层，控件经 `children` 传入；不按控件类型分叉，不出现 `multiline` / `isSelect` / `options` 这类判别参数。
  - `Input` / `Textarea` / `Select`：原生控件的样式封装，只负责形状、边框、焦点与禁用态，不含计数器逻辑；控件必须以 `aria-label` 暴露标签名，保持 Playwright `getByLabel` 可用。
  - `Card`：Layer 1 表面（`surface` 底 + `stroke` 边 + `shadow-card` + 6px 圆角），提供可点击（列表行）与静态（详情面板）两种形态。
  - `Dialog`：Layer 3 容器，基于原生 `<dialog>` 与 `showModal()`；焦点约束、Esc 关闭与背景 inert 由平台提供，不手写 Tab 循环。
  - `<dialog>` 渲染为铺满视口的透明层（`w-screen h-screen m-0 max-w-none max-h-none p-0 border-0`），重置 UA 的 `max-width: calc(100% - 6px - 2em)`、居中 margin、padding 与 border。无头 Chrome 实测（375px 视口）：不重置时 dialog 实测 337px、其内全宽 `<header>` 仅 299px，会直接击穿 E2E 用例 10 的 375 宽度断言；重置后两者均为 375px。组件层只负责点击层本身（`event.target === dialog`）关闭，以及关闭后把焦点归还触发元素。
  - `Badge`：`neutral | brand | success | warning | danger` 五态。
  - `States`：Skeleton / EmptyState / ErrorBanner / UnauthorizedState 四态，沿用现有对外文案与 `aria-label="加载中"`、`role="alert"` 语义。
  - 原语统一从 `web/src/components/ui/index.ts` 导出。
- **Acceptance Criteria**：
  - `npm run build` 通过，无新增依赖。
  - 原语文件中不出现硬编码颜色值（只引用令牌）。
  - `Dialog` 的 Esc 关闭、点击空白关闭与焦点归还经浏览器实测成立。

### TASK-003：重构 App Shell 为侧栏导航 + 标题栏

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-002
- **Description**：重写 `web/src/App.tsx`，以 `web/src/components/Sidebar.tsx` 与 `web/src/components/TopBar.tsx` 替换顶部文字 Tab 导航，删除 `web/src/components/Header.tsx`。
- **Details**：
  - 画布为 Layer 0 Mica 基底；侧栏与标题栏为 Layer 2 Acrylic 材质（半透明底 + `backdrop-blur` + 1px 高光边框）。
  - 导航容器保留 `role="navigation"` 且 `aria-label="主视图"`，五个入口文案不变，当前项以 `aria-current` 与品牌色选中条标识。
  - 侧栏展示各视图图标与文案；宽度 `< 768px` 时收为抽屉，由标题栏的菜单按钮唤出，抽屉内导航项点击后自动收起。
  - 标题栏承载当前视图名、主题切换按钮（浅/深色，选择写入 `localStorage`）与「退出」按钮；「退出」保持可访问名「退出」。视图名以非 heading 元素呈现，避免与视图内 `h1` 同名触发 Playwright 严格模式双匹配。
  - 主题初始化在首帧前完成，避免闪烁。
- **Acceptance Criteria**：
  - E2E 用例 1、3、4 通过（登录页无主视图；退出清空 `sessionStorage`；非管理员凭据被拦截）。
  - 五视图经侧栏切换均能渲染对应内容。
  - 375px 视口下侧栏隐藏、菜单按钮可唤出抽屉。

### TASK-004：重写登录页

- **Status**：DONE
- **Priority**：P1
- **Dependencies**：TASK-002
- **Description**：重写 `web/src/components/Login.tsx`，在 Layer 0 画布上以单张 Layer 1 卡片承载凭据输入。
- **Details**：
  - 保留 `getByLabel("API Key")` 可达的密码输入与可访问名「连接」的提交按钮，以及文案「输入管理员 API Key 以继续」。
  - 保留 403 文案「管理台仅支持管理员凭据登录（需 *:rw 权限）」并清除凭据；其他错误展示 `ApiError.message`。
  - 空输入或提交中禁用按钮；错误以 `role="alert"` 呈现。
  - 卡片可加入品牌标识与一句服务定位说明，不添加无信息量的装饰。
- **Acceptance Criteria**：
  - E2E 用例 3、4 通过。
  - 键盘可直接 Tab 到输入框并回车提交。

---

## Phase 2：记忆工作台与编辑链路

### TASK-005：重写记忆工作台主从布局

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-003
- **Description**：重写 `web/src/components/MemoryList.tsx`，在既有取数逻辑之上重建「列表栏 + 详情栏」双栏布局。
- **Details**：
  - 列表栏：Acrylic 检索区（`getByLabel("检索记忆")` 保持）、只看置顶开关（`aria-pressed`）、分类筛选（「全部」+ 各分类名按钮 + 「管理分类」图标按钮）。
  - 列表项以 `li` 承载、内部为可点击 Card 行，展示标题、置顶标记、摘要、分组、日期、过期与标签；选中项以品牌色左边条与加深底色标识。
  - 详情栏为 Layer 1 面板；窄屏下按 `selected` 在列表与详情间切换，「返回列表」按钮仅在窄屏显示。
  - 「新建记忆」浮动按钮保留可访问名，不遮挡底部操作。
  - 四态（加载 / 空 / 错误 / 未授权）统一走原语。
- **Acceptance Criteria**：
  - E2E 用例 8 中检索、选中、返回列表相关步骤通过。
  - 分类筛选与置顶过滤在本地可见地改变列表内容。
  - `md` 以上双栏同屏，`md` 以下单栏互斥。

### TASK-006：重写记忆详情面板与 Markdown 表面

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-005
- **Description**：重写 `web/src/components/MemoryDetail.tsx` 与 `web/src/components/Markdown.tsx` 的视觉层，保持渲染管线与删除交互不变。
- **Details**：
  - 详情根节点保持 `article`；标题层级、元数据定义列表、摘要、正文分区排布；「编辑」「删除」按钮可访问名不变。
  - 复核时间保持「`YYYY-MM-DD` · 已过期」的单行文本形态（日期与后缀在同一元素内相邻），清除后展示「未设置」。
  - `Markdown` 保留 `skipHtml` + `rehypeSanitize` 与安全外链属性，令牌化标题、列表、引用、行内代码、代码块、表格与链接配色。
  - 删除确认区保持 `getByLabel("删除原因")`、可访问名「移入回收站」与「取消」，失败以 `role="alert"` 呈现。
  - 「返回列表」按钮样式与位置随 Fluent 收敛，仅在窄屏渲染。
- **Acceptance Criteria**：
  - E2E 用例 5、6、8、10 通过。
  - 未设置复核时间时仍展示文案「未设置」，过期时展示「已过期」。
  - 详情中不出现 `dangerouslySetInnerHTML`。

### TASK-007：重写编辑抽屉

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-002、TASK-006
- **Description**：重写 `web/src/components/EditDrawer.tsx` 的表单与抽屉外壳，保持全部字段、校验与提交语义。
- **Details**：
  - 抽屉为原生 `<dialog>` 承载的 Layer 3 表面：右侧面板，`md` 以上宽 `560px`，`md` 以下占满视口宽度。`<dialog>` 只作全屏透明容器，遮罩与面板仍是内层结构，面板以 `ml-auto` 贴右——保持现有「遮罩 + 面板」DOM 形态不变。**DOM 契约**：`<h2>新建记忆</h2>` 的直接父元素必须是占满抽屉全宽的结构容器（面板内 `<header>` 或面板根），不得在两者之间插入按内容收缩的内联包装层——E2E 用例 10 以 `heading.locator("..")` 测量该父元素宽度并断言等于 375。
  - 字段沿用 `FormField` + `Input`/`Textarea` 原语，标签名不变；标题 60、摘要 200、正文 64000 上限保留，超限时计数器与控件置 `aria-invalid="true"` 并以 `danger` 语义色呈现（用例 7 的断言即改用该属性，见共同前置）；`getByLabel("分组")` 的下拉仅在新建时出现。
  - 「保存」「创建」「取消」「关闭」可访问名不变；提交中禁用；失败以 `role="alert"` 呈现。
  - 相似标题提示、`beforeunload` 拦截与未保存改动的 `confirm` 保持现有逻辑。
- **Acceptance Criteria**：
  - E2E 用例 5、7、8、9、10、11 中所有涉及抽屉的步骤通过。
  - 超限时按钮禁用且计数器标红；相似标题时展示提示且不阻断落库。

---

## Phase 3：分类、凭据、复核与回收站

### TASK-008：重写分类管理

- **Status**：DONE
- **Priority**：P1
- **Dependencies**：TASK-002
- **Description**：重写 `web/src/components/GroupManager.tsx`，以卡片网格呈现分类，复用 `Dialog` 原语承载表单与确认。
- **Details**：
  - 分类项以 `li` 承载，展示名称、slug、描述与记忆条数；「编辑」「删除」按钮可访问名不变。
  - 表单对话框保留 `getByLabel("分类标识" / "分类名称" / "分类描述")`，编辑态标识禁用，标题为「新建分类」/「编辑分类」，按钮「创建」/「保存」/「取消」。
  - 删除确认对话框标题「删除分类」，按钮「确认删除」/「取消」，含记忆阻断文案保持「仍有记忆（含回收站），禁止删除」并以 `role="alert"` 呈现。
- **Acceptance Criteria**：
  - E2E 用例 9、11 通过。
  - 删除成功后分类卡片即时消失，且工作台筛选器同步刷新。

### TASK-009：重写时效复核与回收站

- **Status**：DONE
- **Priority**：P1
- **Dependencies**：TASK-002
- **Description**：重写 `web/src/components/ReviewCenter.tsx` 与 `web/src/components/RecycleBin.tsx` 的视觉层。
- **Details**：
  - 两者均以 Layer 1 列表表面呈现，表头区承载标题与统计；空态沿用「所有追踪记忆均在有效期内」「回收站暂无条目」。
  - 复核项保留「延期 +30 天」「延期 +90 天」按钮与过期时间展示；回收站项保留「恢复」按钮与删除原因文本。
  - 操作中的失败提示以 `role="alert"` 呈现。
- **Acceptance Criteria**：
  - E2E 用例 8 中回收站相关步骤通过（点击「回收站」进入、展示「流程验证」、点「恢复」后条目消失）。
  - 复核页对过期条目执行延期后条目移出列表。

### TASK-010：重写凭据管理列表与签发对话框

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-002
- **Description**：重写 `web/src/components/KeyManager.tsx` 的列表与签发抽屉，保留全部权限配置与校验语义。
- **Details**：
  - 列表项以 `li` 承载，展示名称、Key ID、状态徽章（「有效」/「已吊销」）、「当前凭据」标记、权限摘要、最后调用与创建时间。
  - 「吊销」「删除」「签发 Key」按钮可访问名不变；当前凭据行以文案「当前会话不可操作」替代破坏性按钮。
  - 签发对话框标题「签发新 Key」，保留 `getByLabel("Key 名称")`、权限三选一（含文案「自定义分组权限」）、逐分组「无权限 / 只读 / 读写」单选、空权限阻断文案「请至少为一个分组授予权限」与「签发」按钮。
  - **DOM 契约**：三个权限模式选项与每个分组的三个级别选项都必须由 `<label>` 元素包裹，并保持「模式选项在前、分组权限行在后」的文档顺序——E2E 用例 12 以 `locator("label", { hasText: ... })` 点击这些选项。
- **Acceptance Criteria**：
  - E2E 用例 12 第 1–3、6–8 步通过。
  - 全库读写 / 全库只读 / 自定义三种模式提交出的 scopes 与既有实现一致。

### TASK-011：重写单次明文披露与确认对话框

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-010
- **Description**：重写凭据管理的披露对话框与吊销 / 删除确认对话框，统一走 `Dialog` 原语。
- **Details**：
  - 披露对话框标题「Key 签发成功」，保留提示「明文令牌仅在本次创建后展示一次」、令牌展示区（选中态 + 自动换行）、「复制令牌」「我已保存并关闭」按钮；复制成功 / 失败 / 手动选中三种反馈保留。
  - 吊销确认标题「吊销 Key」、按钮「确认吊销」；删除确认标题「删除 Key」、按钮「确认删除」；两者含 `role="alert"` 失败位与禁用态。
  - 关闭后组件卸载、局部状态随组件销毁；令牌不经 `sessionStorage` / `localStorage` 持久化。
- **Acceptance Criteria**：
  - E2E 用例 12 第 4、5、7、8 步通过。
  - `sessionStorage` 仅含 `capsa_key`，不出现令牌副本。

---

## Phase 4：无障碍与响应式收敛

### TASK-012：统一焦点、键盘与动效行为

- **Status**：DONE
- **Priority**：P1
- **Dependencies**：TASK-003、TASK-007、TASK-011
- **Description**：对全站交互做一次无障碍与动效收敛，消除重写引入的行为缺口。
- **Details**：
  - 所有交互元素具备可见 `focus-visible` 焦点环（品牌色，2px，含 2px 偏移）。
  - 对话框的焦点约束、Esc 关闭与背景 inert 由原生 `<dialog>` 的 `showModal()` 提供；组件层只负责关闭后把焦点归还触发元素，不手写 Tab 循环。
  - 图标按钮补齐 `aria-label`；装饰性图标 `aria-hidden`。
  - 在 `prefers-reduced-motion: reduce` 下关闭位移与缩放类动效，仅保留透明度变化。
- **Acceptance Criteria**：
  - 五个导航项均可 Tab 聚焦并回车激活；新建记忆抽屉可由键盘打开、填写并提交。
  - 开启系统「减少动态效果」后，抽屉与对话框无位移过渡。

### TASK-013：收敛移动端布局

- **Status**：DONE
- **Priority**：P1
- **Dependencies**：TASK-003、TASK-005、TASK-007
- **Description**：校准 375px 视口下的导航、工作台与抽屉行为。
- **Details**：
  - 侧栏收起为抽屉；标题栏保持可操作；浮动操作按钮与内容不重叠。
  - 工作台列表 / 详情互斥显示，「返回列表」可回到列表。
  - 编辑抽屉与各对话框占满可用宽度，内容区可滚动、底部操作条始终可见。
- **Acceptance Criteria**：
  - E2E 用例 10 通过（375px 下抽屉标题的直接父元素宽度等于 375）；原生 `<dialog>` 的 UA 宽度约束与内边距已重置，未压缩面板。
  - 375px 下五个视图均无横向滚动条。

### TASK-014：清除旧调色板与死代码

- **Status**：DONE
- **Priority**：P1
- **Dependencies**：TASK-004 至 TASK-011
- **Description**：收口重写遗留，确保代码库中只剩 Fluent 令牌体系。
- **Details**：
  - 删除 `web/src/components/Header.tsx` 与 `web/src/components/States.tsx`（其职责已迁入 `ui/`）。
  - 全量检索并清除 `zinc-*` 色阶类与不透明旧底色类（`bg-white`、`bg-zinc-900`、`text-blue-700` 等）。**豁免**：Layer 2 材质要求的半透明高光边框与半透明表面底色（如 `border-white/40`）属 Fluent Acrylic 规范的一部分，保留。
  - 清理未使用的导入与未导出的临时组件。
- **Acceptance Criteria**：
  - `npm run build` 与 `tsc` 均通过，无未使用导入告警。
  - `zinc-*` 与不透明旧底色类的检索结果为 0（上述豁免项除外），`Header.tsx` / `States.tsx` 不再存在。

---

## Phase 5：回归验证与文档同步

### TASK-015：执行前端构建与端到端回归

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-014
- **Description**：构建静态产物并执行 Playwright 端到端套件，逐条核对 12 条用例。
- **Details**：
  - 有头浏览器实例不可用（调试端口 9222 无响应），全部浏览器验证在 Playwright 无头模式下执行——`web/playwright.config.ts` 保持现有配置，不新增 headed 相关设置。
  - `cd web && npm run build`（产物落 `capsa/static/`）；必要时执行 `.venv/bin/python -m pytest -q` 确认后端无回归。
  - `cd web && npm run test:e2e`，用例失败时修正实现而不是放宽断言。
  - 在临时目录留存关键页面截图用于视觉自查（不提交）。
- **Acceptance Criteria**：
  - 构建成功，Playwright 12 条用例在无头 Chrome 下全部通过。
  - 后端 pytest 结果与改动前一致。
  - 全程未启动有头浏览器；`boundingBox()` 量测与关键页面截图均在无头会话中产出。

### TASK-016：同步项目文档并归档本阶段

- **Status**：DONE
- **Priority**：P2
- **Dependencies**：TASK-015
- **Description**：按变更类型更新 `.docs/Project.md` 与 `README.md`，随后执行归档。
- **Details**：
  - `Project.md` §3 目录结构：更新 `web/src/components/` 描述，标注 `ui/` 原语层与新组件名；§5 关键约定「前端约定」补充 Fluent 令牌与主题切换（`data-theme` + `localStorage`）；§6 或 §8 记录「不使用 Fluent UI React v9，改以 Tailwind 表达 Fluent 令牌」的决策与理由；§1「当前阶段」更新为本次交付。
  - `README.md` 中管理台功能描述与截图/说明同步。
  - 归档：确定目录名 `.docs/MM-DD-vN/`（当日递增），把根目录 `Plan.md` 与 `Tasks.md` 移入，Plan / Tasks 标注 `状态：DONE`、补完成日期与回归结论；校验根目录无残留。
- **Acceptance Criteria**：
  - `Project.md` 描述的组件树与仓库实际文件一致。
  - `.docs/<归档目录>/` 同时含 `Plan.md` 与 `Tasks.md`，根目录无 `Plan.md` / `Tasks.md`。