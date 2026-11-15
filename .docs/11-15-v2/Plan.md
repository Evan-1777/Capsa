# Plan：顶层双模工作区分区与文档工作区全栈子系统

**状态**：DONE  
**日期**：2026-11-15  
**版本**：v1.1（吸收 Review 审阅修订）  
**完成日期**：2026-11-15  
**回归测试结论**：`go build ./...`、`go vet ./...` 零告警；`go test ./...` 全量通过（新增 db 迁移 3 项、dal 工作区/文档 12 项、tests 双模集成 7 项）；`cd web && npm run build` 零错误；`npm run test:e2e` 15 条用例 100% PASSED（13 条存量 + 2 条新增）；旧样式门禁与工作流中立门禁正则检索结果均为 0  |

---

## 1. 背景与目标

当前 Capsa 服务仅支持单一的传统记忆模式：所有分类与记忆扁平挂载在同一全局空间下，采用细粒度凭据权限矩阵与三级披露工具集，且强制施加短标题与必填摘要长度约束。在跨设备 Agent Coding 等工程协作场景中，用户与 Agent 需要按工程或分类维护不受短字段约束的纯文本长文档，共享跨分类公共规范，并通过行级读取与局部精确替换降低长文本交互开销。

本次演进在不破坏传统记忆模式数据形态、权限契约、既有 MCP 端点与既有 5 个 MD3 视图的前提下，引入顶层工作区分区层级并构建独立的文档工作区全栈子系统：

- **引入顶层双模工作区分区与存量平滑承接**：建立顶层工作区模型，创建时固定选定记忆模式或文档模式且不可互转；初始化与存量数据库自动具备默认记忆工作区，无损承接既有分类与全部记忆条目，不同记忆工作区之间的分类可见性与记忆查询相互隔离（传统分组短标识保持全局唯一以兼容既有记忆外键与无工作区入参的记忆工具契约）。
- **扩展全局应用外壳与工作区管理视图**：在既有 MD3 顶栏接入工作区切换器与全局工作区设置入口；新增全局工作区设置视图，统一承载工作区的创建、基础信息编辑与空工作区安全删除；切换工作区时主视图按模式在记忆子应用与文档子应用之间整体切换。
- **构建工作流中立的两级文档存储与极简访问隔离**：以独立数据表承载文档工作区的分类与文档，按顶层公共文档区与分类专属文档区两级组织纯文本内容，不预设任何特定工作流文件名或模板；每个分类拥有独立高熵分类访问 ID，接入方凭此获得当前分类完整读写权限与所属工作区公共文档只读检索权限，物理隔绝跨分类、跨工作区与传统记忆数据访问。
- **提供独立端点的类文件 MCP 原语与全新 MD3 文档界面**：在独立路由挂载专属文档 MCP 服务实例，提供文件搜索、字符与正则搜索、全量或按行分段读取、新建防覆盖、全量覆写、原子局部替换与文档删除共 7 个类文件原语；配套交付复用既有 MD3 令牌与基础原语的文档管理界面，支持公共区与分类导航、访问 ID 复制与轮换、Markdown 安全渲染阅读及长文本在线编辑。

