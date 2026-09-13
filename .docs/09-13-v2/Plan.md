# Plan：Capsa Phase 2 —— 写入生命周期、查重与软删除闭环

**状态**：DONE
**完成日期**：2026-09-13
**日期**：2026-09-13
**版本**：v1.0
**回归测试结论**：`.venv/bin/python -m pytest -q` → 99 passed，0 failed，0 skipped
**关联基线**：`Capsa_落地交付分期规划.md` §三（Phase 2 交付契约）；上游设计 `AgentSpace 记忆服务设计方案.md` §五、§六
**前置阶段**：Phase 1 已交付并归档于 `.docs/09-13-v1/`

---

## 1. 背景与目标

### 1.1 背景

Phase 1 已交付只读基座：SQLite 存储（`memories` 表已预置 `deleted_reason` 列）、三态授权数据访问层、Bearer Key 鉴权与 1MB 请求体拦截、确定性二字组打分、4 个只读工具与基础 CLI。仓库基线为 64 个 pytest 用例全绿。

写入能力当前完全空缺：`capsa/mcp_service.py` 只注册了 4 个只读工具，`capsa/dal.py` 没有任何记忆写函数，`tests/conftest.py` 里插入测试数据仍靠直接执行 SQL 的辅助函数。Phase 2 补齐这条链路，使系统达到"读写与恢复闭环"的可用核心状态。

### 1.2 目标

| # | 目标 | 判定方式 |
|---|------|---------|
| 1 | 三个写入工具 `memory_save` / `memory_update` / `memory_forget` 注册并可用 | `tools/list` 返回 7 个工具，写工具注解语义正确 |
| 2 | 读写权限分级：`r` 拦截、`rw` 放行 | 只读 Key 调用三个写工具均返回 `isError: true` 且数据未落库 |
| 3 | 字段超限严格阻断、报实际字数、不静默截断 | 61 字符标题被拒且报"当前 61 字符，上限 60 字符" |
| 4 | 增量更新与显式清空语义 | 只改传入字段；`clear_review_at` 置空复核时间；`tags=[]` 清空标签 |
| 5 | 同分组标题二字组 Jaccard ≥ 0.6 查重提示 | 相似标题正常落库，响应附带相似条目 |
| 6 | 软删除原因落库与 CLI 恢复闭环 | 回收站可见 `deleted_reason`；`capsa memory restore` 后重新可见 |

### 1.3 非目标

| 不在本阶段 | 归属 |
|-----------|------|
| Web 管理台、`/api/*`、DAL 的 Web 列表接口 | Phase 3 |
| Dockerfile、Compose、Caddy、宿主机 Cron 热备、`capsa review` | Phase 3 |
| 向量检索、自动抽取写入、多租户、待审状态机 | 设计方案 §九已定不做 |
| 写入时的语义查重（仅做标题字面二字组重合） | 未证实需求；设计方案 §6.4 只要求字面相似提示 |
| `memory_update` 的查重提示 | 规划文档 §3.2.2 只要求"新建记忆落库前"扫描 |
| 按 `deleted_at` 物理清理回收站 | 无触发条件；保留即恢复能力的基础 |

---

## 2. 契约收敛

Phase 1 执行期出现过三处文档与实现漂移（MCP 挂载方式、关键词查询过滤、请求体拦截实现），都源于规划文档给的是设计意图而非实测契约。本节先把 Phase 2 中容易走偏的边界钉死，作为 Tasks 的唯一基准。

### 2.1 写入错误分层

写入路径的错误全部走工具级 `isError: true`（HTTP 仍为 200）：字段超限、非空校验、无写权限、目标不存在、`review_at` 格式非法、`clear_review_at` 与 `review_at` 同时给出、`reason` 为空、未提供任何待更新字段。这条与 Phase 1 的 `ids` 上限分层一致，也是设计方案 §6.4 的既定分层；HTTP 状态码只留给协议层问题（401 / 413）。

### 2.2 写入路径的三态判定复用

`memory_update` 与 `memory_forget` 必须先定位目标条目，定位复用 Phase 1 的三态批量查询，并把判定收敛成两条分支：

