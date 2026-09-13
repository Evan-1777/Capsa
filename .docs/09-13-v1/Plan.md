# Plan：Capsa Phase 1 —— 数据基座、三态授权防线与三级只读协议

**状态**：DONE
**完成日期**：2026-09-13
**日期**：2026-09-12
**版本**：v1.0
**回归测试结论**：`.venv/bin/python -m pytest -v` 退出码 0，58 个用例全部通过，0 跳过、0 失败。六条 Phase 1 交付验收断言各有对应用例：启动与依赖（`test_healthz_ok` / `test_healthz_database_unavailable`）、1MB 拦截（`test_oversized_body_rejected` / `test_exact_limit_not_rejected` / `test_chunked_body_over_limit_rejected`）、鉴权与撤销（`test_invalid_token_rejected` / `test_revoked_key_rejected`）、三态防线隔离（`test_forbidden_entries_leak_nothing` / `test_search_never_carries_unauthorized_entries` / `test_dal_forbidden_payload_has_only_status_and_id`）、打分与排序确定性（`test_chinese_bigram_query_hits_expected_entry` / `test_empty_query_browses_by_pinned_then_updated` / 其余 5 例）、体积截断与续读（`test_long_body_is_truncated_with_continuation` / `test_response_budget_stops_by_id_order`）。另在真实 uvicorn 进程上以 FastMCP 官方客户端复验通过：`/healthz` 200、无认证 `/mcp` 401、1.1MB 请求体 413、4 个工具列出、L1→L2→L3 链路贯通、撤销后 401。

**执行期决策偏差**（已在执行中落定并回填文档）：
1. MCP 端点的挂载方式改为 `Route("/mcp", endpoint=mcp.http_app(path="/mcp"))`。本 Plan §2.2 记录的"必须传 path=\"/\" 挂到 Mount(\"/mcp\")"经真实 uvicorn 实测证伪：`Mount` 的路径正则为 `^/mcp/(?P<path>.*)$`，裸 `POST /mcp` 得到 307，跳转目标又因空路径 404。`Capsa_落地交付分期规划.md` §2.2 与 §4.2 的两处装配片段已同步修正。
2. 关键词查询在排序后过滤掉零分条目。零分意味着标题、摘要、标签都不含任何查询词元，列出它们只是噪声。

---

## 1. 背景与目标

### 1.1 背景

`Capsa_落地交付分期规划.md` 把 Capsa 记忆服务的落地拆成三个 Main-Phase，本 Plan 只覆盖 Phase 1。

进入本阶段前，仓库处于空工程状态：只有规划文档与设计文档，没有代码、没有构建配置、没有 Git 提交历史（`master` 分支尚无任何 commit，全部文件处于 untracked）。

### 1.2 目标

交付一个权限绝对隔离、L1~L3 协议就绪的只读 MCP 服务，具体包含四件事：

| # | 目标 | 判定方式 |
|---|------|---------|
| 1 | SQLite 存储基座，预置 `deleted_reason`，WAL 与外键强制开启 | 建表可重复执行，健康检查返回 200 |
| 2 | 三态授权数据访问层（`authorized` / `forbidden` / `not_found`） | 越权条目不返回分组名、标题与摘要 |
| 3 | Bearer Key 鉴权与请求体防护 | 撤销后下次调用即刻 401；1.1MB 请求体返回 413 |
| 4 | 确定性检索引擎与三级披露契约、4 个只读工具、基础 CLI | 中文二字组命中正确；5000 字符正文切片为 4000 并附续读标签 |

### 1.3 非目标

| 不在本阶段 | 归属 |
|-----------|------|
| 3 个写入工具、字段超限阻断、查重提示、软删除与恢复 | Phase 2 |
| Web 管理台、`/api/*`、Dockerfile、Caddy、Playwright | Phase 3 |
| 备份与 `capsa review` CLI | Phase 3 |
| 向量检索、自动抽取写入、多租户 | 设计方案第九节已明确不做 |

