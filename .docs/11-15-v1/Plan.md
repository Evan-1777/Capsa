# Plan：Web 管理台 Material Design 3 重写与应用外壳解耦

**状态**：DONE  
**日期**：2026-11-15  
**完成日期**：2026-11-15  
**版本**：v1.1（吸收质量审计意见：改用纯单向受控属性装配外壳、补齐模态抽屉顶层约束重置与断点解锁、补齐分组首屏错误恢复分支、裁剪零消费令牌与变体）  
**回归测试结论**：前端 `cd web && npm run build` 零错误通过；`go build -o bin/capsa ./cmd/capsa` 成功；`go test ./...` 全部通过且 `cmd/`、`internal/`、`tests/` 下 Go 源码零改动；Playwright `npm run test:e2e` 13/13 全绿（含新增的 MD3 主题亮暗切换与窄屏模态抽屉断点解锁断言）；旧令牌正则门禁（`acrylic|backdrop-blur|shadow-card|shadow-dialog|ease-fluent|Segoe UI|0078D4|--color-|bg-background|text-foreground|fill-foreground|text-muted|text-subtle|border-stroke|divide-stroke|bg-stroke|(bg|text|border|ring|accent)-brand|(bg|text|border|ring)-danger|\btext-(body|caption)(?![-a-z])`）在 `web/src/` 与 `web/tailwind.config.js` 上 0 匹配。

---

## 1. 背景与目标

当前 Capsa Web 管理台采用 Microsoft Fluent 2 设计语言，依赖半透明亚克力模糊层、品牌蓝强调色、4–6px 小圆角与投影卡片建立视觉层次；同时根入口组件直接持有记忆业务的分类状态、导航配置与五个业务视图，全局应用外壳与单一业务模式强耦合。

本次重构在不触碰后端服务、数据库结构、REST 接口契约、MCP 工具与安全策略的前提下，对前端工程实施以下改造：

- **设计体系切换为 Material Design 3（MD3）**：彻底清除亚克力模糊、Fluent 品牌蓝、小圆角与重阴影卡片，建立覆盖亮色与暗色模式的 MD3 系统级色彩角色、五级色调表面（Tonal Surface）、圆角阶梯、排版字阶、原生控件色系声明与状态层体系，以表面明度差承载 Z 轴高度。
- **重写领域中立的基础原语库**：按实际消费边界精炼重构按钮、支持切换选中态的图标按钮、表单控件、字段包装、轮廓/填充卡片、色调徽章、原生模态框与侧边抽屉弹层、骨架与状态反馈原语，统一交互状态层与无障碍语义，不掺杂任何特定业务概念与零消费冗余变体。
- **解耦全局外壳与记忆业务子应用**：将全局鉴权会话守卫、主题持久化控制、弹性顶栏与通用自适应导航容器沉入独立外壳层；将传统记忆模式的导航项配置、分组数据流与五个存量视图（工作台列表与详情、新建/编辑侧边弹层、分类管理、凭据管理、时效复核、回收站）收敛至独立的记忆业务层，通过纯单向属性组合外壳，并在顶栏左右区域预留无死交互的简洁弹性结构，供下一阶段平滑接入工作区切换器与平行子应用。
- **安全契约保真与全量回归**：完整保留会话级凭据存储、401/403 拦截、字段长度校验与正文 XSS 净化管线，通过前后端全量测试并同步更新项目架构文档。

