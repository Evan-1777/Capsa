---
name: frontend-design
description: >-
  Frontend design specifications and workflow: enforces design philosophy selection (Apple HIG, Microsoft Fluent, or Material 3), task-oriented information architecture with progressive disclosure (P0/P1/P2 entry priorities & container selection & context trade-offs), philosophy-aware Z-axis hierarchy (material and light for Apple/Fluent, tonal surfaces for Material 3), native-first component strategy with shadcn/ui as bridge, and document-driven component reuse. Load whenever designing, structuring, or implementing frontend UI.
---

# 前端设计规范与流程 (Frontend Design)

本技能定义前端界面的设计规范与实现流程。在构建任何前端界面前，先明确设计哲学、规划空间层级，遵循组件选型与复用策略，杜绝缺乏层级表达的平铺与同质堆砌。

---

## 一、设计哲学与前置选型

在开始编写代码前，**必须先要求用户从以下三种设计哲学中做出明确选择**（或根据项目既有明确约定执行）：

1. **Apple HIG (Human Interface Guidelines)**
   - **核心特质**：纯净、直观、克制、物理真实感。
   - **材质基调**：纯净画布底色、高品质柔和模糊、细腻微投影、精确的圆角过渡。
2. **Microsoft Fluent Design System**
   - **核心特质**：光感（Light）、深度（Depth）、动效（Motion）、材质（Material）、比例（Scale）。
   - **材质基调**：微纹理/微渐变（Mica 效果）、半透明亚克力（Acrylic 模糊）、标准 4–8px 圆角与层级投影。
3. **Google Material Design 3 (Material You)**
   - **核心特质**：个性化动态取色、跨窗口尺寸自适应、表达性形状与弹簧动效。
   - **材质基调**：以 `surface` / `surface-container-*` 的色调层级表达高度，全圆角按钮与 8dp 间距；投影仅在需要与繁忙背景分离时使用。

### 辅助工具与生态协同
用户会默认提供辅助 Skill 与 MCP 工具配合构建：
- **技能协作**：Fluent 加载 `fluent-design`；Material 3 加载 `material-3`，组件结构、token 与平台规则以其为准。全局前端交付均须遵循 `production-frontend` 的去噪声与成品级表面要求。
- **MCP 工具协作**：利用环境提供的 MCP 服务（如 `fluentui-mcp` 查询 Fluent UI v9 组件 API 与范式，或相关组件库文档 MCP）动态获取精确属性与可运行范例，确保实现与官方最新规范对齐。

---

## 二、信息架构与分层呈现理念（Information Architecture & Hierarchy）

在构建界面结构时，**以任务为导向实施功能聚类与渐进披露**。界面应主次清晰，避免将异质、低频或配置类功能在首屏同层平铺。入口按任务频次与关注度分层后即自解释，不附加引导标注或说明文案（默认使用者为资深用户，见 `production-frontend` 的同名立场）。

### 1. 任务导向的三级优先级模型（P0 / P1 / P2）

将用户交互行为按关注度与使用频次建立清晰的心智分层：

<div style="border: 1px solid #d0d7de; border-radius: 8px; padding: 16px; margin: 16px 0; background: #ffffff; font-family: sans-serif;">
  <div style="font-weight: 600; margin-bottom: 12px; color: #24292f;">任务导向三级优先级模型</div>
  <div style="display: grid; gap: 10px;">
    <div style="border-left: 4px solid #0969da; background: #f6f8fa; padding: 10px 12px; border-radius: 0 6px 6px 0;">
      <div style="font-weight: 600; color: #0969da; font-size: 13px;">P0 核心作业流 / 主画布（Primary Canvas）</div>
      <div style="color: #57606a; font-size: 12px; margin-top: 4px;">承载系统核心价值的高频操作流（如主编辑画布、核心作业列表、实时监控流）。占据一级视口主体，保证核心任务连贯通畅，避免被次级内容平分空间。</div>
    </div>
    <div style="border-left: 4px solid #1a7f37; background: #f6f8fa; padding: 10px 12px; border-radius: 0 6px 6px 0;">
      <div style="font-weight: 600; color: #1a7f37; font-size: 13px;">P1 上下文探索 / 辅助动作（In-context Secondary / Drill-down）</div>
      <div style="color: #57606a; font-size: 12px; margin-top: 4px;">明细钻取、单项编辑、高级过滤与操作历史。通过侧边抽屉或分栏展开呈现，在保持主画布上下文连贯的同时提供深度作业能力。</div>
    </div>
    <div style="border-left: 4px solid #6e7781; background: #f6f8fa; padding: 10px 12px; border-radius: 0 6px 6px 0;">
      <div style="font-weight: 600; color: #57606a; font-size: 13px;">P2 系统配置 / 管理事务（Low-frequency / Settings / Management）</div>
      <div style="color: #57606a; font-size: 12px; margin-top: 4px;">全局参数、环境切换、成员权限等低频管理事务。收敛至二级设置中心或专用子视图，不占用一级作业视口。</div>
    </div>
  </div>