<div style="border:1px solid #d4d4d8;border-radius:12px;padding:18px;margin:16px 0;background:#fafafa;color:#18181b;font-family:system-ui,-apple-system,sans-serif;font-size:13px;line-height:1.5">
  <div style="font-size:12px;font-weight:600;color:#52525b;letter-spacing:0.04em;margin-bottom:12px">Capsa 单二进制双模平行子系统架构拓扑</div>
  <div style="border:1px solid #6750A4;border-radius:10px;padding:12px 14px;background:#ffffff;margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span style="font-weight:600;color:#6750A4">顶层共享外壳与工作区管理层（Dual-Mode Shared Shell）</span>
      <span style="font-size:11px;background:#EADDFF;color:#21005D;padding:2px 8px;border-radius:999px">管理员通配凭据守卫</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:12px;color:#3f3f46">
      <div style="border:1px solid #e4e4e7;border-radius:8px;padding:8px;background:#f8f8fa"><strong>顶栏工作区切换器</strong><br><span style="font-size:11px;color:#71717a">按工作区模式整体切换主应用视图</span></div>
      <div style="border:1px solid #e4e4e7;border-radius:8px;padding:8px;background:#f8f8fa"><strong>全局工作区设置视图</strong><br><span style="font-size:11px;color:#71717a">新建选定模式 · 编辑信息 · 空区删除</span></div>
      <div style="border:1px solid #e4e4e7;border-radius:8px;padding:8px;background:#f8f8fa"><strong>统一查询令牌接入</strong><br><span style="font-size:11px;color:#71717a">兼容请求头 Bearer 与 URL 查询参数</span></div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    <div style="border:1px solid #a1a1aa;border-radius:10px;padding:14px;background:#ffffff">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-weight:600;color:#18181b">记忆工作区子系统（传统模式）</span>
        <span style="font-size:11px;background:#e4e4e7;color:#27272a;padding:2px 8px;border-radius:999px">契约零破坏保真</span>
      </div>
      <div style="display:grid;gap:6px;font-size:12px;color:#52525b">
        <div style="border:1px solid #e4e4e7;border-radius:6px;padding:7px 9px;background:#fafafa"><strong>存储容器</strong>：分组挂载所属记忆工作区，存量数据自动归入默认记忆工作区；跨记忆工作区分类与条目隔离</div>
        <div style="border:1px solid #e4e4e7;border-radius:6px;padding:7px 9px;background:#fafafa"><strong>鉴权模型</strong>：传统哈希凭据表与多分组读写权限映射</div>
        <div style="border:1px solid #e4e4e7;border-radius:6px;padding:7px 9px;background:#fafafa"><strong>协议与界面</strong>：传统记忆 MCP 端点（7 个三级披露工具）+ 5 个既有 MD3 视图收敛至当前工作区</div>
      </div>
    </div>
    <div style="border:1px solid #6750A4;border-radius:10px;padding:14px;background:#ffffff">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-weight:600;color:#6750A4">文档工作区子系统（独立特化模式）</span>
        <span style="font-size:11px;background:#EADDFF;color:#21005D;padding:2px 8px;border-radius:999px">全新独立全栈链路</span>
      </div>
      <div style="display:grid;gap:6px;font-size:12px;color:#52525b">
        <div style="border:1px solid #e4e4e7;border-radius:6px;padding:7px 9px;background:#f8f6fc"><strong>两级容器</strong>：工作区顶层公共文档区（跨分类只读共享）+ 分类专属文档区（完整读写，工作流中立寻址）</div>
        <div style="border:1px solid #e4e4e7;border-radius:6px;padding:7px 9px;background:#f8f6fc"><strong>鉴权模型</strong>：每分类独立高熵访问 ID，支持管理台内联复制与一键重置轮换</div>
        <div style="border:1px solid #e4e4e7;border-radius:6px;padding:7px 9px;background:#f8f6fc"><strong>协议与界面</strong>：独立文档 MCP 端点（7 个类文件原语）+ 全新 MD3 文档浏览与在线编辑界面</div>
      </div>
    </div>
  </div>
</div>

---

## 2. 阶段划分

### Phase 1：双模工作区存储模型、存量平滑迁移与数据访问层