<div style="border:1px solid #d4d4d8;border-radius:12px;padding:18px;margin:16px 0;background:#fafafa;color:#18181b;font-family:system-ui,-apple-system,sans-serif;font-size:13px;line-height:1.5">
  <div style="font-size:12px;font-weight:600;color:#52525b;letter-spacing:0.04em;margin-bottom:12px">前端分层解耦与单向属性装配结构</div>
  <div style="display:grid;grid-template-columns:1fr;gap:12px">
    <div style="border:1px solid #6750A4;border-radius:10px;padding:14px;background:#ffffff">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-weight:600;color:#6750A4">根守卫与全局应用外壳层（Global App Shell）</span>
        <span style="font-size:11px;background:#EADDFF;color:#21005D;padding:2px 8px;border-radius:999px">领域中立 · 单向受控</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:12px;color:#3f3f46">
        <div style="border:1px solid #e4e4e7;border-radius:8px;padding:8px;background:#f8f8fa"><strong>根鉴权与主题守卫</strong><br><span style="font-size:11px;color:#71717a">登录卡片 · 401/403 拦截 · 亮暗持久化</span></div>
        <div style="border:1px solid #e4e4e7;border-radius:8px;padding:8px;background:#f8f8fa"><strong>MD3 顶栏容器</strong><br><span style="font-size:11px;color:#71717a">左侧品牌与标题弹性区 · 右侧身份/主题/退出区</span></div>
        <div style="border:1px solid #e4e4e7;border-radius:8px;padding:8px;background:#f8f8fa"><strong>通用导航骨架</strong><br><span style="font-size:11px;color:#71717a">宽屏 Navigation Rail · 窄屏 Modal Drawer</span></div>
      </div>
    </div>
    <div style="display:flex;justify-content:center;color:#71717a;font-size:12px">↑ 子应用按单向属性传入导航项与激活标识组合外壳（零反向状态同步、零业务反向依赖） ↓</div>
    <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:12px">
      <div style="border:1px solid #a1a1aa;border-radius:10px;padding:14px;background:#ffffff">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-weight:600;color:#18181b">传统记忆业务子应用（本阶段重写交付）</span>
          <span style="font-size:11px;background:#e4e4e7;color:#27272a;padding:2px 8px;border-radius:999px">自治状态与错误恢复</span>
        </div>
        <div style="font-size:12px;color:#52525b">独立声明 5 项业务导航与分组缓存（含加载态与失败重试闭环），承载记忆工作台（检索/筛选/详情/侧边编辑）、分类管理、凭据管理、时效复核与回收站。</div>
      </div>
      <div style="border:1px dashed #d4d4d8;border-radius:10px;padding:14px;background:#f4f4f5;color:#71717a">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-weight:600">后续阶段平行工作区（本阶段禁区）</span>
          <span style="font-size:11px;border:1px solid #d4d4d8;padding:1px 7px;border-radius:999px">严禁预置死入口</span>
        </div>
        <div style="font-size:12px">后续仅需在顶栏弹性区插入切换器并并列复用同一外壳组件，无需推翻顶栏或基础原语。</div>
      </div>
    </div>
  </div>
</div>

---

## 2. 阶段划分

### Phase 1：MD3 语义令牌与领域中立基础原语重构

| 项目 | 内容 |
|------|------|
| **输入** | 现有样式表与原子样式配置、基础原语目录、MD3 色彩/圆角/排版/状态层设计规范 |
| **输出** | 亮暗双模式 MD3 系统级 CSS 变量体系（含原生表单色系声明与迁移期过渡兼容别名）、更新后的原子样式映射配置、精炼且领域中立的基础 UI 原语集合（按钮、带切换选中态的图标按钮、输入/多行文本/下拉选择、表单字段包装、轮廓/填充卡片、色调徽章、原生模态框与侧边抽屉、骨架与空/错/未授权状态） |
| **验收标准** | 根节点切换亮暗属性时五级色调表面、配对前景色与原生日期/下拉控件即时响应且满足对比度；全部基础原语不含记忆领域词汇及未消费冗余变体，原生侧边抽屉具备顶层最大尺寸与边框重置，前端类型检查与生产构建通过且存量页面过渡期可正常渲染 |

### Phase 2：全局应用外壳解耦与自适应导航骨架

| 项目 | 内容 |
|------|------|
| **输入** | Phase 1 交付的 MD3 令牌与基础原语、既有登录鉴权与主题切换逻辑 |
| **输出** | 独立的全局外壳层（登录页、顶栏容器、宽屏侧边导航轨与窄屏模态导航抽屉、纯单向受控外壳组件）及精简后的根入口守卫组件、记忆业务子应用骨架（含分组加载与错误重试状态机） |
| **验收标准** | 根入口组件仅负责鉴权态守卫与主题持久化，不直接引用记忆业务视图或分类列表状态；外壳采用单向属性接收导航配置，无反向同步上下文；窄屏模态导航抽屉跨入桌面断点时自动关闭释放模态锁；分组首屏异常具备可重试横幅且顶栏登出可用；登录 401/403 拦截语义保持一致 |

### Phase 3：传统记忆业务五大存量视图重写与旧令牌收口清零

| 项目 | 内容 |
|------|------|
| **输入** | Phase 1 基础原语、Phase 2 全局应用外壳与记忆子应用骨架、既有 REST 客户端契约与五个存量视图业务逻辑 |
| **输出** | 全面按 MD3 重写的记忆工作台（主从列表栏、筛选芯片栏、扩展浮动操作按钮、详情阅读面板、正文安全渲染、侧边表单抽屉）、分类管理、凭据管理、时效复核与回收站视图，清理遗留旧视图目录并移除 Phase 1 过渡期兼容样式别名 |
| **验收标准** | 全站旧样式类名、过渡兼容变量与毛玻璃属性机械检索清零；主从工作台在桌面双栏与 375px 移动单栏下布局准确，移动端新建/编辑抽屉全屏等宽 375px；字段超限标红、相似标题提示、脏表单关闭确认、单次明文令牌披露、管理员凭据防自锁、空分类安全删除与非空阻断等交互闭环逐项保持 |