</div>

- **首屏聚焦**：首屏明确呈现核心高频主路径，让用户直接感知主作业流。
- **渐进披露**：进阶与辅助能力顺应交互意图按需呈现，减少非必要的信息负荷。

### 2. 容器选型与上下文权衡（Container Selection & Context Trade-offs）

依据任务深度与上下文连续性需求选择容器形式：

| 任务场景 | 推荐容器 | 交互考量与设计意图 |
|---|---|---|
| **P0 高频核心作业** | 一级主视口画布（Primary Canvas） | 视口主体，承载核心数据与高频动作，保持作业流畅无阻断 |
| **P1 明细查看 / 局部编辑** | 侧边抽屉 / 分栏（Drawer / Split-view） | 保持主画布上下文可见，随查随关，降低来回跳转心智负担 |
| **P1 即时确认 / 短表单** | 模态弹窗（Modal / Dialog） | 聚焦视线，阻断底层交互，适用于少量字段输入或破坏性操作确认 |
| **P1 复杂长流程装配** | 引导向导（Step Wizard） | 步骤条驱动分步流转，适合阶段性配置与明确的状态暂存 |
| **P2 系统配置 / 批量运维** | 二级设置中心 / 独立子视图（Sub-page） | 专用于全局性低频维护，提供清晰的导航分类与确定性保存机制 |

### 3. Demo 原型交互感知

在 `Main-hybrid(Frontend)` 规划段或原型设计阶段产出 `temp/*.html` 时：
- **空间感知**：为分层容器（如抽屉、模态）提供基础显隐开合交互，以便直观评估展开后的主副空间占比、视觉层级与遮罩明暗。
- **范围克制**：原型重点在于验证排版节奏与层级关系，不编写无关的复杂数据流或业务校验逻辑。

---

## 三、空间布局与 Z 轴层级（Z-index Layers）

在开始编写页面结构与样式前，先规划界面的 Z 轴层级。层级必须可辨，但表达方式随设计哲学而变：Apple/Fluent 以材质、模糊与光影区分；Material 3 以 tonal surface 色阶与 shape/elevation token 区分。避免无层级的单层平铺。

### 四层层级标准与材质规则

| 层级 | 定位与构件 | Apple HIG | Microsoft Fluent | Material 3 | 共性要点 |
|---|---|---|---|---|---|
| **Layer 0**（背景层） | 整体画布基底 | 纯净底色（如浅灰 `#F5F5F7`、深色 `#000000`） | 类 Mica 微纹理/微渐变底色（如 `#F3F3F3` 至 `#EBEBEB`） | `surface` 或 `surface-dim` | 全屏底层画布，不直接放置交互零散内容 |
| **Layer 1**（内容层） | 主内容容器、卡片、数据板 | 半透明白/黑底色（如 `bg-white/80`），搭配微弱背景差异与圆角 | 浅色卡片底色（如 `#FFFFFF`），搭配高阶中性底色与微边框 | `surface-container-low` / `surface-container` | Apple/Fluent 用轻投影与底色反差；MD3 用色阶 |
| **Layer 2**（悬浮/框架层） | 侧边栏、顶部导航、工具栏、底部操作/输入条 | 高度模糊毛玻璃（`backdrop-blur-md/lg`），物理悬浮感 | 半透明 Acrylic 材质，带特定着色与材质杂色 | `surface-container` / `surface-container-high` | Apple/Fluent 用毛玻璃/半透明 + **1px 高光边框**；MD3 用色阶，不叠阴影 |
| **Layer 3**（模态层） | 模态弹窗、对话框、浮动下拉菜单、Toast | 强对比深层阴影 + 全屏遮罩与微模糊 | Depth 16/64 阴影 + 暗色遮罩 | `surface-container-highest` + scrim，必要时 elevation 3/4 | 统一需要遮罩；Apple/Fluent 用深阴影，MD3 用更高色阶 |

Material 3 的 elevation 以 tonal surface 为主，shadow 只在需要与基础背景分离时使用；token、组件与平台限制见 `material-3`。

---

## 四、组件选型路径：原生优先与桥接策略

在具体 UI 组件实现上，建立明确的选型优先级阶梯，杜绝随意堆砌非标准组件：