---

## 2. 环境契约

本机环境与规划文档的假设存在偏差。以下结论均已在本机实测确认，是本阶段唯一的执行基准。

<figure>

<div style="border:1px solid #e5e7eb;border-radius:12px;padding:20px;background:#fafafa;color:#18181b;font-size:13px">

<div style="display:grid;grid-template-columns:130px 1fr;gap:0;font-size:12px">

<div style="padding:9px 10px;font-size:11px;letter-spacing:.06em;color:#71717a">事项</div>
<div style="padding:9px 10px;font-size:11px;letter-spacing:.06em;color:#71717a">实测结论</div>

<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">系统 Python</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb">仅 <span style="font-family:ui-monospace,monospace">3.14.4</span>，无 3.12/3.13；<span style="font-family:ui-monospace,monospace">python3 -m venv</span> 因缺 ensurepip 不可用，<span style="font-family:ui-monospace,monospace">~/.local</span> 为只读挂载，<span style="font-family:ui-monospace,monospace">pip install --user</span> 失败</div>

<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">解释器来源</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb">已在仓库内落位 uv 0.12.13 与独立 CPython <span style="font-family:ui-monospace,monospace">3.12.14</span>（<span style="font-family:ui-monospace,monospace">.devtools/</span>），虚拟环境 <span style="font-family:ui-monospace,monospace">.venv/</span> 可用。选 3.12 而非 3.14：生产镜像为 <span style="font-family:ui-monospace,monospace">python:3.12-slim</span>，本地与线上对齐</div>

<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">依赖版本</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb">规划文档原定的四个 pin 无法同时成立：<span style="font-family:ui-monospace,monospace">fastmcp==4.0.0</span> 硬性要求 <span style="font-family:ui-monospace,monospace">pydantic&gt;=2.12.0</span> 与 <span style="font-family:ui-monospace,monospace">starlette&gt;=1.0.1</span>，与文档写的 <span style="font-family:ui-monospace,monospace">pydantic==2.8.2</span>、<span style="font-family:ui-monospace,monospace">starlette==0.38.2</span> 冲突。规划文档 §2.2 已按 §4 决策表回填为可用组合，两侧现已一致</div>

<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">默认数据路径</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb"><span style="font-family:ui-monospace,monospace">/data</span> 在本机不存在。默认路径仍取 <span style="font-family:ui-monospace,monospace">/data/capsa.db</span>，但解析必须推迟到调用期并支持 <span style="font-family:ui-monospace,monospace">CAPSA_DB_PATH</span> 覆盖，否则测试无法运行</div>

</div>

</div>

</figure>

### 2.1 运行与测试命令

```bash
# 依赖安装（首次或 pyproject.toml 变更后）
.venv/bin/python -m pip install -e ".[test]"

# 初始化数据库与标准分组（未建表时 /healthz 返回 503）
CAPSA_DB_PATH=/data/capsa.db .venv/bin/capsa init

# 启动服务
.venv/bin/uvicorn capsa.server:app --host 127.0.0.1 --port 8000

# 测试
.venv/bin/python -m pytest -v
```

`.devtools/` 与 `.venv/` 合计约 270 MB，属于本机开发工具链，必须排除在版本控制之外（见 TASK-001）。

### 2.2 关键 API 行为的实测记录

以下四条是集成 FastMCP 4 与 Starlette 时容易踩空的地方，均已在探针程序中验证：

| 行为 | 实测结果 |
|------|---------|
| 挂载路径 | 直接使用 `mcp.http_app()` 挂到 `/mcp` 会全部 404，必须显式传 `path="/"` |
| lifespan 传递 | 不把 MCP 子应用的 lifespan 交给根应用，所有 `/mcp` 请求抛 "task group was not initialized" |
| 鉴权上下文 | HTTP 请求链路下 `get_access_token()` 正常返回 claims；**内存传输的 `Client(mcp)` 返回 None**，且该传输不支持注入 auth，因此端到端测试必须走 HTTP |
| 工具内报错 | 工具体抛 `ToolError` 会被转换为 `isError: true` 的正常结果，HTTP 仍为 200；这正是设计方案 §6.4 要求的"工具执行错误"分层 |

