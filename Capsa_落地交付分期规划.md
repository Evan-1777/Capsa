# Capsa 记忆服务落地交付分期规划

本文档针对 `AgentSpace 记忆服务设计方案.md` 与系统架构设计，经批判性吸收三轮工程审计意见后，给出具备**确定性构建契约、完整错误分层、闭合安全防线、轻量 Web 记忆管理台与自动化端到端验收**的 **3 个 Main-Phase 落地交付规划**。

本规划专供 AI Code Agent 进行分期增量实现，三次交付完成后系统即达生产级基本完善状态。

---

## 零、前置已确认设计决策（规范基准）

在进入代码实施前，原方案中的待决事项与核心设计边界在本文档中统一闭合，作为后续所有阶段的唯一执行基准：

1. **权威实施基准声明**：本文档与根目录 `Capsa_可视化前端管理计划.md` 构成系统编码交付的权威技术基准。当 `AgentSpace 记忆服务设计方案.md` 中的历史讨论、遗留待决或“不做 Web 管理台”等叙述与本文档冲突时，以本文档为准。
2. **数据存储加密决策**：首版采用 **明文存盘**。数据安全性依仗 VPS 宿主机访问控制（非 root 容器运行、文件权限 600）与备份安全，不引入额外对称密钥管理复杂度。Capsa 取拉丁语原义「书匣/存放处」。
3. **默认分组初始化策略**：服务启动时**禁止自动产生隐式业务数据**（避免容器重启副作用及测试污染）。系统提供显式 CLI 命令 `capsa init`，供管理员首次安装时一键预置 `proj`（项目）、`study`（学习）、`life`（生活）、`track`（追踪）四个标准分组。
4. **复核时效 `review_at` 规范**：首版采用**条目级显式指定**（ISO 8601 UTC 字符串）。不维护复杂的分组默认周期表，保持单表极简模型。
5. **软删除原因落库规范**：`memories` 表包含 `deleted_reason TEXT` 字段。无论是 MCP `memory_forget` 还是 Web 软删除，均必须将删除原因随 `deleted_at` 一同入库，回收站与 CLI 审核时完整还原。
6. **未授权隐私隔离规范（防 group_slug 泄露）**：当请求的 ID 存在于数据库中但所属分组不在当前 Key 的授权范围时，系统**仅返回 `{status: "forbidden", id: id}`，严格屏蔽 `group_slug`、标题、摘要与正文**，杜绝攻击者探测敏感分组名称。
7. **ID 命名与长度全系统统一**：
   - **记忆 ID (`memory_id`)**：前缀 `mem_` + 6 位随机字符（字母与数字），总长度固定为 10（如 `mem_7f3ka2`）；
   - **Key 标识 (`key_id`)**：8 位随机字母数字（如 `a1b2c3d4`）；
   - **API Key 明文令牌**：`capsa_{key_id}_{secret_32}`，总长度固定为 47。
8. **Web 管理台定位演进与 MVP 收敛策略**：
   - **演进说明**：原方案曾将 Web 管理台列为待触发项，但实际个人 VPS 托管中，纯终端 CLI 存在跨设备查阅记忆与 Markdown 排版预览的操作痛点。因此启动 Web 控制台建设。
   - **MVP 范围收缩（杜绝提权与过度设计）**：
     - **Web 控制台专注高频使用**：聚焦于**记忆工作台（检索/阅读/编辑/新建）、时效复核中心（延期/排查）、回收站（恢复）**；
     - **CLI 保留低频运维**：**Key 签发与撤销、分组创建与维护、手动备份与恢复仍严格保留在 CLI**。
     - **权限绝对对称**：Web 界面完全复用后端 Bearer Key，界面可见范围与编辑权限严格受限于当前 Key 的 `scopes`，无任何超管提权漏洞。
9. **备份调度可靠性策略**：采用成熟的 **宿主机 Cron 调度 + CLI 幂等热备** 机制，不在单进程 Python 应用内部挂载常驻后台定时循环，保持单进程极简与高可靠。

---

## 一、分期交付全景

<figure>

<div style="border:1px solid #e5e7eb;border-radius:12px;padding:22px;background:#fafafa;color:#18181b;font-size:13px;line-height:1.6">

<div style="display:grid;grid-template-columns:1fr 24px 1fr 24px 1fr;gap:0;align-items:stretch">

<!-- Phase 1 -->
<div style="background:#ffffff;border:1px solid #2563eb;border-radius:8px;padding:16px;display:flex;flex-direction:column">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#2563eb">PHASE 1 · 只读基座与授权防线</div>
  <div style="font-size:14px;font-weight:600;margin:6px 0 10px 0;color:#18181b">存储基座、三态授权与三级只读</div>
  <div style="font-size:12px;color:#52525b;flex:1">
    • 锁定依赖工程骨架 (Starlette + FastMCP)<br>
    • SQLite WAL 存储 (含 deleted_reason 列)<br>
    • `authorized / forbidden / not_found` DAL 防线<br>
    • `forbidden` 彻底杜绝 `group_slug` 泄露<br>
    • Bearer Key SHA256 鉴权与实时校验<br>
    • 确定性二字组分词与内存打分引擎<br>
    • 4 个只读工具与 `/healthz` 独立探活
  </div>
  <div style="border-top:1px solid #e5e7eb;margin-top:12px;padding-top:10px;font-size:11px;color:#71717a">
    <strong>交付形态</strong>: 权限绝对隔离、L1~L3 协议就绪的只读 MCP 服务
  </div>