### Phase 4：全量回归验证、端到端测试补强与文档同步

| 项目 | 内容 |
|------|------|
| **输入** | 前三阶段完成的全部前端代码、Go 后端单元与集成测试套件、浏览器端到端测试套件、项目基准文档与工作区状态 |
| **输出** | 重新编译嵌入的前端静态产物、补充 MD3 主题切换与窄屏模态抽屉断言后的端到端测试结果、Go 全量测试结果、同步更新为 MD3 架构描述的项目文档与干净的工作区状态 |
| **验收标准** | 前端生产构建零告警通过；Go 全量单元与集成测试 100% 通过且后端源码零改动；浏览器端到端套件全绿通过；项目文档与实际代码完全一致，历史临时文件妥善清理 |

---

## 3. 架构决策

<div style="border:1px solid #d4d4d8;border-radius:12px;padding:18px;margin:16px 0;background:#ffffff;color:#18181b;font-family:system-ui,-apple-system,sans-serif;font-size:12px;line-height:1.5">
  <div style="font-weight:600;color:#52525b;margin-bottom:10px">MD3 四层色调表面（Tonal Surface）Z 轴高度映射</div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
    <div style="border:1px solid #e4e4e7;border-radius:8px;padding:12px;background:#FEF7FF">
      <div style="font-weight:600;color:#1D1B20">Layer 0 · 画布基底</div>
      <div style="color:#6750A4;font-family:monospace;font-size:11px;margin:4px 0">surface</div>
      <div style="color:#49454F;font-size:11px">全屏底层背景与阅读主画布，取代旧浅灰底色。</div>
    </div>
    <div style="border:1px solid #e4e4e7;border-radius:8px;padding:12px;background:#F7F2FA">
      <div style="font-weight:600;color:#1D1B20">Layer 1 · 内容容器</div>
      <div style="color:#6750A4;font-family:monospace;font-size:11px;margin:4px 0">surface-container-low</div>
      <div style="color:#49454F;font-size:11px">工作台列表栏与轮廓卡片，辅以细边框分割，取代重阴影卡片。</div>
    </div>
    <div style="border:1px solid #d4d4d8;border-radius:8px;padding:12px;background:#F3EDF7">
      <div style="font-weight:600;color:#1D1B20">Layer 2 · 导航与框架</div>
      <div style="color:#6750A4;font-family:monospace;font-size:11px;margin:4px 0">surface-container</div>
      <div style="color:#49454F;font-size:11px">顶部应用栏、侧边导航轨、筛选工具区与内联填充块，以纯色调明度差取代亚克力毛玻璃。</div>
    </div>
    <div style="border:1px solid #cac4d0;border-radius:8px;padding:12px;background:#ECE6F0">
      <div style="font-weight:600;color:#1D1B20">Layer 3 · 模态与悬浮</div>
      <div style="color:#6750A4;font-family:monospace;font-size:11px;margin:4px 0">surface-container-high</div>
      <div style="color:#49454F;font-size:11px">居中对话框、侧边表单抽屉与窄屏导航抽屉统一使用高阶容器色配纯暗色遮罩；浮动按钮采用主色容器与轻阴影分离。</div>
    </div>
  </div>
</div>