| 项目 | 内容 |
|------|------|
| **输入** | 既有 SQLite 存储结构、标识符生成规则、传统分组与记忆数据访问层契约 |
| **输出** | 工作区表、文档分类表、两级文档表与部分唯一索引定义；存量数据库自动建表与默认记忆工作区无损挂接迁移逻辑；工作区增删改查、按记忆工作区隔离的分组与记忆查询、文档分类访问 ID 轮换以及两级文档原子读写与局部替换数据访问接口 |
| **验收标准** | 全新初始化与含历史数据的存量库均可幂等升级，既有分类自动归入默认记忆工作区且记忆零丢失；不同记忆工作区下分组与记忆查询严格隔离；默认工作区删除由标识前置阻断，非空工作区与非空文档分类删除在排他写事务内原子阻断；公共区与分类区同名文档互不冲突而同作用域内路径唯一；既有后端测试保持通过 |

### Phase 2：分类访问 ID 鉴权、独立文档 MCP 服务与管理台接口扩展

| 项目 | 内容 |
|------|------|
| **输入** | Phase 1 交付的双模数据访问层、既有查询参数令牌注入中间件、流式 MCP 传输封装与统一 JSON 信封规范 |
| **输出** | 分类访问 ID 独立校验守卫、挂载于独立文档端点的流式 MCP 服务及全部 7 个类文件工具（文件通配搜索、正文关键词/正则行级检索、全量/行区间带行号读取、防覆盖新建、全量覆写、唯一/全量原子局部替换、文档删除）、管理台工作区与文档子系统全套 REST 接口及传统分组/记忆接口的工作区过滤扩展 |
| **验收标准** | 分类访问 ID 支持请求头与 URL 查询参数双通道接入，对所属分类可读写、对同工作区公共区只读可搜、对公共区写操作与其他分类/传统端点严格阻断，轮换后旧访问 ID 即刻返回 401；传统凭据与文档分类访问 ID 在两个 MCP 端点间互不混用；7 个类文件工具参数校验与原子替换行为准确；全部新增与扩展管理接口遵循统一信封与状态码契约 |

### Phase 3：顶栏工作区切换器、全局设置视图与 MD3 文档工作区界面

| 项目 | 内容 |
|------|------|
| **输入** | Phase 2 交付的后端接口契约、既有 MD3 语义令牌体系、领域中立基础 UI 原语库、单向受控全局应用外壳与传统记忆子应用 |
| **输出** | 抽离复用的安全 Markdown 渲染组件、接入工作区切换器与全局设置入口的顶栏与外壳扩展、全局工作区设置视图（新建含模式选定、编辑基础信息、空工作区删除）、按当前工作区收敛数据的记忆子应用适配、全新 MD3 文档工作区子应用（公共区与分类导航、分类新建/重命名/空删除、分类访问 ID 与接入地址内联复制及轮换确认、文档列表检索、Markdown 安全阅读、长文本在线编辑保存、文档新建/重命名/删除） |
| **验收标准** | 全站新增界面 100% 复用现有 MD3 语义令牌与基础原语，零旧版样式类名且零新增脱离主题的色彩或圆角变量；代码与界面零硬编码特定工作流文件名或模板；切换工作区后主界面在记忆 5 视图与文档界面间准确切换且数据严格隔离；桌面宽屏与 375px 窄屏下布局无溢出且模态焦点管理正常；前端类型检查与生产构建零错误通过 |

### Phase 4：全栈单元/集成/E2E 验证与项目文档同步

| 项目 | 内容 |
|------|------|
| **输入** | 前三阶段完成的全部前后端代码、静态嵌入构建管线、既有 Go 测试套件与 Playwright 端到端套件、项目基准文档 |
| **输出** | 覆盖存量平滑迁移、工作区隔离、分类访问 ID 权限边界、独立文档 MCP 全部 7 个工具与新增管理台接口的 Go 单元与集成测试；覆盖工作区设置、双模切换、分类访问 ID 复制轮换、文档全生命周期在线编辑及 375px 窄屏与模态焦点的 Playwright 端到端用例；重新构建嵌入静态资源后的验证报告与同步更新的项目基准文档及仓库说明文档 |
| **验收标准** | 前端生产构建与 Go 静态二进制编译成功；Go 全量单元与集成测试 100% 通过；Playwright 端到端套件（含全部 13 条既有回归用例与新增双模/文档工作区及窄屏断言用例）全绿通过；旧样式门禁与工作流中立门禁检索匹配均为 0；项目基准文档与仓库说明文档同代码库实际结构完全一致 |