| 判定 | 处理 |
|------|------|
| `authorized` 且该分组权限为 `rw` | 放行 |
| `authorized` 且为 `r`、`forbidden`、`not_found` | `forbidden` 与 `not_found` 使用同一条"不存在"文案，不区分 |

对 `memory_save`，"分组不在授权范围"与"分组只有 `r` 权限"使用同一条拒绝文案。理由是 §0.6 已经确立的隐私口径：报错文案不得成为探测未授权分组是否存在、是否可读的侧信道。

### 2.3 记忆 ID 的唯一性

ID 为 `mem_` + 6 位小写字母数字，空间约 2.18×10⁹。个人规模下可接受，但 1 万条量级的生日碰撞概率已到百分位，主键冲突会让一次正常写入直接失败。写入入口在 `IntegrityError` 上重新生成 ID 重试至多 3 次，仍失败则原样上报。不引入 ID 池、不预先查重。

### 2.4 查重算法的复用口径

标题二字组直接复用 Phase 1 的 `tokenize`：它已实现"非字母数字切分 + 中文连续二字组 + 去重"，与规划文档 §3.2.2 描述的"标题二字组"完全同构。相似度取 Jaccard，阈值 0.6，两侧集合皆空时定义相似度为 0 而非除零。候选集只取目标分组内 `deleted_at IS NULL` 的条目。

### 2.5 CLI 回填口径

规划文档 §3.2.4 把回收站命令写作 `capsa memory list-deleted` 与 `capsa memory restore`。Phase 1 的 CLI 已占用 `init` / `group` / `key` 三组子命令，`memory` 空闲，按规划文档原样落地。CLI 是管理员通道，不做作用域校验，与 `group` / `key` 子命令的既有口径一致。

---

## 3. 阶段划分

### Phase 2.1：写入契约校验与近似查重算法

| 项目 | 内容 |
|------|------|
| **输入** | Phase 1 的检索模块（归一化、二字组分词已就绪） |
| **输出** | `review_at` 的 UTC 规范化函数、标题二字组 Jaccard 相似度与候选筛选函数 |
| **验收标准** | 同一时刻的 `+00:00` 与 `+08:00` 两种写法规范化后得到同一字符串；非法时间抛 `ValueError`；给定样例的相似度精确等于预期值且空集合不除零 |

### Phase 2.2：写入与回收站的数据访问入口

| 项目 | 内容 |
|------|------|
| **输入** | Phase 2.1 的时间规范化；Phase 1 的标识符生成与连接辅助 |
| **输出** | 新建、局部更新、软删除、恢复、回收站列表五个数据访问入口 |
| **验收标准** | 更新只影响传入字段且刷新 `updated_at`；软删除同时写入删除时间与原因；恢复清空两者；回收站列表只含已删除条目并携带原因；所有写函数自行提交，关连接重开后数据仍在 |

### Phase 2.3：三个写入工具与读写权限分级

| 项目 | 内容 |
|------|------|
| **输入** | Phase 2.1、2.2 的产出；Phase 1 的鉴权上下文（`key_id` 与 `grants`） |
| **输出** | `memory_save` / `memory_update` / `memory_forget` 三个工具（含工具注解）、字段非空与长度硬校验、`rw` 权限拦截、查重提示 |
| **验收标准** | 只读 Key 调用三个写工具均返回 `isError: true` 且行数不变；超限输入报实际字数且不落库；相似标题正常落库并在响应中附带相似条目 |

### Phase 2.4：回收站 CLI 与自动化验收

| 项目 | 内容 |
|------|------|
| **输入** | Phase 2.2、2.3 的产出；Phase 1 的 CLI 与测试基座 |
| **输出** | `capsa memory list-deleted` / `restore` 子命令；覆盖五条 Phase 2 验收断言的 pytest 用例；更新后的工具清单与注解断言 |
| **验收标准** | `pytest -v` 全绿；CLI 恢复后条目重新可见；软删除后默认检索、L2、L3 与三态批量查询四条路径均不可见 |

### Phase 2.5：文档回填与交付