---

## 3. 阶段划分

### Phase 1.1：工程骨架与依赖锁定

| 项目 | 内容 |
|------|------|
| **输入** | 空工程工作区；§2 已确认的工具链 |
| **输出** | 版本控制排除规则、项目元数据与依赖清单、可导入的包骨架 |
| **验收标准** | 依赖安装成功；`import capsa` 通过；`git status` 不显示 `.venv/` 与 `.devtools/` |

### Phase 1.2：存储基座与三态授权数据层

| 项目 | 内容 |
|------|------|
| **输入** | Phase 1.1 的包骨架 |
| **输出** | 三张表的建表逻辑（含 `deleted_reason`）、WAL 与外键 PRAGMA、连接辅助与健康检查；三态批量查询、授权范围搜索列表、分组元数据三个数据访问入口 |
| **验收标准** | 建表可重复执行且幂等；已软删除记录不进入任何查询结果；越权条目的判定结果只含状态与 id 两个字段 |

### Phase 1.3：鉴权防线与请求体防护

| 项目 | 内容 |
|------|------|
| **输入** | Phase 1.2 的 Key 表与查询入口 |
| **输出** | Key 明文生成与 SHA256 落库、撤销位检查、FastMCP 令牌校验器；1MB 请求体拦截中间件 |
| **验收标准** | 非法令牌 401；撤销后下一次请求 401；1.1MB 请求体 413 且不进入工具层；恰好 1MB 放行 |

### Phase 1.4：检索引擎与三级披露格式

| 项目 | 内容 |
|------|------|
| **输入** | Phase 1.2 的搜索列表入口 |
| **输出** | NFC 归一化与二字组分词、加权打分与稳定排序、L1/L2/L3 纯文本格式与体积截断、分组列表格式 |
| **验收标准** | 中文二字组命中正确；空查询按置顶与更新时间倒序；5000 字符正文切片为 4000 并附续读标签；越权条目渲染为 `[无权访问]` |

### Phase 1.5：服务装配、CLI 与自动化验收

| 项目 | 内容 |
|------|------|
| **输入** | Phase 1.2 ~ 1.4 的全部模块 |
| **输出** | 4 个只读 MCP 工具、Starlette 根应用与 `/healthz`、`capsa init / group / key` CLI、覆盖六条验收断言的 pytest 套件 |
| **验收标准** | `pytest -v` 全绿；六条 Phase 1 交付验收断言逐条有对应用例 |

---

## 4. 架构决策