</div>

<!-- Arrow 1 -->
<div style="display:flex;align-items:center;justify-content:center;color:#2563eb;font-weight:bold;font-size:16px">
  →
</div>

<!-- Phase 2 -->
<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;display:flex;flex-direction:column">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#2563eb">PHASE 2 · 写入生命周期与管控</div>
  <div style="font-size:14px;font-weight:600;margin:6px 0 10px 0;color:#18181b">完整生命周期、查重与软删除闭环</div>
  <div style="font-size:12px;color:#52525b;flex:1">
    • 3 个写入工具 (`save` / `update` / `forget`)<br>
    • 读写权限分级 (`r` 拦截, `rw` 放行)<br>
    • 字段超限严格阻断 (60/200/64000 报实际字数)<br>
    • 增量更新与显式清空语义 (`clear_review_at`)<br>
    • 同分组二字组 Jaccard 查重提示 (≥0.6)<br>
    • `review_at` 过期自动扣分与标记<br>
    • 软删除落库 reason 与 CLI 恢复 (`restore`)
  </div>
  <div style="border-top:1px solid #e5e7eb;margin-top:12px;padding-top:10px;font-size:11px;color:#71717a">
    <strong>交付形态</strong>: 7 个工具完全就绪、读写与恢复闭环的应用核心
  </div>
</div>

<!-- Arrow 2 -->
<div style="display:flex;align-items:center;justify-content:center;color:#2563eb;font-weight:bold;font-size:16px">
  →
</div>

<!-- Phase 3 -->
<div style="background:#ffffff;border:1px solid #2563eb;border-radius:8px;padding:16px;display:flex;flex-direction:column">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#2563eb">PHASE 3 · 可视化管理与生产交付</div>
  <div style="font-size:14px;font-weight:600;margin:6px 0 10px 0;color:#18181b">Web 控制台、在线热备与容器编排</div>
  <div style="font-size:12px;color:#52525b;flex:1">
    • <strong>Capsa Studio MVP</strong> (工作台/复核/回收站)<br>
    • Markdown 严格 XSS 净化 (`rehype-sanitize`)<br>
    • 后端 REST API (`/api/*`) 完整 JSON 信封<br>
    • DAL 扩展 `list_memories_for_web` 接口<br>
    • 完整路由挂载 (`/healthz` / `/mcp` / `/api` / `/`)<br>
    • 宿主机 Cron 调度 + `capsa backup` CLI 热备<br>
    • 双轨自动化测试 (Python API + Playwright 浏览器)
  </div>
  <div style="border-top:1px solid #e5e7eb;margin-top:12px;padding-top:10px;font-size:11px;color:#71717a">
    <strong>交付形态</strong>: 兼具视觉工作台与一键运维的完整生产系统
  </div>
</div>

</div>

</div>

</figure>

### 交付对比与职责分工矩阵

<figure>

<div style="border:1px solid #e5e7eb;border-radius:12px;padding:20px;background:#fafafa;color:#18181b;font-size:13px">

<div style="display:grid;grid-template-columns:90px 1.2fr 1.3fr 1.5fr;gap:0;font-size:12px">

<div style="padding:8px 10px;font-size:11px;letter-spacing:.06em;color:#71717a">阶段</div>
<div style="padding:8px 10px;font-size:11px;letter-spacing:.06em;color:#2563eb">目标范围</div>
<div style="padding:8px 10px;font-size:11px;letter-spacing:.06em;color:#71717a">交付接口与工具</div>
<div style="padding:8px 10px;font-size:11px;letter-spacing:.06em;color:#71717a">硬性验收指标</div>

<!-- P1 -->
<div style="padding:12px 10px;border-top:1px solid #e5e7eb;font-weight:600;color:#18181b">Phase 1</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">
  存储底座 (含 reason 列)、DAL 三态防线 (屏蔽 group_slug)、Key 鉴权、二字组打分、只读契约、/healthz 探活
</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb;font-family:ui-monospace,monospace">
  GET /healthz<br>
  memory_groups<br>
  memory_search (L1)<br>
  memory_peek (L2)<br>
  memory_read (L3)<br>
  capsa group / key CLI
</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">
  • 越权返回 `forbidden` 且不泄露 `group_slug` 与正文<br>
  • 撤销 Key 下次调用即刻 401<br>
  • `/healthz` 无认证探测返回 200<br>
  • 请求体 > 1MB 拦截 413<br>
  • L1/L2/L3 格式及体积截断契约达标
