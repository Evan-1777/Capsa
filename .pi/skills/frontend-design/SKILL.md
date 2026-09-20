---
name: frontend-design
description: >-
  Frontend design specifications and workflow: enforces design philosophy selection (Apple HIG vs Microsoft Fluent), 4-tier Z-index physical material & light hierarchy, native-first component strategy with shadcn/ui as bridge, and document-driven component reuse. Load whenever designing, structuring, or implementing frontend UI.
---

# 前端设计规范与流程 (Frontend Design)

本技能定义前端界面的设计规范与实现流程。在构建任何前端界面前，先明确设计哲学、规划物理层级，遵循组件选型与复用策略，杜绝无深度的扁平色块堆砌。

---

## 一、设计哲学与前置选型

在开始编写代码前，**必须先要求用户从以下两种设计哲学中做出明确选择**（或根据项目既有明确约定执行）：

1. **Apple HIG (Human Interface Guidelines)**
   - **核心特质**：纯净、直观、克制、物理真实感。
   - **材质基调**：纯净画布底色、高品质柔和模糊、细腻微投影、精确的圆角过渡。
2. **Microsoft Fluent Design System**
   - **核心特质**：光感（Light）、深度（Depth）、动效（Motion）、材质（Material）、比例（Scale）。
   - **材质基调**：微纹理/微渐变（Mica 效果）、半透明亚克力（Acrylic 模糊）、标准 4–8px 圆角与层级投影。

### 辅助工具与生态协同
用户会默认提供辅助 Skill 与 MCP 工具配合构建：
- **技能协作**：若选择 Fluent 体系，协同加载 `fluent-design` 技能以获取完整色彩令牌与排版规范；全局前端交付均须遵循 `production-frontend` 的去噪声与成品级表面要求。
- **MCP 工具协作**：利用环境提供的 MCP 服务（如 `fluentui-mcp` 查询 Fluent UI v9 组件 API 与范式，或相关组件库文档 MCP）动态获取精确属性与可运行范例，确保实现与官方最新规范对齐。

---

## 二、空间布局与 Z 轴物理层级（Z-index Layers）

在开始编写页面结构与样式前，**必须先规划界面的 Z 轴物理层级。严禁使用单一平铺布局，严禁大量偷懒使用扁平纯色块**。每个层级之间必须具有明显的材质或光影差异。

<div style="border: 1px solid #d0d7de; border-radius: 8px; padding: 16px; margin: 16px 0; background: #fafafa; font-family: sans-serif;">
  <div style="font-weight: 600; margin-bottom: 12px; color: #24292f;">Z 轴空间物理层级模型</div>
  <div style="display: flex; flex-direction: column; gap: 8px;">
    <div style="border: 1px solid #d0d7de; border-radius: 6px; padding: 10px; background: #ffffff; box-shadow: 0 8px 24px rgba(0,0,0,0.12);">
      <span style="font-weight: 600; color: #0969da;">Layer 3（模态层）</span>：深层阴影（shadow-lg/xl）+ 明确遮罩（Overlay），承载弹窗、抽屉、下拉菜单
    </div>
    <div style="border: 1px solid rgba(255,255,255,0.4); border-radius: 6px; padding: 10px; background: rgba(255,255,255,0.75); backdrop-filter: blur(12px); box-shadow: 0 4px 12px rgba(0,0,0,0.06);">
      <span style="font-weight: 600; color: #1a7f37;">Layer 2（悬浮/框架层）</span>：毛玻璃（backdrop-blur）/ Acrylic 半透明 + 1px 高光边框（border-white/40），承载侧边栏、工具栏、底部输入框
    </div>
    <div style="border: 1px solid #e1e4e8; border-radius: 6px; padding: 10px; background: rgba(255,255,255,0.85); box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
      <span style="font-weight: 600; color: #9a6700;">Layer 1（内容层）</span>：微弱背景反差（如 bg-white/80）+ shadow-sm，承载主内容区、业务卡片、数据表格
    </div>
    <div style="border: 1px dashed #d0d7de; border-radius: 6px; padding: 10px; background: #f6f8fa;">
      <span style="font-weight: 600; color: #57606a;">Layer 0（背景层）</span>：整体画布底色。Apple：纯净底色；Fluent：类 Mica 微纹理/微渐变
    </div>
  </div>
