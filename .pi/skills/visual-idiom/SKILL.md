---
name: visual-idiom
description: >-
  Visual design spec for frontend deliverables on shadcn/ui (Radix + Tailwind
  CSS) with Geist fonts. Zinc neutral scale, dual accents (blue = interaction,
  red = attention), three background tiers, three-tier elevation ladder,
  frameless cards, glass for floating layers, layout grammar for hierarchy,
  and one-time setup contracts. Not loaded by default — load only when the user
  names this skill or explicitly asks for shadcn/ui visual styling.
---
# 视觉语言规范（shadcn/ui × Geist）
## 架构分工
| 层 | 来源 | 职责 |
|---|---|---|
| 交互与无障碍 | Radix（shadcn 底座） | 键盘导航、焦点管理、浮层定位 |
| 组件模板 | shadcn/ui | 原子组件结构与插槽，`npx shadcn@latest add <component>` 引入 |
| 视觉 Token | 本规范 | 经 Tailwind 变量与工具类全局注入，不逐组件调色 |
| 页面组装 | Agent | 版式编排与业务数据填充，组件引用 `@/components/ui/*` |
Modal、Dropdown、Popover 等交互组件不自写逻辑，一律用 shadcn 实现。
初始化按附录执行一次，此后基建冻结，Agent 只写页面与业务组件。
## Token
Token 表是唯一数值来源，其余章节只引用名称，不重复数值。
| 类别 | 值 |
|---|---|
| 字体 | Geist Sans / Geist Mono（npm 包 `geist`），挂 `font-sans` / `font-mono` |
| 字号 | 12 辅助 · 13 正文 · 14 重点正文 · 16 小标题 · 20 区块标题 · 28 页面标题 |
| 字重 | 400 正文 · 600 标题 |
| 行高 | 正文 1.6 · 标题 1.3 |
| 间距 | 4 的倍数，常用 8 / 12 / 16 / 24 / 32 / 48 |
| 圆角 | 4 小件 · 6 按钮/卡片 · 8 容器 · 12 顶层容器；嵌套同圆心：外圆角 = 内圆角 + 内边距 |
| 灰阶（zinc） | 50 #fafafa · 100 #f4f4f5 · 200 #e4e4e7 · 400 #a1a1aa · 500 #71717a · 600 #52525b · 700 #3f3f46 · 900 #18181b，不混其他灰血统 |
| 文字 | 主 zinc-900 · 次 zinc-700 · 辅 zinc-500 · 弱 zinc-400（仅占位与禁用态） |
| 背景 | 页面 zinc-100 · 面板 zinc-50（侧栏/表头/次级面板）· 内容 #fff |
| 边框 | 控件与表格容器描边 zinc-200 · 行内分隔 zinc-100，均 1px |
| 蓝阶（交互） | 50 #eff6ff 选中底 · 600 #2563eb 主色与 ring · 700 #1d4ed8 hover，加深只有 600→700 |
| 红阶（注意） | 50 #fef2f2 警示底 · 600 #dc2626 · 700 #b91c1c hover，加深只有 600→700 |
| 成功 | #16a34a，仅成功状态 |
| 阴影 | e1（卡片默认）`0 1px 2px rgba(0,0,0,.04), 0 2px 8px rgba(0,0,0,.04)` · e2（抬升）`0 2px 6px rgba(0,0,0,.06), 0 8px 20px rgba(0,0,0,.05)` · e3（浮层）`0 4px 16px rgba(0,0,0,.08)`，全部单色黑 |
颜色、灰阶、阴影只用语义类名（`bg-card`、`border-input`）或 zinc/blue/red
序列类名，不手写 hex 值。
## 双强调色
蓝回答"这里能点吗"，红回答"这里要留心吗"：
- 蓝：链接、可点元素、选中态、focus ring、激活 tab。蓝即交互，交互即蓝。
- 红：关键数字、警示徽标、危险按钮、错误提示。红不表示可点，不作大面积色块。
- 灰阶承担约 90% 的界面面积，强调色辨识度来自无彩与有彩的色相差。
  颜色不表达"重要"，重要用字重与位置表达。
