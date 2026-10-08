---
name: fluent-design
description: >-
  Visual design spec for Microsoft Fluent 2 deliverables — Segoe UI type ramp,
  the #0078D4 brand blue, semantic alias tokens, depth via elevation and
  materials (Acrylic / Mica), 4–8px radii, and light/dark token sets. Not loaded
  by default — load only when the user names Fluent 2 / WinUI / Microsoft 365
  styling or explicitly asks for this design system.
---

# 设计系统：Microsoft (Fluent)

## 令牌

```yaml
colors:
  background: "#ffffff"
  foreground: "#242424" # colorNeutralForeground1
  brand: "#0078d4"      # colorBrandBackground
  muted: "#616161"      # colorNeutralForeground2
  border: "#e0e0e0"     # colorNeutralStroke1
  card: "#ffffff"
  accent: "#0078d4"

  dark:
    background: "#1f1f1f" # colorNeutralBackground1
    foreground: "#ffffff"
    muted: "#d1d1d1"
    border: "#444444"
    card: "#292929"
    accent: "#479ef5"

typography:
  fontFamily:
    sans: "Segoe UI, system-ui, -apple-system, sans-serif"
    mono: "Cascadia Code, Consolas, monospace"
  body:
    fontSize: "14px"
    lineHeight: "1.42"
    fontWeight: "400"
  heading:
    fontWeight: "600"
    letterSpacing: "-0.01em"

rounded:
  default: "4px"
  md: "6px"
  lg: "8px"
```

## 概述

Fluent 2 是 Microsoft 的跨平台设计系统，建立在 Light、Depth、Motion、Material、Scale 五项原则之上，目标是在每类设备上都呈现自然、直观的体验。

## 设计哲学

1. **深度与分层**：用投影与材质（Mica、Acrylic）建立层级与焦点。
2. **自适应且一致**：在 Windows、iOS、Android 与 Web 上均显得自然，同时保持可辨认的 Microsoft 身份。
3. **默认包容**：对比度、焦点态、屏幕阅读器支持内建于每个基础组件与令牌。
4. **高效的优雅**：以清晰的排版与一致的间距支撑专业、数据密集的应用。

## 颜色

- **Microsoft 蓝（#0078D4）**：用于主操作与品牌呈现，兼具专业感与通用性。
- **语义令牌**：大量使用别名令牌（如 `colorNeutralBackground1`），使颜色在浅色、深色与高对比模式下都能正确适配。
- **克制的分层**：深色模式使用高阶灰（#1F1F1F 至 #292929）而非纯黑，为柔和的深度与投影留出空间。

## 排版

- **Segoe UI**：Microsoft 体验的基石，人文主义无衬线体，为高可读性与友好、开放的观感而设计。
- **可预期的层级**：使用标准化的 Type Ramp（Caption 至 Display），保证层级一致。

## 组件

- **卡片与表面**：常使用 Depth 4 或 Depth 8 投影，使其从背景中浮起。
- **按钮**：圆角 4px 至 6px，交互态（Hover、Pressed）由明确的令牌切换定义。
- **导航栏**：用于应用级切换的极简垂直导航模式。

## 视觉效果

- **Acrylic 与 Mica**：半透明模糊背景（Acrylic），以及采样桌面壁纸的 Mica 材质，营造与系统融合的高级感。
- **柔和投影**：多层柔和投影，模拟真实光源。
- **动效**：有目的的快速过渡（通常 150–250ms），提供反馈而不拖慢操作。

## 与 fluentui-mcp 的分工

本技能承载设计系统与视觉令牌；组件级 props、可运行示例与 API 细节经 `blendsdk/fluentui-mcp` 获取。该 MCP 由使用者自行安装，本仓库不落盘其文件。

## 加载契约

外部设计稿、品牌规范、组件库优先，本规范补其未定义部分。深色模式、营销页、数据可视化配色按需单独处理。非 React 环境下令牌与材质规则照常适用，组件按等价原则实现。