---

## 3. 架构决策

<div style="border:1px solid #d4d4d8;border-radius:12px;padding:18px;margin:16px 0;background:#ffffff;color:#18181b;font-family:system-ui,-apple-system,sans-serif;font-size:12px;line-height:1.5">
  <div style="font-weight:600;color:#52525b;margin-bottom:10px">双模平行子系统核心机制对照</div>
  <div style="display:grid;grid-template-columns:110px 1fr 1fr;gap:8px;align-items:stretch">
    <div style="font-weight:600;color:#52525b;padding:8px;background:#f4f4f5;border-radius:6px">维度</div>
    <div style="font-weight:600;color:#18181b;padding:8px;background:#f4f4f5;border-radius:6px">记忆工作区（Memory Mode）</div>
    <div style="font-weight:600;color:#6750A4;padding:8px;background:#f3edf7;border-radius:6px">文档工作区（Docs Mode）</div>

    <div style="font-weight:600;color:#3f3f46;padding:8px;border:1px solid #e4e4e7;border-radius:6px">容器层级</div>
    <div style="padding:8px;border:1px solid #e4e4e7;border-radius:6px;color:#52525b">记忆工作区 → 传统分组 → 记忆条目（含软删除回收站与复核时间）</div>
    <div style="padding:8px;border:1px solid #d4d4d8;border-radius:6px;color:#3f3f46">文档工作区 → 顶层公共文档区 + 多个分类专属文档区（纯文本直接物理删除）</div>

    <div style="font-weight:600;color:#3f3f46;padding:8px;border:1px solid #e4e4e7;border-radius:6px">内容与寻址</div>
    <div style="padding:8px;border:1px solid #e4e4e7;border-radius:6px;color:#52525b">短标题（≤60）+ 必填摘要（≤200）+ 正文（≤64000），按生成的条目 ID 寻址，单次读取 4000 字符分页</div>
    <div style="padding:8px;border:1px solid #d4d4d8;border-radius:6px;color:#3f3f46">无短标题与摘要约束，按「作用域 + 逻辑路径」唯一寻址，支持全量读取、行号区间分段读取与局部文本替换</div>

    <div style="font-weight:600;color:#3f3f46;padding:8px;border:1px solid #e4e4e7;border-radius:6px">Agent 鉴权</div>
    <div style="padding:8px;border:1px solid #e4e4e7;border-radius:6px;color:#52525b">签发单次展示明文令牌（服务端存哈希），通过多分组读写权限字典控制访问</div>
    <div style="padding:8px;border:1px solid #d4d4d8;border-radius:6px;color:#3f3f46">每分类绑定高熵分类访问 ID（管理台可随时查看复制与一键轮换），天然锁定本分类读写 + 同工作区公共区只读</div>

    <div style="font-weight:600;color:#3f3f46;padding:8px;border:1px solid #e4e4e7;border-radius:6px">协议端点</div>
    <div style="padding:8px;border:1px solid #e4e4e7;border-radius:6px;color:#52525b">传统记忆 MCP 端点（7 个三级披露与记忆写读原语）</div>
    <div style="padding:8px;border:1px solid #d4d4d8;border-radius:6px;color:#3f3f46">独立文档 MCP 端点（7 个类文件检索、行读与原子局部编辑原语）</div>
  </div>
</div>