## 层级与版式
层级手段优先级：间距 > 字重 > 字号 > 边框 > 颜色。每页实际出现字重对比
（400 vs 600）与字号跨级（13 与 20 同屏）；分层不用底色色块，
不用连续多级字号堆叠。
- 分组 ≥ 3 层：页面 → 区块 → 卡片/行。
- 间距节奏：同层一致，跨层差 ≥ 2 倍。参考配比：区块间 32–48，
  卡片内边距 16–24，卡内元素 8–12。
- 视觉锚点：每页一个页面级标题（28/600），区块标题 20/600。
- 内容超两屏不用纯单列等宽卡片，采用非对称双栏（主区 1fr +
  侧栏 280–360px）、栅格 span 差异、页头/主区/底栏分区、tabs、
  主从列表之一以上。
- 同页区块形态混用（表格、卡片、列表、键值对），不全部渲染为卡片。
- 对齐：同容器直接子元素的左边缘或中心线可对齐。
## 材质与分界
| 层 | 场景 | 背景 | 阴影 |
|---|---|---|---|
| L0 | 页面底 | zinc-100 | 无 |
| L0 | 面板（侧栏、表头、次级面板） | zinc-50 | 无 |
| L1 | 卡片 | #fff | e1 |
| L2 | 卡片 hover、拖拽中 | #fff | e2，过渡 150ms |
| L3 | 弹窗、命令面板、下拉 | 玻璃 | e3 |
- 卡片默认无框：白卡浮于 zinc-100 页面底，e1 承担边界。
  有框仅限表单控件与表格容器（描边 zinc-200）。
- 线条只保留三职：行内 inset 分隔（zinc-100，不贯穿容器 padding）、
  控件描边、表格容器描边。组间分界用留白（≥ 24px）或卡片阴影边界，
  结构性边框每页 ≤ 2 处。
- 玻璃配方（L3 专用，宿主须为浮层且下方有滚动内容）：
  `bg-white/72 backdrop-blur-[12px]` + `shadow-glass`
  （e3 + `inset 0 1px 0 rgba(255,255,255,.5)` 顶光）。
  inset 顶光只出现在玻璃材质上。
## 状态完整性
- 可交互元素四态齐全：hover / active / focus-visible
  （`ring-2 ring-ring ring-offset-2`）/ disabled。
- 列表与数据容器处理加载态（Skeleton）与空状态
  （一句说明 + 一个引导操作）。
- 行 hover 用 zinc-100，选中行用 blue-50，两者不混。
## 不变量
交付前核对：
- 灰值全部在 zinc 表内；强调色色相只有蓝、红；阴影只有三档配方，
  无彩色阴影。
- 卡片无框 + e1，浮层玻璃或 e3，控件与表格容器有描边。
- 蓝只在交互与选中，红只在注意级。
- 分组 ≥ 3 层、跨层间距 ≥ 2 倍同层、长页无纯单列、形态混用。
- 交互组件来自 `@/components/ui/*`，四态齐全。
## 例外
外部设计稿、品牌规范、组件库优先，本规范补其未定义部分。
深色模式、营销页、数据可视化配色单独按需处理。
非 React 环境下 Token 与材质规则照常适用，组件按等价原则实现。
---
## 附录：初始化（执行一次）
```bash
npm install geist
npx shadcn@latest init
npx shadcn@latest add button card dialog dropdown-menu popover table tabs input select badge skeleton command
```
globals.css 注入（与 Token 对齐）：
```css
@layer base {
  :root {
    --background: 240 4.8% 95.9%;
    --foreground: 240 10% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 240 10% 3.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 240 10% 3.9%;
    --muted: 240 4.8% 95.9%;
    --muted-foreground: 240 3.8% 46.1%;
    --border: 240 5.9% 90%;
    --input: 240 5.9% 90%;
    --primary: 221.2 83.2% 53.3%;
    --primary-foreground: 0 0% 100%;
    --ring: 221.2 83.2% 53.3%;
    --radius: 0.375rem;
  }
}
```
tailwind.config 注册：
```js
theme: {
  extend: {
    fontFamily: {
      sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
      mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
    },
    boxShadow: {
      'e1': '0 1px 2px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.04)',
      'e2': '0 2px 6px rgba(0,0,0,0.06), 0 8px 20px rgba(0,0,0,0.05)',
      'e3': '0 4px 16px rgba(0,0,0,0.08)',
      'glass': '0 4px 16px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.5)',
    },
  },
}
```
Card 引入后改一次默认值：`rounded-lg bg-card text-card-foreground shadow-e1`
（去 border）。基建至此冻结。