</div>

<!-- P2 -->
<div style="padding:12px 10px;border-top:1px solid #e5e7eb;font-weight:600;color:#18181b">Phase 2</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">
  写入契约、读写权限分级、字段非截断校验、增量更新与清空、查重、软删除 reason 入库与恢复
</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb;font-family:ui-monospace,monospace">
  memory_save<br>
  memory_update<br>
  memory_forget<br>
  capsa memory list-deleted<br>
  capsa memory restore CLI
</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">
  • 只读 Key 写入阻断报错 (`isError: true`)<br>
  • 超长字段拒绝写入并提示具体字数<br>
  • 相似度 ≥ 0.6 正常落库并附加提示<br>
  • 软删除记录 reason，CLI 恢复完全闭环
</div>

<!-- P3 -->
<div style="padding:12px 10px;border-top:1px solid #e5e7eb;font-weight:600;color:#18181b">Phase 3</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">
  Capsa Studio (Web MVP)、完整 Starlette 路由挂载、DAL Web 列表接口、宿主机备份调度、Playwright 浏览器测试
</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb;font-family:ui-monospace,monospace">
  Capsa Studio (SPA)<br>
  REST API (/api/*)<br>
  dal.list_memories_for_web<br>
  capsa review / backup CLI<br>
  Dockerfile & Compose
</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">
  • 完整路由挂载：/healthz /mcp /api 及静态根路径生效<br>
  • Web 界面功能闭环，Playwright 浏览器测试通过<br>
  • Markdown 脚本与恶意伪协议被白名单严格过滤<br>
  • 宿主机热备调度正常生成有效快照<br>
  • Compose 容器健康检查通过，反代无缓冲
</div>

</div>

</div>

</figure>

---

## 二、Phase 1：数据基座、三态授权防线与三级只读协议

### 2.1 目标与构建逻辑

Phase 1 建立确定性的 Python 工程标准，实现 SQLite 存储（预置 `deleted_reason`）、统一参数化 DAL 入口、Bearer Key 校验、独立健康探测端点（`/healthz`）、1MB 请求体中间件，并交付符合三级披露体积契约的 4 个 MCP 工具与基础 CLI。

### 2.2 详细设计与交付契约

#### 1. 构建依赖与运行环境契约 (`pyproject.toml`)
```toml
[project]
name = "capsa"
version = "0.1.0"
description = "Personal Agent Memory Service over MCP"
requires-python = ">=3.12"
# starlette 与 pydantic 的版本下限由 fastmcp 4 决定（fastmcp-slim[server] 要求
# starlette>=1.0.1、pydantic>=2.12.0），不能按更低版本钉死
# 测试依赖用 httpx2：starlette 1.6 的 TestClient 优先导入 httpx2，
# 仅在缺失时回退 httpx 并告警
dependencies = [
    "fastmcp==4.0.0",
    "starlette==1.6.0",
    "uvicorn[standard]==0.52.4",
    "pydantic==2.13.5",
]

[project.optional-dependencies]
test = [
    "pytest==9.1.1",
    "httpx2==2.12.0",
]

[project.scripts]
capsa = "capsa.cli:main"

[build-system]
requires = ["hatchling==1.25.0"]
build-backend = "hatchling.build"
```

- **本地安装与运行命令**：
  ```bash
  pip install -e ".[test]"
  uvicorn capsa.server:app --host 127.0.0.1 --port 8000
  ```
- **测试执行命令**：
  ```bash
  pytest -v
  ```

#### 2. 外层 ASGI 容器与架构规范 (`capsa/server.py`)
确立 **Starlette** 为根 ASGI 应用。严格规定路由注册顺序，保证具体前缀不被静态根路径劫持。

**挂载方式**：子应用自带 `/mcp` 路径（`mcp.http_app(path="/mcp")`），根应用用 `Route("/mcp", endpoint=mcp_app)` 直接挂载。

不用 `mcp.http_app(path="/")` 配合 `Mount("/mcp", ...)`：`Mount` 的路径正则是 `^/mcp/(?P<path>.*)$`，裸 `POST /mcp` 得到一个 307 跳转；而跳转目标 `/mcp/` 下子应用收到的是空路径，按 `path="/"` 编译的路由无法匹配，返回 404 Not Found。以上行为已在本机对真实 uvicorn 进程实测。FastMCP 自身客户端会跟随该跳转，但 404 会直接中断连接；`curl` 等不跟随跳转的客户端则连不上。

```python
# capsa/server.py
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.responses import JSONResponse
from capsa.middleware import RequestSizeLimitMiddleware
from capsa.db import check_db_health
from capsa.mcp_service import mcp # FastMCP("capsa") 实例

async def healthz(request):
    ok = check_db_health()
    if ok:
        return JSONResponse({"status": "ok"}, status_code=200)
    return JSONResponse({"status": "error", "message": "database unavailable"}, status_code=503)

# FastMCP 子应用自带 /mcp 路径；其 lifespan 必须交给根应用，
# 否则 /mcp 请求抛 "task group was not initialized"
mcp_app = mcp.http_app(path="/mcp")

# 基础路由（Phase 1 范围）
routes = [
    Route("/healthz", endpoint=healthz, methods=["GET"]),
    Route("/mcp", endpoint=mcp_app, methods=["GET", "POST", "DELETE"]),
]

# Phase 3 将在此追加 Mount("/api", app=web_api_app) 与 Mount("/", app=StaticFiles(...))

app = Starlette(routes=routes, lifespan=mcp_app.lifespan)
app.add_middleware(RequestSizeLimitMiddleware, max_bytes=1048576) # 1MB 拦截
```

#### 3. 数据表结构与索引 (`capsa/db.py`)
默认数据路径为 `/data/capsa.db`（支持环境变量 `CAPSA_DB_PATH` 覆盖）。强制启用 WAL 与外键约束：
```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS groups (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS keys (
    id TEXT PRIMARY KEY,           -- 8 位字符，如 a1b2c3d4
    name TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL, -- SHA256(plain_token)
    scopes TEXT NOT NULL,          -- JSON: {"proj": "rw", "study": "r"}
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,           -- mem_ + 6位字符，如 mem_7f3ka2
    group_slug TEXT NOT NULL REFERENCES groups(slug),
    title TEXT NOT NULL CHECK(length(title) <= 60),
    summary TEXT NOT NULL CHECK(length(summary) <= 200),
    body TEXT NOT NULL CHECK(length(body) <= 64000),
    tags TEXT NOT NULL DEFAULT '[]', -- JSON 数组
    review_at TEXT,                -- UTC ISO8601，可空
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,               -- 软删除时间戳，NULL 表示有效
    deleted_reason TEXT            -- 软删除原因，供回收站展示与审计
);

CREATE INDEX IF NOT EXISTS idx_memories_group_order
ON memories(group_slug, pinned DESC, updated_at DESC);
```

#### 4. DAL 三态授权模型与参数化查询 (`capsa/dal.py`)
- **三态批查询 (`get_memories_batch_for_access`)**：
  - 查询 SQL：`SELECT ... FROM memories WHERE id IN (?, ...) AND deleted_at IS NULL`；
  - 对每个 ID 判定：
    1. `not_found`：未查到（或已软删除）；
    2. `authorized`：记录存在且 `row.group_slug in scopes`，返回全字段；
    3. `forbidden`：记录存在但所属分组未在当前 `scopes` 中。**仅返回 `{status: "forbidden", id: id}`，严格屏蔽 `group_slug`、title、summary、body、tags**，防范未授权分组名泄露。
- **专有搜索列表 (`list_active_memories_for_search`)**：专供检索引擎使用，拼接参数化 SQL：`WHERE group_slug IN (?, ...) AND deleted_at IS NULL`。
- **分组元数据查询 (`list_groups_with_counts`)**：返回授权范围内的分组名、描述、权限及有效条目数。

#### 5. 鉴权层与请求体大小防护 (`capsa/auth.py` & `capsa/middleware.py`)
- **Key 格式**：明文为 `capsa_{key_id}_{secret_32}`；
- **SHA256 实时查验**：提取 Bearer Token 并计算 SHA256，验证 `revoked_at IS NULL`，校验通过后异步刷新 `last_used_at`；
- **1MB 请求体限制中间件**：在 ASGI 层拦截请求体，超过 1,048,576 字节直接响应 HTTP 413。

#### 6. 确定性打分与排序算法 (`capsa/retrieval.py`)
- **归一化**：Unicode NFC 转换 + 转小写；时间以 UTC 为准；
- **分词与二字组**：按标点与空格分词，中文提取 bigrams，合并集合去重得词元集合 T；
- **打分公式**（T 为查询词元集合，命中为二元判定，命中计 1）：
  ```
  score(m, T)
    = 4 × Σ 命中(m.title,   t)   t ∈ T
    + 1 × Σ 命中(m.summary, t)
    + 2 × Σ 命中(m.tags,    t)
    + 3  当 m.pinned
    - 2  当 m.review_at 已过期
  ```
  标签按数组元素逐一比对；
- **稳定排序元组**：`(-score, -pinned, -updated_at_epoch, id DESC)`。空查询稳定按置顶与更新时间倒序返回。

#### 7. 只读工具与固定纯文本契约 (`capsa/formatters.py`)
注册 4 个只读工具：`memory_groups`、`memory_search` (L1)、`memory_peek` (L2)、`memory_read` (L3)。
- 契约控制：单条正文 4000 字符切片并标注剩余；单次响应总正文达 20000 字符截断；末尾附带精准的 `> 下一步:` 或 `> 续读:` 引导。对 `forbidden` 条目仅输出 `[{i}] {id} | [无权访问]`，不泄露分组名称。

#### 8. 基础 CLI 命令 (`capsa/cli.py`)
- `capsa init`：预置第零节第 3 条约定的 `proj` / `study` / `life` / `track` 四个标准分组，重复执行不报错；服务启动路径不得自动创建分组
- `capsa group add <slug> <name> --desc "<description>"` / `capsa group list`
- `capsa key create <name> --scopes "<slug1:rw,slug2:r>"` / `capsa key revoke <key_id>` / `capsa key list`

### 2.3 Phase 1 交付验收断言
- [ ] **启动与依赖验收**：`pip install -e ".[test]"` 安装成功；`GET /healthz` 返回 200 `{"status": "ok"}`；
- [ ] **1MB 拦截验收**：向 `POST /mcp` 发送 1.1MB 数据体，准确返回 HTTP 413；
- [ ] **鉴权与撤销验收**：未授权 Token 返回 401；执行 `capsa key revoke` 后立即返回 401；
- [ ] **三态防线隔离验收**：未授权条目在 `memory_peek` 明确返回 `[无权访问]`，且**完全不泄漏 `group_slug`、标题与摘要**；
- [ ] **打分与排序确定性验收**：中文二字组命中准确；空查询稳定按置顶与更新时间倒序输出；
- [ ] **体积截断与续读验收**：5000 字符正文切片为 4000 字符并附带 `> 续读:` 标签。

---

## 三、Phase 2：写入管控、完整生命周期与安全防线

### 3.1 目标与构建逻辑

Phase 2 在只读基座之上构建完整的写入与数据维护能力。重点实现严格的读写权限分级、字段非截断硬阻断、同分组二字组近似查重提示、增量修改与清空语义，以及软删除原因落库与管理员 CLI 恢复闭环。

### 3.2 详细设计与交付契约

#### 1. 字段硬契约与报错规范（拒绝写入，严禁静默截断）
- `title`：必须非空字符串，长度 ≤ 60 字符。超限报错：`标题超长 (当前 X 字符，上限 60 字符，拒绝写入)`；
- `summary`：必须非空字符串，长度 ≤ 200 字符。超限报错：`摘要超长 (当前 X 字符，上限 200 字符，拒绝写入)`；
- `body`：长度 ≤ 64000 字符。超限报错：`正文超长 (当前 X 字符，上限 64000 字符，拒绝写入)`；
- `review_at`：若提供，必须符合 ISO 8601 格式，落库时转换为 UTC 时间字符串。

#### 2. 近似重复检测算法 (`capsa/retrieval.py`)
新建记忆落库前扫描目标分组有效条目的标题二字组，计算 Jaccard 相似度 J(A, B) = |A ∩ B| / |A ∪ B|。若存在 J ≥ 0.6，记录正常保存，并在响应中提示相似条目，由 Agent 自主决策。

#### 3. 写入工具集与签名契约 (`capsa/mcp_service.py`)
1. `memory_save(group: str, title: str, summary: str, body: str, tags: list[str] | None = None, review_at: str | None = None)`：校验 `rw` 权限与字段长度，查重并落库；
2. `memory_update(id: str, title: str | None = None, summary: str | None = None, body: str | None = None, tags: list[str] | None = None, review_at: str | None = None, clear_review_at: bool = False, pinned: bool | None = None)`：支持增量更新，支持 `clear_review_at=True` 置空复核时间，支持空列表 `[]` 清空标签；
3. `memory_forget(id: str, reason: str)`：执行软删除：`UPDATE memories SET deleted_at = ?, deleted_reason = ? WHERE id = ?`。

#### 4. 软删除原因落库与管理员 CLI 恢复闭环
- **全局过滤**：所有读操作和检索引擎均过滤 `deleted_at IS NULL`；
- **CLI 恢复命令**：
  - `capsa memory list-deleted [--group <slug>]`：列出回收站条目，展示 ID、分组、删除时间与 `deleted_reason`；
  - `capsa memory restore <memory_id>`：执行 `UPDATE memories SET deleted_at = NULL, deleted_reason = NULL WHERE id = ?`，恢复可见。

### 3.3 Phase 2 交付验收断言
- [ ] **写权限拦截断言**：只读 Key 调用 3 个写入工具均被拒绝（`isError: True`）；
- [ ] **字段超限阻断断言**：超限输入直接报错并返回当前字数，数据未落库；
- [ ] **近似查重提示断言**：高似标题保存成功并附带相似条目告警；
- [ ] **增量更新断言**：局部修改成功，`clear_review_at=True` 成功置空复核时间；
- [ ] **软删除与恢复闭环断言**：软删除记录并入库 `deleted_reason`；执行 CLI restore 后重新可见。

---

## 四、Phase 3：可视化管理台、生产容器化与在线热备交付

### 4.1 目标与构建逻辑

Phase 3 负责系统的最终生产封装与用户交互体验升华。AI Code Agent 必须交付：
1. **轻量可视化管理台（Capsa Studio MVP）**：专注记忆工作台、时效复核中心与回收站，严格防范 XSS 与权限提升；
2. **完整 Starlette 路由装配**：在 `server.py` 中明确挂载 `/healthz`、`/mcp`、`/api` 与静态根路径 `/`；
3. **专有 DAL Web 查询接口 (`list_memories_for_web`)**：覆盖 `active`、`overdue`、`deleted` 三态检索与分页；
4. **宿主机 Cron 调度 + CLI 幂等热备**：交付高可靠的 `capsa backup` CLI 与宿主机 Crontab 一行配置；
5. **人机同源审阅**：交付 `capsa review` 审阅命令；
6. **生产容器编排**：多阶段 Dockerfile（Node 零残留）、Caddy 流式反代编排与 `/healthz` 探活联动；
7. **双轨端到端自动化测试套件**：覆盖 Agent MCP 链路与 Web 界面自动化（Playwright）。

### 4.2 详细设计与交付契约

#### 1. 最终 Starlette 路由完整挂载契约 (`capsa/server.py`)
Phase 3 中，`capsa/server.py` 拓展为包含 Web API 与静态前端的完整定义：
```python
# capsa/server.py (Phase 3 最终形态)
# 注意：MCP 端点用 Route 直接挂载，不用 Mount("/mcp", ...)，
# 否则裸 /mcp 会得到 307 跳转（见 §2.2 第 2 节）
import os
from starlette.applications import Starlette
from starlette.routing import Mount, Route
from starlette.responses import JSONResponse
from starlette.staticfiles import StaticFiles
from capsa.middleware import RequestSizeLimitMiddleware
from capsa.db import check_db_health
from capsa.mcp_service import mcp
from capsa.web_api import web_api_app # Starlette RESTful 子应用

async def healthz(request):
    ok = check_db_health()
    if ok:
        return JSONResponse({"status": "ok"}, status_code=200)
    return JSONResponse({"status": "error", "message": "database unavailable"}, status_code=503)

static_dir = os.path.join(os.path.dirname(__file__), "static")

# FastMCP 子应用自带 /mcp 路径，根应用用 Route 直接挂载
mcp_app = mcp.http_app(path="/mcp")

# 严格按顺序注册路由：先具体前缀，后根路径静态托管
routes = [
    Route("/healthz", endpoint=healthz, methods=["GET"]),
    Route("/mcp", endpoint=mcp_app, methods=["GET", "POST", "DELETE"]), # FastMCP Streamable HTTP
    Mount("/api", app=web_api_app),           # Web RESTful API
]

if os.path.isdir(static_dir):
    routes.append(Mount("/", app=StaticFiles(directory=static_dir, html=True)))

app = Starlette(routes=routes, lifespan=mcp_app.lifespan)
app.add_middleware(RequestSizeLimitMiddleware, max_bytes=1048576) # 1MB 拦截
```

#### 2. DAL Web 列表接口规范 (`capsa/dal.py`)
为消除 Web 接口自行拼 SQL 的隐患，在 `dal.py` 显式扩展专供 Web 列表的查询函数：
```python
def list_memories_for_web(
    scopes: dict[str, str],
    status: str = "active",  # "active" | "overdue" | "deleted"
    group: str | None = None,
    query: str | None = None,
    offset: int = 0,
    limit: int = 20,
) -> tuple[list[dict], int]:
    """
    专供 Web 端调用的记忆列表与检索入口。
    - 严格依据 scopes 进行 group_slug 参数化过滤 (WHERE group_slug IN (?, ...))
    - status == 'active': deleted_at IS NULL
    - status == 'overdue': deleted_at IS NULL AND review_at IS NOT NULL AND review_at < datetime.now(timezone.utc).isoformat()
    - status == 'deleted': deleted_at IS NOT NULL (包含 deleted_reason 字段)
    - query: 支持关键词与二字组匹配过滤
    - 返回: (items, total_count)
    """
```

#### 3. 后端 RESTful API 规范与信封 (`capsa/web_api.py`)
挂载于 Starlette 根应用的 `/api` 前缀下。统一输出信封：
- 列表成功格式：`{"success": true, "data": {"items": [...], "total": N, "offset": 0, "limit": 20}, "error": null}`
- 单条成功格式：`{"success": true, "data": { ... }, "error": null}`
- 失败格式：`{"success": false, "data": null, "error": {"code": "...", "message": "..."}}`
- 错误码枚举：`UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `PAYLOAD_TOO_LARGE` (413), `VALIDATION_ERROR` (422), `INTERNAL_ERROR` (500)。
- 核心端点列表：
  - `GET /api/auth/me`：校验 Key 并返回 `{key_id, name, scopes}`；
  - `GET /api/groups`：获取当前 Key 授权分组与统计；
  - `GET /api/memories`：调用 `dal.list_memories_for_web`；
  - `GET /api/memories/{id}`：获取单条记忆详情；
  - `POST /api/memories`：新建记忆（60/200/64k 校验与查重提示）；
  - `PUT /api/memories/{id}`：增量更新（支持 `clear_review_at`）；
  - `DELETE /api/memories/{id}`：软删除（入参 `reason`，落库 `deleted_reason`）；
  - `POST /api/memories/{id}/restore`：从回收站恢复记忆。

#### 4. 轻量 Web 管理台 SPA (Capsa Studio MVP)
前端工程置于 `web/`，采用 **Vite + React 18 + Tailwind CSS + Lucide Icons** 构建：
- **凭据生命周期**：仅存于 `sessionStorage`，401 立即销毁退出，绝不写入持久化 `localStorage`；
- **Markdown 安全清洗**：引入 `rehype-sanitize`，禁用原始 HTML，白名单限制链接协议（仅放行 `http/https/mailto`）；
- **3 大核心视图**：
  1. **记忆工作台 (Memory Studio)**：分组标签胶囊筛选、实时搜索、Markdown 优雅排版、带实时字数指示的原地抽屉式编辑器；
  2. **时效复核中心 (Review Center)**：聚合 `review_at < NOW()` 的到期记忆，提供一键延期或删除；
  3. **回收站 (Recycle Bin)**：陈列已软删除条目，显示删除原因与时间戳，支持一键恢复。
- **视图状态完备性**：每个视图均具备加载骨架屏（Skeleton）、空数据提示（Empty State）、网络错误重试、脏表单防丢二次确认，以及小于 768px 的移动端单栏响应式自适应。

#### 5. 高可靠宿主机热备与同源审阅
- **CLI 备份与恢复 (`capsa backup` / `capsa restore`)**：利用 SQLite 原生 `backup()` API 实现原子快照，自动保留 14 天内备份；
- **VPS 自动化定时热备**：采用标准 Cron 调度，在宿主机 crontab 部署单行任务，稳定可靠无额外常驻开销：
  ```bash
  # 每日凌晨 3 点调用容器执行在线热备
  0 3 * * * docker compose -f /opt/capsa/docker-compose.yml exec -T capsa capsa backup /backup
  ```
- **同源审阅 CLI (`capsa review`)**：复用 `retrieval.py` 中的打分排序函数，输出纯文本列表，保证人机视野 100% 同源。

#### 6. 生产容器多阶段构建与编排

**`Dockerfile`**（多阶段构建，容器内零 Node.js 运行时）：
```dockerfile
# Stage 1: Build Frontend Assets
FROM node:20-alpine AS web-builder
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: Production Python Runtime
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    CAPSA_DB_PATH=/data/capsa.db

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 -s /bin/bash capsa \
    && mkdir -p /data /backup /app/capsa/static \
    && chown -R capsa:capsa /app /data /backup

COPY --chown=capsa:capsa pyproject.toml .
COPY --chown=capsa:capsa capsa/ capsa/
COPY --from=web-builder --chown=capsa:capsa /web/dist/ capsa/static/

RUN pip install --no-cache-dir .

USER capsa
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8000/healthz || exit 1

CMD ["uvicorn", "capsa.server:app", "--host", "0.0.0.0", "--port", "8000"]
```

**`docker-compose.yml`**：
```yaml
services:
  capsa:
    build: .
    restart: unless-stopped
    environment:
      - CAPSA_DB_PATH=/data/capsa.db
    volumes:
      - capsa-data:/data
      - capsa-backup:/backup
    expose:
      - "8000"

  caddy:
    image: caddy:alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    environment:
      - CAPSA_DOMAIN=${CAPSA_DOMAIN:-localhost}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      capsa:
        condition: service_healthy

volumes:
  capsa-data:
  capsa-backup:
  caddy-data:
  caddy-config:
```

**`Caddyfile`**：
```caddy
{$CAPSA_DOMAIN:localhost} {
    request_body {
        max_size 1MB
    }

    # 反代至后端，flush_interval -1 禁用响应缓冲以保证流式传输实时性
    reverse_proxy capsa:8000 {
        flush_interval -1
    }
}
```

#### 7. 双轨端到端测试套件规范 (E2E Test Suites)
1. **套件一：Agent 标准 MCP 交互烟测 (5 步)**：`memory_groups` → `memory_save` → `memory_search` → `memory_peek` → `memory_read`；
2. **套件二：生产与 Web 管理全生命周期测试 (7 步)**：新建记忆 → 检索审查 → 增量更新与清空 → 软删除（校验 reason） → 回收站恢复 → 宿主机热备验库 → 413 超限拦截；
3. **套件三：Playwright 浏览器前端烟测 (`npm run test:e2e`)**：覆盖凭据存销、401 清理、XSS 净化、375px 移动端单栏与核心 CRUD 浏览器自动化测试。

### 4.3 Phase 3 交付验收断言
- [ ] **完整路由装配断言**：`GET /` 成功返回前端页面，`GET /healthz` 返回 200，`POST /mcp` 正常握手，`GET /api/memories` 正常响应；
- [ ] **Web 界面与 XSS 防护断言**：注入 `<script>` 或 `javascript:` 链接被完全清洗无执行；
- [ ] **Playwright 浏览器测试断言**：运行 `npm run test:e2e`，凭据存销、401 清理、XSS 拦截、375px 移动端单栏全绿通过；
- [ ] **全流程 CRUD 与回收站断言**：界面创建、Markdown 排版展示、软删除填写 reason、回收站展示 reason 并一键恢复成功；
- [ ] **宿主机热备断言**：调用 `capsa backup` 生成有效快照文件，自动清理 14 天前旧文件；
- [ ] **人机排序同源断言**：CLI `capsa review` 排序与 MCP `memory_search` 100% 一致；
- [ ] **自动化 E2E 全通断言**：5 步 Agent 烟测与 7 步生命周期测试通过率 100%。

---

## 五、AI Code Agent 交付执行清单与上下文指引

<figure>

<div style="border:1px solid #e5e7eb;border-radius:12px;padding:20px;background:#fafafa;color:#18181b;font-size:13px">

<div style="display:grid;grid-template-columns:110px 1.2fr 1.5fr;gap:0;font-size:12px">

<div style="padding:8px 10px;font-size:11px;letter-spacing:.06em;color:#71717a">交付阶段</div>
<div style="padding:8px 10px;font-size:11px;letter-spacing:.06em;color:#2563eb">输入上下文与前置依赖</div>
<div style="padding:8px 10px;font-size:11px;letter-spacing:.06em;color:#71717a">交付产物与检查清单</div>

<div style="padding:12px 10px;border-top:1px solid #e5e7eb;font-weight:600;color:#18181b">Delivery 1<br>(Phase 1)</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">
  • `AgentSpace 记忆服务设计方案.md`<br>
  • 本文档第零节与第二节<br>
  • 空工程工作区
</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">
  • `pyproject.toml`、`server.py` (Starlette + /healthz)<br>
  • `db.py` (含 deleted_reason)、`dal.py` (三态防线，屏蔽 group_slug)<br>
  • `auth.py`、`retrieval.py`、4 个只读工具、基础 CLI<br>
  • 运行 `pytest` 测试通过率 100%
</div>

<div style="padding:12px 10px;border-top:1px solid #e5e7eb;font-weight:600;color:#18181b">Delivery 2<br>(Phase 2)</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">
  • Phase 1 已验收的代码库<br>
  • 本文档第三节
</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">
  • 3 个写入工具 (`save` / `update` / `forget`)<br>
  • 字段长度硬校验 (超限报实际字数)<br>
  • 二字组 Jaccard ≥ 0.6 查重提示<br>
  • 软删除落库 `deleted_reason` 与 `capsa memory restore` CLI<br>
  • 运行 `pytest` 写入与恢复测试通过率 100%
</div>

<div style="padding:12px 10px;border-top:1px solid #e5e7eb;font-weight:600;color:#18181b">Delivery 3<br>(Phase 3)</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">
  • Phase 2 已验收的代码库<br>
  • 本文档第四节与 `Capsa_可视化前端管理计划.md`
</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">
  • `server.py` 完整装配挂载 (/healthz, /mcp, /api, /)<br>
  • `dal.py` 实现 `list_memories_for_web` 查询接口<br>
  • `capsa/web_api.py` 挂载 REST 路由 (统一信封)<br>
  • `web/` SPA 前端工程 (Playwright 自动化测试通过)<br>
  • `capsa backup` CLI 与宿主机 Cron 调度说明<br>
  • 多阶段 Dockerfile / Compose / Caddyfile<br>
  • 5 步 Agent 烟测、7 步生命周期与 Playwright 测试全通
</div>

</div>

</div>

</figure>

### 给 AI Code Agent 的五条铁律
1. **三态授权收口于 DAL，权限零提升**：工具层与 Web API 层严禁自行组装 SQL；所有条目读取必须由 `dal.py` 返回三态判定；越权条目禁止返回 `group_slug`；Web 端与 MCP 客户端共享相同的 Bearer Key 边界，不设立超管特权通道。
2. **完整装配根 Starlette 路由**：严格按照 `/healthz` → `/mcp` → `/api` → `/` 的顺序挂载路由，确保前端静态服务不劫持具体 API 前缀。
3. **Web 前端零常驻 Node 进程与 XSS 严格净化**：前端必须采用静态 SPA 架构，经多阶段构建注入 Python 容器；渲染 Markdown 时必须通过 `rehype-sanitize` 白名单清洗，严禁执行原始 HTML 与伪协议。
4. **健康检查走专有 `/healthz`**：容器 HEALTHCHECK 与 Compose 探活必须通过专有的 `GET /healthz` 端点进行，严禁向需要协议握手的 `/mcp` 发送未经认证的 GET 请求。
5. **测试必须完全可独立自动化验证**：每个 Main-Phase 均须提供可一键执行的自动化测试套件（pytest 与 npm run test:e2e），断言必须覆盖边界与异常流程。