| 决策项 | 选择 | 理由 | 替代方案（为何不选） |
|--------|------|------|----------------------|
| 传统分组与记忆的工作区挂载方式 | 在传统分组表增加所属工作区字段并默认归属系统默认记忆工作区，记忆表结构与分组全局唯一主键保持不变（跨记忆工作区隔离分类可见性与记忆查询，但禁止跨记忆工作区创建重复分组短标识） | 记忆条目天然通过所属分组继承记忆工作区归属，既实现管理台多记忆工作区分类与条目完全隔离，又保证无工作区参数的传统 MCP 工具与多分组凭据映射不存在同名分组寻址歧义 | 修改记忆表主键或将传统分组改为工作区内复合唯一主键（会导致无工作区入参的传统记忆工具与凭据权限字典面对同名分组时产生寻址冲突并破坏既有外键） |
| 存量数据库平滑迁移时机 | 在 CLI 初始化子命令与服务监听启动前置阶段对已建表存量库执行幂等补列建表与默认记忆工作区补齐（迁移报错直接退出进程），对全新未建表空库保持不隐式建表 | 兼顾已有生产库升级重启即无损可用、迁移异常启动期快速失败可见，同时维持纯路由处理器无副作用与未初始化空库健康检查返回 503 的既有契约 | 在无错误返回的路由构造函数内静默忽略迁移错误（会导致半迁移状态运行期报错）或服务启动无条件初始化空库（违反未初始化返回 503 约束） |
| 两级文档唯一性与外键约束 | 文档表显式区分公共与分类两种作用域，分类文档引用分类主键，公共文档分类外键置空，配合两条按作用域条件过滤的部分唯一索引 | 规避 SQLite 普通复合唯一约束将多个空值视为不等而放行重复公共文档的缺陷，在存储引擎层同时保证分类外键完整性与两级路径唯一性 | 单一可空列普通唯一索引（无法阻止公共区同名文档重复插入）或拆分为公共文档与分类文档两张同构表（造成检索与管理逻辑成倍重复） |
| 分类访问 ID 存储与鉴权模型 | 分类创建时生成带专属前缀的高熵可打印 ASCII 访问 ID 随分类记录存储，独立文档 MCP 守卫仅解析该访问 ID 注入单分类与所属工作区上下文 | 满足管理台分类视图直接展示访问 ID、一键复制与即时轮换的需求，天然复用根路由查询参数转请求头中间件，且与传统记忆凭据物理绝缘 | 仅存哈希单次展示（违背分类视图内联常驻展示与随时复制的需求）或混用传统凭据表（引入跨模式权限污染与多余映射层） |
| 管理台文档接口寻址与 MCP 文档寻址 | Agent 侧 MCP 工具严格按「作用域 + 文档路径」寻址；管理台 REST 单文档读写改删按内部文档主键寻址，路径作为可编辑属性承载 | 文档逻辑路径允许包含斜杠分层（如多级目录风格命名），REST 路径使用内部短主键彻底消除反向代理对编码斜杠的截断与路由歧义，同时使文档重命名成为标准属性更新 | 在 REST URL 路径段直接拼接含斜杠文档名（受多层反向代理解码影响极易产生路由匹配错误） |
| 局部替换并发一致性 | 在 SQLite 排他写事务内完成目标文档读取、精确匹配计数校验、文本替换与写回 | 消除高并发 Agent 连续调用局部替换时的先读后写竞态覆盖，保证唯一匹配校验与替换落盘严格原子化 | 在应用层普通连接先查询后单独执行更新语句（并发局部替换会丢失中间修改） |
| 外壳与双模视图组织方式 | 根组件统一管理会话鉴权、工作区列表状态与全局设置视图切换，按当前工作区模式条件挂载记忆子应用或文档子应用，两者平行复用同一单向受控外壳与共享安全 Markdown 组件 | 保持单一数据源，避免全局状态散落，且在不改动传统 5 视图内部交互与无障碍标签的前提下平滑接入双模切换与全局设置 | 将文档视图硬塞入记忆子应用分支（违背双模解耦原则，导致导航与状态机混杂） |

---