<div style="border: 1px solid #d0d7de; border-radius: 8px; padding: 16px; margin: 16px 0; background: #ffffff; font-family: sans-serif;">
  <div style="font-weight: 600; margin-bottom: 8px; color: #24292f;">组件选型决策路径</div>
  <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
    <div style="border: 1px solid #0969da; background: #ddf4ff; color: #0969da; padding: 8px 12px; border-radius: 6px; font-weight: 600; font-size: 13px;">
      1. 所选风格原生组件库（首选）
    </div>
    <div style="color: #57606a; font-weight: bold;">➔</div>
    <div style="border: 1px solid #1a7f37; background: #dafbe1; color: #1a7f37; padding: 8px 12px; border-radius: 6px; font-weight: 600; font-size: 13px;">
      2. shadcn/ui 组件库（通用桥梁）
    </div>
    <div style="color: #57606a; font-weight: bold;">➔</div>
    <div style="border: 1px solid #d0d7de; background: #f6f8fa; color: #24292f; padding: 8px 12px; border-radius: 6px; font-size: 13px;">
      3. 风格化令牌与层级表达
    </div>
  </div>
</div>

1. **原生组件优先**
   - 若项目选定 Microsoft Fluent 风格，且技术栈具备条件，优先使用 **Fluent UI (如 Fluent UI React v9)** 官方原生组件。
   - 若项目选定 Apple 风格，优先使用遵循 Apple HIG 规范的原生封装或等价组件。
   - 若项目选定 Material 3，优先使用 `@material/web`（维护模式）或按 MD3 token 自建组件；React/Vue/Svelte 无官方组件库，使用 CSS custom properties 与等价封装。
2. **shadcn/ui 作为通用桥梁**
   - 默认使用 **shadcn/ui** 作为基础桥梁。
   - 在无原生组件或需要灵活扩展时，基于 shadcn/ui 的原子组件（Button, Dialog, Popover, Card, Input 等），按照选定哲学（Apple / Fluent / Material 3）注入层级表达：Apple/Fluent 用材质、圆角、阴影与高光；MD3 用 `--md-sys-*` token（color roles、shape、typescale），不引入 MD3 之外的毛玻璃或投影。

---

## 五、文档驱动与组件复用

为了确保界面系统的一致性并降低维护成本，开发过程必须严格遵循文档驱动：

1. **充分阅读用户提供的文档与组件要求**
   - 在实现任何模块前，先检索并阅读用户提供的相关技术文档、设计文档（如 `.docs/` 或设计稿标注）。
   - 查阅项目现有组件库目录（如 `components/`、`src/components/ui/`），理清现有组件的 API、Props 约定与命名规范。
2. **坚持高组件复用度**
   - 严禁在页面中随意编写同质化的重复结构（如重复编写自定义卡片、重复实现模态框外壳）。
   - 优先复用已有组件；若现有组件能力不足，以规范扩展（如扩展 Props、变体 Variant）替代复制粘贴。
3. **保持全局交互与视觉一致性**
   - 统一同类构件的内边距、外边距、圆角与层级表达：Apple 偏平滑大圆角与柔和阴影，Fluent 偏 4–8px 与 Acrylic/Mica，MD3 使用 `--md-sys-shape-*` token 与 tonal surface；过渡时长按所选哲学统一。

---

## 六、执行清单与自查红线

每次交付前端界面前，进行以下检查：

- [ ] **风格确认**：是否已在 Apple HIG、Microsoft Fluent 与 Material 3 之间明确主风格？
- [ ] **架构主次**：首屏是否主线清晰，辅助与低频能力是否合理分层呈现？功能入口是否自解释，有无额外上手引导标注？
- [ ] **层级规划**：是否已按 Layer 0–3 规划层级，且层级表达符合所选哲学（Apple/Fluent 用材质与光影；MD3 用 tonal surface 与 shape）？
- [ ] **层级可辨**：是否避免单层平铺？Apple/Fluent 的悬浮栏与卡片是否有材质或投影反差；MD3 是否使用 `surface-container-*` 色阶而非依赖阴影？
- [ ] **MD3 令牌**（若适用）：颜色、形状与排版是否使用 `--md-sys-*` / `md.sys` 角色，而非硬编码？
- [ ] **组件阶梯**：是否优先使用了风格原生组件（Fluent UI / Apple 原生 / `@material/web` 或 token 化组件）？非原生组件是否经由 shadcn/ui 进行了正确风格化？
- [ ] **原型感知**：若产出 temp/ 原型，分层容器是否支持基础开合以验证空间节奏？
- [ ] **复用与规范**：是否查阅并遵循了用户提供的文档与已有组件规范？
