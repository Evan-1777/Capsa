# Tasks: Quick 修复与审阅收敛

> 状态：DONE  
> 完成日期：2026-09-20  
> 回归测试结论：前端 tsc 严格校验与构建通过；Playwright 12 用例全绿 (13.3s)；后端 209 用例全绿 (33.56s)。

## 任务列表

- [x] **TASK-001: 清理 UI 原语(Card/Dialog/Button)未消费代码与死分支**
  - **状态**：DONE
  - **涉及文件**：`web/src/components/ui/Card.tsx`, `web/src/components/ui/Dialog.tsx`, `web/src/components/ui/Button.tsx`
  - **Details**：
    1. Card: 移除未使用的 `clickable` 与 `selected` prop 及关联分支；`as` 支持 `"div" | "article" | "ul" | "ol" | "li"`。
    2. Dialog: 移除未使用的 `drawer` prop 及分支，让 Dialog 聚焦于 Modal 弹窗。
    3. Button: 移除未使用的 `subtle` 变体；实心按钮文字使用 `text-fill-foreground` 语义前景。
  - **验收标准**：`tsc --noEmit` 无报错，Button/Card/Dialog API 规范克制。

- [x] **TASK-002: 精简样式令牌并建立深色高对比填充文字令牌**
  - **状态**：DONE
  - **涉及文件**：`web/src/styles/index.css`, `web/tailwind.config.js`
  - **Details**：
    1. 移除 0 引用的 `--shadow-flyout`、`--color-stroke-strong`、`text-subtitle`、`text-title`。
    2. 定义 `--color-fill-foreground: #FFFFFF`，在深色下为 `#1F1F1F`；映射至 tailwind `fill-foreground`。
    3. 将 `.text-body` 定义为 13px / 20px，与实际正文字阶单一事实来源完全对齐。
    4. 移除 `tailwind.config.js` 中未使用的 `stroke-strong` 与 `transitionDuration.fast`。
  - **验收标准**：CSS 令牌与 Tailwind 配置精简无死定义。

- [x] **TASK-003: 收敛 Markdown 与工作台视图正文字号至 text-body**
  - **状态**：DONE
  - **涉及文件**：`web/src/components/Markdown.tsx`, `web/src/components/MemoryList.tsx`, `web/src/components/MemoryDetail.tsx`
  - **Details**：
    1. `Markdown.tsx`、`MemoryList.tsx`、`MemoryDetail.tsx` 中的 `text-[13px]` 替换为 `text-body`。
  - **验收标准**：上述 3 文件中零硬编码 `text-[13px]`。

- [x] **TASK-004: 收敛分组/凭据视图正文字号至 text-body 并清除未使用导入**
  - **状态**：DONE
  - **涉及文件**：`web/src/components/GroupManager.tsx`, `web/src/components/KeyManager.tsx`
  - **Details**：
    1. 将两文件中的 `text-[13px]` 替换为 `text-body`。
    2. 移除 `KeyManager.tsx` 中未使用的 `Key` 图标导入。
  - **验收标准**：`npx tsc --noEmit --noUnusedLocals` 无未使用变量或导入警告。

- [x] **TASK-005: 修复复核中心与回收站的列表合法 HTML 语义**
  - **状态**：DONE
  - **涉及文件**：`web/src/components/ReviewCenter.tsx`, `web/src/components/RecycleBin.tsx`
  - **Details**：
    1. 将外层 `<Card>` 声明为 `<Card as="ul" role="list" ...>`。
    2. 移除内层 `<li>` 上的 `list-none` 补丁。
    3. 将两文件中的 `text-[13px]` 替换为 `text-body`。
  - **验收标准**：无 `<div><li>` 非法嵌套，屏幕阅读器与 HTML 验证语义合规。

- [x] **TASK-006: 接入首帧防闪烁脚本并登记维护部署文档与项目架构**
  - **状态**：DONE
  - **涉及文件**：`web/index.html`, `.docs/Project.md`
  - **Details**：
    1. 在 `web/index.html` 的 `<head>` 中注入内联主题读取脚本，首帧设置 `data-theme`。
    2. 更新 `.docs/Project.md` 登记 `docs/1panel-deployment-guide.md`，更新令牌与原语变更记录。
  - **验收标准**：首帧脚本就位，文档与仓库文件 100% 同步。