## 4. 风险清单

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 存量 SQLite 数据库在线添加带外键引用的非空列时触发驱动约束报错 | 🔴 高 | 新库建表直接包含完整列定义；存量库升级通过列元数据检查按 SQLite 兼容语法平滑补列并幂等写入默认记忆工作区，在事务层统一强校验工作区存在性与空容器删除约束，并编写真实旧表结构升级回归测试 |
| SQLite 普通唯一约束对空外键列不去重导致公共文档区可写入重名文档 | 🔴 高 | 使用带条件子句的两条独立部分唯一索引分别锁定公共文档区路径唯一性与分类文档区路径唯一性，并在数据访问层单测中显式验证重复创建拦截 |
| Agent 传入空匹配串、路径穿越片段或尝试通过文档 MCP 工具篡改公共文档 | 🔴 高 | 在边界统一归一化并校验文档路径（拒绝空路径、控制字符、反斜杠与上级目录片段）；局部替换强制拒绝空匹配串；全部 4 个写工具在守卫与工具层双重锁定仅操作当前分类作用域 |
| 顶栏新增工作区切换器与设置入口后破坏既有 13 条端到端测试选择器或窄屏 375px 布局 | 🟡 中 | 完整保留既有登录、主视图导航与 5 个传统视图的无障碍名称；默认记忆工作区作为初始选中项承接首屏；窄屏下对次要品牌文字做响应式折叠，确保切换器、菜单与操作按钮在 375px 视口内无横向溢出 |
| 代码、初始化逻辑或界面占位文案无意残留工作流特定文档名称 | 🟡 中 | 全链路采用通用示例文案，并在最终验收阶段增加针对特定工作流词汇的源码机械检索清零门禁 |

---

## 5. Phase 依赖关系

<div style="border:1px solid #d4d4d8;border-radius:12px;padding:16px;margin:14px 0;background:#fafafa;color:#18181b;font-family:system-ui,-apple-system,sans-serif;font-size:12px">
  <div style="display:grid;grid-template-columns:1fr 28px 1fr 28px 1fr 28px 1fr;align-items:center;gap:4px">
    <div style="border:1px solid #6750A4;border-radius:8px;padding:10px;background:#ffffff">
      <div style="font-weight:700;color:#6750A4">Phase 1</div>
      <div style="font-weight:600;margin-top:2px">存储迁移与数据访问层</div>
      <div style="color:#71717a;font-size:11px;margin-top:4px">双模表结构 · 存量承接 · 原子写读</div>
    </div>
    <div style="text-align:center;color:#6750A4;font-weight:700">→</div>
    <div style="border:1px solid #a1a1aa;border-radius:8px;padding:10px;background:#ffffff">
      <div style="font-weight:700;color:#3f3f46">Phase 2</div>
      <div style="font-weight:600;margin-top:2px">鉴权、文档 MCP 与管理接口</div>
      <div style="color:#71717a;font-size:11px;margin-top:4px">分类访问 ID · 7 工具 · REST 扩展</div>
    </div>
    <div style="text-align:center;color:#6750A4;font-weight:700">→</div>
    <div style="border:1px solid #a1a1aa;border-radius:8px;padding:10px;background:#ffffff">
      <div style="font-weight:700;color:#3f3f46">Phase 3</div>
      <div style="font-weight:600;margin-top:2px">顶栏切换、设置与文档界面</div>
      <div style="color:#71717a;font-size:11px;margin-top:4px">MD3 外壳扩展 · 双模切换 · 在线编辑</div>
    </div>
    <div style="text-align:center;color:#6750A4;font-weight:700">→</div>
    <div style="border:1px solid #a1a1aa;border-radius:8px;padding:10px;background:#ffffff">
      <div style="font-weight:700;color:#3f3f46">Phase 4</div>
      <div style="font-weight:600;margin-top:2px">全栈验证与文档维护</div>
      <div style="color:#71717a;font-size:11px;margin-top:4px">Go 单测/集成 · E2E 回归 · 文档同步</div>
    </div>
  </div>
