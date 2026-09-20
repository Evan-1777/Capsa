# Plan: Phase 8 Web 管理台审阅意见收敛与死代码清理

> 状态：DONE  
> 完成日期：2026-09-20  
> 回归测试结论：前端 `tsc --noUnusedLocals --noUnusedParameters && vite build` 通过；Playwright 12/12 passed (13.3s)；pytest 209/209 passed (33.56s)。

## 1. 目标与背景

针对 Phase 8 交付后的代码审阅意见，批判性吸收核心建议，剔除过度设计与过度防御，消除无用零件与分支，对齐排版阶单一事实来源，补齐 HTML 列表语义与深色模式高对比度，接入首帧防闪烁，归位 1Panel 部署文档。

## 2. 交付范围

- UI 原语层清理：剔除 Card 的 clickable/selected，剔除 Dialog 的 drawer，剔除 Button 的 subtle。
- 样式令牌精简：移除未使用的 shadow-flyout 与 stroke-strong；建立 --color-fill-foreground 支撑深色模式 WCAG AAA 对比度。
- 排版阶收敛：将全库硬编码 text-[13px] 收敛为 text-body 语义类。
- HTML 语义合规：ReviewCenter 与 RecycleBin 容器改为 `<Card as="ul" role="list">` 并移除 li 补丁类。
- 首帧防闪烁：在 index.html 注入 3 行内联脚本，优先从 localStorage 与系统媒体查询挂载 data-theme。
- 部署文档与架构同步：登记 docs/1panel-deployment-guide.md 并纳入跟踪。