| 决策项 | 选择 | 理由 | 替代方案（为何不选） |
|--------|------|------|---------------------|
| Python 运行时 | 3.12.14（uv 管理的独立解释器） | 与生产镜像 `python:3.12-slim` 对齐；系统仅有 3.14 且缺 ensurepip | 系统 3.14（与生产不一致，且旧版 pydantic 需本地编译 Rust） |
| FastMCP | `4.0.0` | 规划文档指定；内置鉴权扩展点与工具注解 | 降级到 3.x（放弃 dual-era 协商，偏离规划） |
| Starlette | `1.6.0` | FastMCP 4 的硬性下限是 `>=1.0.1`，规划文档写的 0.38.2 无法装配 | 0.38.2（与 FastMCP 4 冲突，实测不可行） |
| Pydantic | `2.13.5` | FastMCP 4 硬性要求 `>=2.12.0` | 2.8.2（与 FastMCP 4 冲突，实测不可行） |
| Uvicorn / pytest / httpx2 | `0.52.4` / `9.1.1` / `2.12.0` | 与上述组合一次解析成功，实测可跑通；starlette 1.6 的 `TestClient` 优先导入 `httpx2` 并只在其缺失时回退 `httpx`，而 FastMCP 4 已传递引入 `httpx2`，回退分支不会被触发，因此直接声明实际被导入的 `httpx2` | — |
| 数据库驱动 | 标准库 `sqlite3`，每次操作短连接 | 工具函数是同步函数，FastMCP 默认在线程池执行；个人规模下连接开销可忽略 | `aiosqlite`（多一个依赖，收益为零） |
| 数据库路径 | `CAPSA_DB_PATH` 环境变量，默认 `/data/capsa.db`，**调用期解析** | 导入期解析会让测试无法替换路径 | 模块级常量（测试只能改真实路径） |
| 终局排序稳定性 | 两趟稳定排序：先按 id 降序，再按分值与时间升序键 | 排序键要求 id 方向与其余字段相反，Python 稳定排序用两行解决 | 自定义比较器（更啰嗦，性能更差） |
| 端到端测试通道 | `starlette.testclient.TestClient` 直接发 JSON-RPC | 实测内存传输拿不到鉴权上下文，覆盖不了越权与 401 断言 | `Client(mcp)` 内存传输（无法注入 auth）；`StreamableHttpTransport`（需真实端口） |
| SQLite 事务边界 | DAL 写函数自行 `commit()` | `sqlite3` 默认隐式开启事务，不提交则连接关闭时回滚（实测未提交数据重连后为 0 行）；提交责任收在写函数内，调用方无需记忆 | 调用方统一管理事务（CLI 与工具两条路径都要记得提交，漏一处即静默丢数据） |
| 参数超限的错误分层 | 工具级 `isError: true` | 框架在进入工具体前完成校验且统一渲染为工具错误；改造为协议层 `invalid params` 需在 FastMCP 调度之前接管校验，收益为零 | 协议层 `invalid params`（与框架正向冲突，且其余同类错误仍在工具层，分层反而不一致） |
| MCP 端点挂载方式 | `Route("/mcp", endpoint=mcp.http_app(path="/mcp"))` | `Mount("/mcp", ...)` 的路径正则为 `^/mcp/(?P<path>.*)$`，裸 `POST /mcp` 得到 307，跳转目标又因空路径 404（真实 uvicorn 实测）；改用子应用自带路径后 curl 与 FastMCP 客户端均直达鉴权层 | `Mount("/mcp", app=mcp.http_app(path="/"))`（规划文档原写法，实测两端都不通） |
| 异步测试依赖 | 不引入 | 全部经同步 TestClient 覆盖，无需 anyio/pytest-asyncio 插件 | 引入 pytest-asyncio（为一个用不上的能力加依赖） |
| 默认分组初始化 | 显式 `capsa init` 子命令 | 规划文档第零节第 3 条：服务启动禁止产生隐式业务数据 | 启动时自动插入（容器重启有副作用，测试受污染） |

---

## 5. 风险清单

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| FastMCP 4 的装配约束（挂载路径与 lifespan）易被遗漏，漏掉即全量 404 | 🟡 中 | 规划文档 §2.2 与 §4.2 的装配片段已按实测修正；§2.2 记录了两条约束的原因，TASK-015 的验收标准显式要求完成一次真实 MCP 握手 |
| FastMCP 把 `ids` 上限校验渲染成英文 pydantic 报错，与设计方案 §6.4 的"invalid params"分层不一致 | 🟡 中 | 在工具体内显式校验并抛中文 `ToolError`，把分层差异与实际行为记入 §7 待办 |
| `/data` 本机不存在，默认路径直接使用时建库失败 | 🟡 中 | 路径解析推迟到调用期；建库时自动创建父目录；测试全程用临时路径 |
| 本机无 Git 提交身份，Commit 阶段会被拒绝 | 🟡 中 | 在仓库级配置本地身份，不改动全局配置；提交前确认 |
| 检索为全量内存打分，超过约 3000 条后退化 | 🟢 低 | 设计方案给定了 hash 分片惰性扫描的升级路径，接口不变；本阶段不实现 |
| `sqlite3` 默认事务下漏提交导致写入静默丢失 | 🟡 中 | §4 已定下提交责任归 DAL 写函数；TASK-007 与 TASK-008 的验收标准要求关闭连接重开后数据仍在 |
| 三处规划文档偏差若被后续阶段遗忘，会以同样方式复发 | 🟢 低 | §2 集中记录，并由 Tasks 的验收标准逐条锚定 |