| 项目 | 内容 |
|------|------|
| **输入** | Phase 2.1 ~ 2.4 全部产出 |
| **输出** | `.docs/Project.md` 按实际状态更新；`AgentSpace 记忆服务设计方案.md` 的事实漂移回填；归档与提交 |
| **验收标准** | Project.md 列出的每个路径与函数在仓库中实际存在；设计文档 `memories` 表的字段清单与 id 位数与实现一致 |

---

## 4. 架构决策

| 决策项 | 选择 | 理由 | 替代方案（为何不选） |
|--------|------|------|---------------------|
| 写入 SQL 的归属 | 全部新增在 `capsa/dal.py` | 沿用 Phase 1 的"唯一 SQL 出口"约定，工具层与未来的 Web API 层都不得自行拼 SQL | 工具层直写 SQL（越权过滤与提交边界会出现第二份实现） |
| 字段校验的实现位置 | 工具层私有校验函数，与 Phase 1 的 `ids` 上限校验同处 | 校验失败要渲染成面向 Agent 的中文 `isError` 文案；放进 DAL 只会把展示层文案压到数据层 | DAL 内校验（数据层承担展示职责，且 CLI 恢复路径被无关地约束） |
| 局部更新的参数传递 | 白名单字段字典，`None` 表示置空而非缺省 | Python 无法在签名里同时表达"未提供"与"显式置空"，用哨兵对象只为覆盖一个字段而增加概念 | 哨兵对象（多一个约定，调用方容易传错） |
| 清空复核时间 | 独立布尔参数 `clear_review_at` | 规划文档 §3.2.3 的既定签名；与"增量更新"的缺省语义不冲突 | 用 `review_at=""` 表示清空（污染 ISO 8601 契约） |
| 只读 Key 的拒绝时机 | 校验字段之前 | 权限是比字段格式更强的前置条件；先校验字段会让无权限的探测请求拿到字段级反馈 | 先校验字段（顺序上把"数据格式"暴露给无权限方） |
| 查重候选的取数 | 复用 Phase 1 的授权范围搜索列表查询 | 已带参数化的分组过滤与软删除过滤，字段集覆盖查重所需 | 新增专用标题查询（为一次复用增加一条 SQL 与一份维护面） |
| 查重的处置 | 只提示、不拦截，正常落库 | 规划文档 §3.2.2 与设计方案 §6.4 一致：误拦截的代价高于误提示 | 相似即拒绝（把取舍从 Agent 手里拿走） |
| ID 碰撞处置 | `IntegrityError` 上重试至多 3 次 | 6 位随机串在万条量级的碰撞已是可观测概率，3 行重试即可消除用户可见的随机失败 | 加长 ID / 预生成唯一池（改变已锁定的 ID 契约，或引入额外状态） |
| 回收站 CLI 的作用域校验 | 不做，管理员通道 | 与既有的 `group` / `key` 子命令口径一致；签发与撤销本就只在 CLI | 让 CLI 也走 Key 作用域（需要为 CLI 引入 Key 上下文，CLI 本就是持有数据库的人在用） |
| 测试中构造写入数据 | 改走写入工具，`conftest` 的直接插入辅助函数保留 | 只读断言依赖固定 id 与固定时间，改成走工具会牵动既有 64 个用例；新增用例走真实链路即可覆盖写入 | 全量改写既有用例的取数方式（大范围改动，与本期目标无关） |

---