| 决策项 | 选择 | 理由 | 替代方案（为何不选） |
|--------|------|------|----------------------|
| 组件实现路径 | 基于现有原子样式工具与系统级 CSS 变量构建精炼 MD3 原语 | 零新增运行时依赖，包体积最小，仅定义实际消费的令牌与变体，完全掌控无障碍结构与表单语义 | 引入 Web Components 组件库（处于维护模式，Shadow DOM 会破坏现有表单标签关联与端到端无障碍查询）或预置全量未消费令牌变体（违背 YAGNI） |
| Z 轴层级表达 | 五级色调表面明度阶梯 + 局部轮廓细线，仅浮动操作按钮保留轻阴影 | 严格契合 MD3 核心规范，消除毛玻璃合成开销并在深色模式下提供稳定可读的层次感 | 沿用半透明背景模糊或保留卡片投影变体（违背 MD3 色调表面原则，产生未使用死分支） |
| 桌面与移动导航形态 | 宽屏采用侧边导航轨（Navigation Rail），窄屏采用模态导航抽屉（Modal Navigation Drawer）并监听断点自动释放模态锁 | 5 个同级一级目的地契合导航轨最佳容量（3–7 项），释放更多双栏阅读空间；断点监听避免窄屏打开模态后拉宽窗口导致页面被惰性锁死 | 宽屏常驻宽幅抽屉（挤压双栏工作台）或仅靠样式隐藏已打开的原生模态抽屉（遗留顶层模态锁死隐患） |
| 外壳与业务解耦边界 | 根组件守卫鉴权与主题，记忆子应用通过纯单向属性复用全局外壳并传入自身导航与标题状态 | 严格遵守单一数据源（SSOT），消除父子反向同步上下文与二次渲染，同时在分组首屏加载或报错期间保持顶栏稳定可见 | 引入子向父反向注册上下文（制造镜像状态与顶栏跳变）或在根组件预建工作区插件注册表（违背 YAGNI 的过度设计） |
| 模态与侧边弹层实现 | 基于浏览器原生对话框元素封装居中模态与无多余包裹层的侧边抽屉，显式重置顶层最大宽高与边框 | 原生提供焦点锁定、键盘退出与背景惰性化；省略中间包裹层使左右抽屉各自精确控制窄屏宽度并保持遮罩点击判定准确 | 内层固定全宽包裹容器（会导致左侧导航抽屉吞没遮罩区）或遗漏浏览器默认最大尺寸重置（导致 375px 窄屏抽屉宽度缩水） |
| 扩展状态色与原生控件适配 | 在核心 MD3 角色外补充协调的成功与警示容器色对，并声明亮暗原生色系属性 | 保障凭据有效状态、单次明文披露与过期复核的对比度，同时使原生日期与下拉弹出菜单在暗色模式下自动反色 | 省略原生色系声明（暗色模式下日期选择器图标与下拉白底刺眼） |

---

## 4. 风险清单

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 原生对话框默认最大尺寸/边框未重置或抽屉内层包裹不当，破坏移动端 375px 等宽断言与左侧导航遮罩 | 🔴 高 | 侧边抽屉根节点显式重置最大宽高与零边框，直接渲染业务子节点而不套多余中间容器，使右侧编辑表单在窄屏严格为 375px、左侧导航抽屉保持固定宽度并留出右侧遮罩关闭区 |
| 窄屏打开模态导航抽屉后拉宽视口至桌面端，仅隐藏样式会导致浏览器模态栈继续锁死整页交互 | 🔴 高 | 在导航组件内监听桌面媒体查询断点变化，跨入宽屏时主动触发关闭回调退出原生模态态，不在已打开的模态节点上依赖响应式隐藏类 |
| 分组状态移入记忆子应用后，首次分组请求失败会导致无导航栏且无重试入口的死锁，或首屏快速打开抽屉产生竞态 | 🟡 中 | 记忆子应用在分组就绪前维持外壳顶栏可见但暂不挂载主导航地标：加载中显示骨架，非 401 失败显示带重试的错误横幅，就绪后一次性挂载主导航与工作台视图 |
| 分步重写期间删除旧样式变量造成中间任务页面样式丢失，或收尾遗漏静默失效的旧原子类名 | 🟡 中 | 令牌重写阶段暂留过渡期兼容映射保障每步可独立运行，待全部存量视图迁移完毕后统一移除兼容块并执行覆盖全部旧色彩/字阶类名的正则清零门禁 |
| 未重新产出前端静态资源与可执行文件即运行测试导致验证旧版界面 | 🟡 中 | 验证阶段严格按前端生产构建、Go 二进制重编译、后端测试、浏览器端到端测试的顺序串行执行 |

---

## 5. Phase 依赖关系