---

## 6. 阶段依赖关系

<figure>

<div style="border:1px solid #e5e7eb;border-radius:12px;padding:22px;background:#fafafa;color:#18181b;font-size:13px;line-height:1.6">

<div style="display:grid;grid-template-columns:1fr 22px 1fr 22px 1fr;align-items:stretch">

<div style="background:#ffffff;border:1px solid #2563eb;border-radius:8px;padding:14px">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#2563eb">PHASE 1.1</div>
  <div style="font-size:13px;font-weight:600;margin:6px 0 8px 0">工程骨架</div>
  <div style="font-size:11px;color:#52525b">排除规则 · 依赖锁定 · 包骨架</div>
</div>

<div style="display:flex;align-items:center;justify-content:center;color:#2563eb;font-weight:bold">→</div>

<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:14px">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#71717a">PHASE 1.2</div>
  <div style="font-size:13px;font-weight:600;margin:6px 0 8px 0">存储基座</div>
  <div style="font-size:11px;color:#52525b">建表 · PRAGMA · 三态批量查询 · 搜索列表 · 分组元数据</div>
</div>

<div style="display:flex;align-items:center;justify-content:center;color:#2563eb;font-weight:bold">→</div>

<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:14px">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#71717a">PHASE 1.3</div>
  <div style="font-size:13px;font-weight:600;margin:6px 0 8px 0">授权防线</div>
  <div style="font-size:11px;color:#52525b">Key 签发 · SHA256 校验 · 撤销即失效 · 1MB 拦截</div>
</div>

</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">

<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:14px">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#71717a">PHASE 1.4</div>
  <div style="font-size:13px;font-weight:600;margin:6px 0 8px 0">检索引擎与三级格式</div>
  <div style="font-size:11px;color:#52525b">二字组分词 · 加权打分 · 稳定排序 · L1/L2/L3 契约与截断</div>
</div>

<div style="background:#ffffff;border:1px solid #2563eb;border-radius:8px;padding:14px">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#2563eb">PHASE 1.5</div>
  <div style="font-size:13px;font-weight:600;margin:6px 0 8px 0">装配与验收</div>
  <div style="font-size:11px;color:#52525b">4 个只读工具 · 根应用与 /healthz · CLI · pytest 全套</div>
</div>

</div>

<div style="margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:11px;color:#71717a">
1.1 → 1.2 → 1.3 严格串行；1.4 只依赖 1.2；1.5 依赖 1.2 ~ 1.4 全部完成。无跨阶段并行写入冲突。
</div>

</div>

</figure>

---

## 7. 遗留待办（交由后续阶段）

| 事项 | 说明 |
|------|------|
| 规划文档回填 | 已完成：`Capsa_落地交付分期规划.md` §2.2 的依赖 pin、根应用装配片段、打分公式与 Jaccard 公式中的转义损坏、以及 §2.2 缺失的 `capsa init` 均已修正，与本 Plan 一致；执行期又发现 §2.2 与 §4.2 的 MCP 挂载片段不可用，一并修正为 `Route` 直挂 |
| `ids` 超限的错误分层 | 已决策为工具级 `isError: true`（见 §4），并已把 `AgentSpace 记忆服务设计方案.md` §6.4 的对应行改为工具执行错误，两份文档不再冲突 |
| Git 提交身份 | 仓库尚无提交历史且未配置身份，首次提交前需落定 |