</div>

### 四层层级标准与材质规则

| 层级 | 定位与构件 | Apple HIG 材质表现 | Microsoft Fluent 材质表现 | 通用样式要点（如 Tailwind） |
|---|---|---|---|---|
| **Layer 0**（背景层） | 整体画布基底 | 纯净底色（如浅灰 `#F5F5F7`、深色 `#000000`） | 类似 Mica 的带微纹理/微渐变底色（如 `#F3F3F3` 至 `#EBEBEB` 微渐变） | 作为全屏底层画布，不直接放置交互零散内容 |
| **Layer 1**（内容层） | 主内容容器、卡片、数据板 | 半透明白/黑底色（如 `bg-white/80`），搭配微弱背景差异与圆角 | 浅色卡片底色（如 `#FFFFFF`），搭配高阶中性底色与微边框 | 必须使用 `shadow-sm` 与微弱背景差异脱离背景层 |
| **Layer 2**（悬浮/框架层） | 侧边栏、顶部导航、工具栏、底部操作/输入条 | 高度模糊毛玻璃材质（`backdrop-blur-md/lg`），物理悬浮感 | 半透明 Acrylic 材质，带有特定着色与材质杂色效果 | 必须使用毛玻璃/半透明材质，且带有 **1px 高光边框**（如 `border-white/40` 或深色微高光） |
| **Layer 3**（模态层） | 模态弹窗、对话框、浮动下拉菜单、Toast | 强对比深层阴影，背景半透明全屏遮罩与微模糊 | 明确的 Depth 16/64 深度阴影，配合暗色遮罩层 | 必须带有更深阴影（`shadow-lg` 或 `shadow-xl`）与遮罩层 |

---

## 三、组件选型路径：原生优先与桥接策略

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
      3. 风格化令牌与材质注入
    </div>
  </div>
</div>

1. **原生组件优先**
   - 若项目选定 Microsoft Fluent 风格，且技术栈具备条件，优先使用 **Fluent UI (如 Fluent UI React v9)** 官方原生组件。
   - 若项目选定 Apple 风格，优先使用遵循 Apple HIG 规范的原生封装或等价组件。
2. **shadcn/ui 作为通用桥梁**
   - 默认使用 **shadcn/ui** 作为基础桥梁。
   - 在无原生组件或需要灵活扩展时，基于 shadcn/ui 的原子组件（Button, Dialog, Popover, Card, Input 等），按照选定的设计哲学（Apple 或 Fluent）注入对应的四层 Z 轴材质、圆角、阴影与边框高光，使其完全契合主风格。

---

## 四、文档驱动与组件复用

为了确保界面系统的一致性并降低维护成本，开发过程必须严格遵循文档驱动：

1. **充分阅读用户提供的文档与组件要求**
   - 在实现任何模块前，先检索并阅读用户提供的相关技术文档、设计文档（如 `.docs/` 或设计稿标注）。
   - 查阅项目现有组件库目录（如 `components/`、`src/components/ui/`），理清现有组件的 API、Props 约定与命名规范。
2. **坚持高组件复用度**
   - 严禁在页面中随意编写同质化的重复结构（如重复编写自定义卡片、重复实现模态框外壳）。
   - 优先复用已有组件；若现有组件能力不足，以规范扩展（如扩展 Props、变体 Variant）替代复制粘贴。
3. **保持全局交互与视觉一致性**
   - 统一同类构件的内边距、外边距、圆角（Apple 偏平滑大圆角，Fluent 偏 4–8px）、高光边框透明度与过渡动效时长。

---

## 五、执行清单与自查红线

每次交付前端界面前，进行以下检查：

- [ ] **风格确认**：是否已在 Apple HIG 与 Fluent 之间明确主风格？
- [ ] **层级规划**：是否已按 Layer 0–3 规划层级，且每一层均有明确的材质、模糊或阴影反差？
- [ ] **拒绝纯色块**：悬浮栏是否带有毛玻璃与 1px 高光边框？卡片是否具备合理的背景半透明/投影？
- [ ] **组件阶梯**：是否优先使用了风格原生组件？非原生组件是否经由 shadcn/ui 进行了正确风格化？
- [ ] **复用与规范**：是否查阅并遵循了用户提供的文档与已有组件规范？
