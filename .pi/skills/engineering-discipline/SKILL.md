---
name: engineering-discipline
description: >-
  Engineering discipline for changing existing work. Resolve root causes at the
  structural source instead of patching symptoms at the call sites; keep design
  normative and restrained instead of defensively bloated; hold the blast radius
  small and prefer the shortest working diff. Load whenever modifying or
  maintaining code (frontend or backend) or documentation — bug fixes,
  refactors, rule/prompt/workflow edits, doc updates.
---

# 工程纪律与通用生产哲学 (Engineering Discipline)

本技能约束 Agent 对**既有代码与文档的一切修改与维护**（前后端代码、Bug 修复、架构演进、API 设计、规则/提示词/工作流编辑、文档更新）中的通用设计哲学与行动准则。

---

## 核心哲学公理

1. **溯源根因，结构归位（Root-Cause Structural Integration）**
   任何新需求、功能演进或缺陷修复，绝不在表象末端堆砌 `if-else` 或追加补丁式说明。回到系统模型的源头（数据流源头、模型定义、前置上下文、初始化阶段），让改动在天然的结构位置自然归位。
2. **规范克制，拒绝防御性膨胀（Normative Restraint over Defensive Bloat）**
   清晰的结构、规范的命名与一致的契约本身就是最强的约束。拒绝用过度防御性代码（层层无意义校验/特殊分支）、过度说教式提示词（“严禁/切记/万不可”）或过度膨胀的配置项去穷举偶发极端边界。聚焦主干道，保持清晰简洁。
3. **最短有效差分（Shortest Working Diff & Minimal Blast Radius）**
   改动越小，系统扰动越低，引入次生问题的概率越小。删除优于增加，精简优于包装。一行根因处的契约修正，胜过在十处调用点打补丁。
4. **正交组合与模型对称（Orthogonal Composition & Symmetry）**
   新能力应当与现有系统正交组合，自然叠加，保持概念对齐与表达同构，不破坏主流程的一致性。

---

## 各领域实践准则

### 1. 代码编写与 Bug 修复 (Code & Bug Fixing)
- **治本不治标**：报错报在调用末端，修复在逻辑源头。Grep 共享函数的全部调用者，在源头修正契约，而不是在各调用处分别加 `if (x != null)`。
- **极简自洽**：优先使用标准库与原生特性，消除多余的中间胶水层与特例分支。
- **拒绝过度特判**：不针对单一测试用例或偶发边界写 `if (case == 'edge')`，重构算法使边缘情况自然融入核心数学/逻辑模型。

### 2. 架构与系统设计 (Architecture & System Design)
- **延后抽象（YAGNI）**：不为未经证实的未来需求预留深层继承、工厂与适配器。当两种设计等效时，选择概念最少、链路最短的那一个。
- **单一数据源（SSOT）**：状态与上下文保持单一真实来源，严禁维护多套同步脆弱的镜像状态。

### 3. API 与接口设计 (API & Interface Design)
- **拒绝参数膨胀**：不随意添加 `isSpecialMode`、`disableCheckA`、`ignoreB` 等逃逸标志位。通过重构入参模型或提供正交接口表达新意图。
- **契约自解释**：输入与输出结构对称，语义明确，消除隐式副作用。

### 4. 提示词、规则与工作流 (Prompts, Rules & Workflows)
- **结构化并列**：新前置依赖直接在规则定义与阅读列表中自然并列（如 `SCOPE.md 与 Project.md`），不写大段“注意/严禁跳过”。
- **中立技术陈述**：使用中立、客观的动宾短语陈述事实与动作，层级与顺序本身即是约束，无需感叹号与恐吓性修辞。

### 5. 测试与验证 (Testing & Verification)
- **验证不变性（Invariants）**：编写最小可运行的确定性验证（assert 或核心单测），验证核心业务契约，而非为极端 mock 堆砌复杂脚手架。

---

## 全领域实战对照矩阵

| 领域 | 补丁式 / 防御性设计（❌ 避免） | 结构化 / 规范设计（✅ 推荐） |
|---|---|---|
| **Bug 修复** | 在 5 个报错的 UI 组件中分别加 `user?.profile?.name || '未知'` 保护 | 在用户数据接入层（API 反序列化处）统一补齐默认 Profile 模型 |
| **API 演进** | `function fetchData(url, retry, isLegacy, skipAuth, timeout)` | `function fetchData(url, options = {})` 或按职责拆分为正交函数 |
| **架构扩展** | 为支持一个新格式新建一套独立流水线与 3 个 Adapter 类 | 扩展既有 Parser 策略映射表，复用统一处理流水线 |
| **规则/Prompt** | `**必须同时阅读 SCOPE.md，严禁跳过 SCOPE 导致方向走偏！**` | `**进入任何阶段前，先读 SCOPE.md 与 Project.md 建立上下文。**` |
| **Agent 调度** | 步骤间添加 5 行“请务必再次检查上一步输出，若缺失则报错退出” | 在 Agent 步骤输入中明确声明前置依赖项，由流程自然阻断 |
| **配置管理** | 为每个微小场景新增单独的环境变量 `ENABLE_SPECIAL_FEATURE_X_V2` | 统一在功能模块配置对象中声明标准属性 |

---

## 全流程自查清单 (Universal Production Checklist)

- [ ] **溯源检查**：改动是在根因处解决，还是在表象处拦截？
- [ ] **结构检查**：新逻辑/规则是作为系统一等公民自然融入，还是生硬嵌套在边缘分支？
- [ ] **克制检查**：是否存在过度防御性代码、特判分支、或无意义的恐吓性/重复性文字？
- [ ] **边界检查**：是否把不必要的罕见极端情况塞入了主干流程？
- [ ] **差分检查**：这是否是达成目标的最短有效差分（Shortest Working Diff）？