## 5. 风险清单

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 更新路径若按"传入即覆盖"实现，`title=None` 会把标题写成空串或触发非空约束，造成静默数据破坏 | 🔴 高 | Plan §2.2 与 TASK-024 明确"仅显式传值参与更新"，验收标准要求断言未传字段逐字段保持不变 |
| `forbidden` 与 `not_found` 若给出不同文案，未授权分组的存在性可被探测，回退掉 §0.6 已建立的防线 | 🟡 中 | Plan §2.2 收敛为同一文案；TASK-024 的验收标准要求两条路径的报错文本逐字相同 |
| 查重阈值样例依赖具体文案，执行期若改动阈值或分词口径，用例会以"预期值对不上"的形式失败 | 🟡 中 | 阈值 0.6 与分词实现均已在 Plan §2.4 与 TASK-021 固定；用例直接断言计算出的数值而非"包含相似条目" |
| 工具集从 4 个扩到 7 个，既有的工具清单断言必然失败；若顺手改成弱断言，会丢掉对工具顺序与注解的保护 | 🟡 中 | TASK-030 要求逐名逐注解更新期望列表，不允许放宽为"包含"式断言 |
| 写工具的注册顺序与初始化的 `FastMCP` 单例耦合，事务未提交会让写入静默丢失 | 🟡 中 | Phase 1 已定"提交责任归 DAL 写函数"；TASK-022、TASK-023 的验收标准要求关连接重开后数据仍在 |
| ID 碰撞随条目规模上升，一次正常写入可能以主键冲突失败 | 🟢 低 | Plan §2.3 定下 3 次重生重试；TASK-022 的验收标准要求覆盖"首次生成冲突"的重试路径 |
| 写入数据的引入会让既有只读用例的计数断言（分组条目数、`memory_search` 命中数）受影响 | 🟢 低 | 新增用例各自使用独立临时库（`conn` 夹具天然隔离）；TASK-030 要求跑全量套件确认无回归 |

---

## 6. 阶段依赖关系

<figure>

<div style="border:1px solid #e5e7eb;border-radius:12px;padding:22px;background:#fafafa;color:#18181b;font-size:13px;line-height:1.6">

<div style="display:grid;grid-template-columns:1fr 22px 1fr 22px 1fr;align-items:stretch">

<div style="background:#ffffff;border:1px solid #2563eb;border-radius:8px;padding:14px">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#2563eb">PHASE 2.1</div>
  <div style="font-size:13px;font-weight:600;margin:6px 0 8px 0">契约校验与查重算法</div>
  <div style="font-size:11px;color:#52525b">UTC 规范化 · 二字组 Jaccard · 候选筛选</div>
</div>

<div style="display:flex;align-items:center;justify-content:center;color:#2563eb;font-weight:bold">→</div>

<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:14px">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#71717a">PHASE 2.2</div>
  <div style="font-size:13px;font-weight:600;margin:6px 0 8px 0">数据访问入口</div>
  <div style="font-size:11px;color:#52525b">新建 · 局部更新 · 软删除 · 恢复 · 回收站列表</div>
</div>

<div style="display:flex;align-items:center;justify-content:center;color:#2563eb;font-weight:bold">→</div>

<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:14px">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#71717a">PHASE 2.3</div>
  <div style="font-size:13px;font-weight:600;margin:6px 0 8px 0">写入工具</div>
  <div style="font-size:11px;color:#52525b">三个工具 · 字段硬校验 · rw 拦截 · 查重提示</div>
</div>

</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">

<div style="background:#ffffff;border:1px solid #2563eb;border-radius:8px;padding:14px">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#2563eb">PHASE 2.4</div>
  <div style="font-size:13px;font-weight:600;margin:6px 0 8px 0">回收站 CLI 与验收</div>
  <div style="font-size:11px;color:#52525b">list-deleted / restore · 五条断言用例 · 工具清单回归</div>
</div>

<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:14px">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#71717a">PHASE 2.5</div>
  <div style="font-size:13px;font-weight:600;margin:6px 0 8px 0">文档回填与交付</div>
  <div style="font-size:11px;color:#52525b">Project.md · 设计文档漂移 · 归档与提交</div>
</div>

</div>

<div style="margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:11px;color:#71717a">
2.1 → 2.2 → 2.3 严格串行；2.4 依赖 2.2 与 2.3；2.5 依赖 2.1 ~ 2.4 全部完成。无跨阶段并行写入冲突。
</div>

</div>

</figure>

---

## 7. 遗留待办（交由后续阶段）

| 事项 | 说明 |
|------|------|
| Phase 1 的未决项已闭合 | `ids` 超限的错误分层在 Phase 1 已决策并回填；本阶段不重新打开 |
| 检索规模上限 | 全量内存打分的上限约 3000 条，升级路径为授权分组 hash 分片惰性扫描，接口不变；本阶段不做 |
| 回收站的物理清理 | 仅软删除，无清理入口；触发条件出现前不实现 |
| 备份与审阅 | `capsa backup` / `capsa review` 归 Phase 3 |