<div style="border:1px solid #d4d4d8;border-radius:12px;padding:16px;margin:14px 0;background:#fafafa;color:#18181b;font-family:system-ui,-apple-system,sans-serif;font-size:12px">
  <div style="display:grid;grid-template-columns:1fr 28px 1fr 28px 1fr 28px 1fr;align-items:center;gap:4px">
    <div style="border:1px solid #6750A4;border-radius:8px;padding:10px;background:#ffffff">
      <div style="font-weight:700;color:#6750A4">Phase 1</div>
      <div style="font-weight:600;margin-top:2px">MD3 令牌与基础原语</div>
      <div style="color:#71717a;font-size:11px;margin-top:4px">核心色阶 · 过渡兼容 · 精炼原语</div>
    </div>
    <div style="text-align:center;color:#6750A4;font-weight:700">→</div>
    <div style="border:1px solid #a1a1aa;border-radius:8px;padding:10px;background:#ffffff">
      <div style="font-weight:700;color:#3f3f46">Phase 2</div>
      <div style="font-weight:600;margin-top:2px">全局应用外壳解耦</div>
      <div style="color:#71717a;font-size:11px;margin-top:4px">单向受控外壳 · 导航轨与断点抽屉</div>
    </div>
    <div style="text-align:center;color:#6750A4;font-weight:700">→</div>
    <div style="border:1px solid #a1a1aa;border-radius:8px;padding:10px;background:#ffffff">
      <div style="font-weight:700;color:#3f3f46">Phase 3</div>
      <div style="font-weight:600;margin-top:2px">记忆视图重写与旧令牌收口</div>
      <div style="color:#71717a;font-size:11px;margin-top:4px">5 个业务视图 · 移除过渡别名</div>
    </div>
    <div style="text-align:center;color:#6750A4;font-weight:700">→</div>
    <div style="border:1px solid #a1a1aa;border-radius:8px;padding:10px;background:#ffffff">
      <div style="font-weight:700;color:#3f3f46">Phase 4</div>
      <div style="font-weight:600;margin-top:2px">全量回归与文档同步</div>
      <div style="color:#71717a;font-size:11px;margin-top:4px">构建重编 · Go/E2E 验收 · 文档清理</div>
    </div>
  </div>
</div>

Phase 1 至 Phase 4 按单向依赖顺序推进：设计令牌与原语为外壳和业务视图提供唯一样式基座（并以过渡兼容映射保障中间步骤可运行），单向受控外壳与子应用状态机定型后重写全部存量视图并收口删除旧令牌，最后基于最新编译产物执行前后端回归测试与文档同步。

---

## 6. Subagent 协同规划

对照三维效益模型（任务复杂度、上下文关联度、经济与时间效益）评估本阶段委托需求：

| 阶段 | 上下文依赖 | 并行收益 | 执行主体 | 决策理由 |
|------|-----------|---------|----------|----------|
| Phase 1：令牌与基础原语 | 强（定义全局色彩角色、圆角字阶与原语组件契约） | 无（全局基座，阻塞后续全部改动） | 主线 | 原语签名与令牌命名是后续所有模块的单一事实来源，主线直接定型零沟通损耗 |
| Phase 2：全局应用外壳解耦 | 强（衔接鉴权状态流、单向外壳属性与分组加载状态机） | 无（串行骨架层，体量精炼） | 主线 | 涉及根组件边界划分与顶栏弹性预留约束，主线连续推演可杜绝过度抽象 |
| Phase 3：记忆视图重写与收口 | 强（紧耦合原语变体、旧类名清零门禁及 12 条端到端无障碍契约） | 低（仅涉及 8 个高内聚前端文件，拆分委托需重复传递全部令牌与测试契约） | 主线 | 主线共享完整会话上下文，可一次性保持视觉节奏、状态层与选择器语义一致 |
| Phase 4：回归验证与文档同步 | 中（依赖前序构建产物执行联调验收、文档更新与工作区清理） | 无（收尾闭环链路，串行耗时短） | 主线 | 构建、测试与文档核对回路紧凑，主线直接闭环无需额外冷启动开销 |

> **协同结论**：本次任务聚焦前端单包内的设计体系整体切换与分层重构，模块规模适中且令牌命名、原语接口与端到端无障碍断言高度共享上下文，拆分隔离会话无实质并行加速收益，全流程保留主线执行。

---

> ### Task 拆解预览
>
> 完整原子任务详见 `Tasks.md`。Plan 在此止步，不展开具体文件路径、函数签名与代码细节。
>
> | Phase | 预估 Task 数 | 执行主体 | 目标覆盖 |
> |-------|-------------|----------|----------|
> | Phase 1 | 2 | 主线 | MD3 亮暗双模式 CSS 令牌体系与 Tailwind 配置构建（含过渡兼容映射）；领域中立精炼 UI 原语库重写 |
> | Phase 2 | 2 | 主线 | 单向受控全局应用外壳（顶栏、自适应导航轨/断点模态抽屉、登录页）构建；根入口守卫与记忆子应用状态机解耦 |
> | Phase 3 | 2 | 主线 | 记忆工作台链路（列表、详情、正文渲染、侧边表单）重写；分类/凭据/复核/回收站重写、旧组件与过渡令牌清零 |
> | Phase 4 | 2 | 主线 | 前端构建、Go 重编与测试、浏览器端到端全量验收；项目文档同步维护与历史临时文件清理 |
>
> **总计预估**：8 个原子 Task。