</div>

Phase 1 至 Phase 4 按单向数据与契约依赖串行推进：存储层与幂等迁移为全部上层逻辑提供确定性持久化基座，协议端点与 REST 接口定型后驱动前端双模外壳与文档工作区界面装配，最后基于重新编译内嵌的单一二进制完成全栈测试验收与项目文档更新。

---

## 6. Subagent 协同规划

对照三维效益模型（任务复杂度、任务上下文关联程度、经济与时间效益）评估各阶段委托需求：

| 阶段 | 上下文依赖 | 并行收益 | 执行主体 | 决策理由 |
|------|-----------|---------|----------|----------|
| Phase 1：存储模型与数据访问层 | 强（定义全局表结构、存量迁移不变量与事务边界） | 无（底层基石，阻塞全部后续阶段） | 主线 | 数据结构与错误语义是全栈单一事实来源，主线直接实现可避免跨会话理解偏差 |
| Phase 2：文档 MCP 与管理接口 | 强（紧耦合 Phase 1 存储接口、统一信封及双端点鉴权隔离规则） | 无（串行承接 Phase 1，阻塞前端联调） | 主线 | 涉及 7 个工具纯文本契约与存量接口向后兼容，主线连续推演差分最小且零上下文重载损耗 |
| Phase 3：MD3 双模外壳与文档界面 | 强（紧耦合 Phase 2 接口模型、既有 MD3 原语体系及 13 条存量 E2E 选择器约束） | 低（前后端接口与组件原语高度内聚，拆分需重复读取全量前端基线） | 主线 | 主线已完整掌握外壳属性契约与 MD3 令牌门禁，直接实施可保证视觉一致性与存量测试零回归 |
| Phase 4：全栈验证与文档同步 | 强（需串联前端构建、二进制内嵌编译、后端测试、真实浏览器 E2E 与架构文档更新） | 无（闭环验收链路短且需即时定位修复潜在联调细节） | 主线 | 构建测试与文档核对回路紧凑，保留主线执行端到端耗时更短、Token 效率更高 |

> **协同结论**：本次任务虽横跨数据库、MCP 协议层、REST 接口与 MD3 前端，但各阶段呈清晰的单向串行契约依赖，且对存量兼容性（既有数据库迁移、传统 MCP 契约、13 条浏览器端到端选择器、MD3 令牌与工作流中立门禁）有细密的不变量要求；委托隔离会话并无实质并行加速窗口，反而引入重复读盘开销与契约漂移风险，因此全流程统一由主线克制推进。

---

> ### Task 拆解预览
>
> 完整原子任务定义详见根目录任务文档。本计划在此止步，不展开具体文件路径、函数签名与代码实现细节。
>
> | Phase | 预估 Task 数 | 执行主体 | 目标覆盖 |
> |-------|-------------|----------|----------|
> | Phase 1 | 3 | 主线 | 标识符扩展、双模表结构与存量库平滑迁移；工作区管理与记忆工作区隔离查询；文档分类、访问 ID 轮换与两级文档原子读写替换 |
> | Phase 2 | 2 | 主线 | 分类访问 ID 校验与独立文档端点 7 个类文件 MCP 工具；工作区管理、记忆过滤扩展与文档子系统全套 Web REST 接口 |
> | Phase 3 | 3 | 主线 | 前端类型与客户端扩展、共享 Markdown 抽离及顶栏工作区切换器/设置入口；全局工作区设置视图与记忆子应用工作区收敛；全套 MD3 文档工作区界面 |
> | Phase 4 | 2 | 主线 | Go 存储迁移/权限隔离/MCP/REST 单元与集成测试补齐；静态产物内嵌重编、Playwright 双模 E2E 测试套件与项目基准文档同步 |
>
> **总计预估**：10 个原子 Task，每项 Task 完成后代码库均处于可编译可验证状态。
