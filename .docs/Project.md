# Project

> **本文件是项目的「单一事实来源」**，供 AI Agent 动手前快速建立全局认知。
>
> - **维护原则**：代码库变更后必须同步本文件——对照 §0 维护速查判断要改哪节，而非凭感觉。
> - **边界**：项目定位与设计原则见 `SCOPE.md`，工作流规则见 `AGENTS.md`，本文件不重复，仅在需要处引用。

## 0. 维护速查

| 变更类型 | 需更新章节 |
|----------|-----------|
| 新增 / 升级 / 移除库依赖 | §2 环境与运行（属关键选型时另记 §8） |
| 新增 / 重构 / 删除模块 | §3 目录结构、§4 架构与数据流 |
| 调整命名 / 编码 / 日志规范 | §5 关键约定 |
| 踩到新坑或确立新约束 | §6 约束与已知坑 |
| 关键技术选型定型 | §8 决策记录 |
| 引入项目特有名词 | §9 术语表 |
| 运行 / 启动 / 测试方式变化 | §2 环境与运行 |

## 1. 概述

- **一句话定位**：Capsa 是部署在个人 VPS 上的私人记忆服务，以 MCP 只读协议向 Agent 提供分组隔离、分级披露的长期记忆检索。
- **当前阶段**：开发中——Phase 2（写入生命周期、近似查重与软删除闭环）交付完成。
- **非目标**：不引入向量检索与自动抽取写入，不做多租户；Web 管理台、容器化与热备归 Phase 3。完整边界见 `SCOPE.md`。

## 2. 环境与运行

- **运行平台**：Linux x86_64；本机开发，生产为 `docker compose` 部署到个人 VPS
- **Shell**：bash
- **版本管理**：git，主干分支 `master`
- **语言 / 运行时**：Python 3.12.14，由仓库内 uv 0.12.13 落位的独立 CPython 提供；系统仅 3.14 且缺 ensurepip，不可用
  - ★ 易错：解释器固定为 `.venv/bin/python`；选 3.12 而非系统 3.14 是为了与生产镜像 `python:3.12-slim` 对齐
- **依赖管理**：`pyproject.toml`（hatchling 构建后端）。`starlette` 与 `pydantic` 的版本下限由 FastMCP 4 决定，不可向下钉死
- **如何运行**：
  ```bash
  # 首次或 pyproject.toml 变更后
  .venv/bin/python -m pip install -e ".[test]"
  # 初始化数据库与标准分组（服务启动不建任何业务数据，未建表时 /healthz 返回 503）
  CAPSA_DB_PATH=/data/capsa.db .venv/bin/capsa init
  # 回收站维护（管理员通道，不做 Key 作用域校验）
  CAPSA_DB_PATH=/data/capsa.db .venv/bin/capsa memory list-deleted [--group proj]
  CAPSA_DB_PATH=/data/capsa.db .venv/bin/capsa memory restore <memory_id>
  # 启动服务
  .venv/bin/uvicorn capsa.server:app --host 127.0.0.1 --port 8000
  ```
  - ★ 易错：默认数据库路径 `/data/capsa.db` 在本机不存在，本地运行须先设置 `CAPSA_DB_PATH` 指向可写目录；未执行 `capsa init` 时 `/healthz` 返回 503 而非 200
- **如何测试**：`.venv/bin/python -m pytest -v`；用例全程使用临时数据库，不触碰 `/data`

## 3. 目录结构与模块职责

```
capsa/
├── __init__.py      # 包声明
├── db.py            # 连接辅助、幂等建表、健康检查
├── dal.py           # 三态授权数据访问层与记忆写读入口，唯一 SQL 出口
├── ids.py           # 标识符与令牌生成
├── auth.py          # 令牌校验器，接入 FastMCP 鉴权
├── retrieval.py     # 归一化、二字组分词、打分排序与复核时间规范化、标题近似查重
├── formatters.py    # L1/L2/L3 与分组列表的纯文本契约
├── mcp_service.py   # FastMCP 实例与 4 个只读工具、3 个写入工具
├── server.py        # Starlette 根应用，挂载 /healthz 与 /mcp
└── cli.py           # init / group / key / memory 子命令
tests/
├── conftest.py          # 临时库、种子数据、HTTP MCP 会话夹具
├── test_acceptance.py   # 六条 Phase 1 交付验收断言
├── test_e2e.py          # 只读链路、装配与"启动不写数据"断言
├── test_units.py        # 存储基座、DAL 契约、标识符与分词单测
├── test_cli.py          # CLI 幂等、令牌长度、撤销与持久化
└── test_write.py        # 写入字段契约、查重提示、生命周期与权限分级
```

## 4. 架构与数据流

- **核心模块**：`server.py` 是唯一 ASGI 入口，装配 starlette 内置 `RequestBodyLimitMiddleware`（1MB）后挂载 `/healthz` 与 `/mcp`；`mcp_service.py` 承载工具层，工具内不出现 SQL，全部经 `dal.py` 访问数据
- **读数据流**：Agent → Bearer 令牌 → FastMCP 校验器（`auth.py`）→ 工具层读取 claims 中的 `key_id` 与 `grants` → `dal.py` 三态判定 → `retrieval.py` 打分排序 → `formatters.py` 渲染纯文本
- **写数据流**：工具层按 `grants` 校验 `rw` 权限与字段长度 → `retrieval.py` 规范化复核时间并计算标题近似度 → `dal.py` 写入并自行提交
- **模块依赖**：`server → mcp_service → dal/retrieval/formatters → db`；`dal` 是唯一执行 SQL 的模块，`retrieval` 与 `formatters` 为纯函数模块
  - ★ 易错：`dal` 与 `db` 禁止反向依赖工具层；授权范围由调用方（工具层）从请求令牌注入，DAL 不接受全局状态

## 5. 关键约定

- **命名约定**：模块与函数 snake_case；记忆 ID 为 `mem_` + 6 位随机串（总长 10），Key ID 为 8 位随机串，明文令牌为 `capsa_{key_id}_{32位随机串}`（总长 47）
- **注释 / 文档语言**：代码注释与标识符用英文，用户可见的工具描述、错误消息与 CLI 输出用中文
- **错误处理**：协议层问题走 HTTP 状态码（401 / 413），工具自身可给出可操作反馈的问题走工具级 `isError: true`；数据库不可用原样上报，不降级为业务错误
- **时间约定**：所有时间以 ISO 8601 UTC 字符串存储与比较

## 6. 约束与已知坑

- MCP 端点用 `Route("/mcp", endpoint=mcp_app)` 挂载，子应用自带路径 `mcp.http_app(path="/mcp")`；不用 `Mount("/mcp", ...)`——原因：`Mount` 的路径正则是 `^/mcp/(?P<path>.*)$`，裸 `POST /mcp` 只得到 307 跳转，跳转目标又因空路径 404，标准 MCP 客户端与 `curl` 均无法连接（本机真实 uvicorn 实测）。FastMCP 4 的 `http_app()` 默认路径已是 `/mcp`，显式传入属冗余而非必需
- 请求体 1MB 拦截用 starlette 内置 `RequestBodyLimitMiddleware`，不自建 ASGI 中间件——原因：自建版本在分块分支抛出的异常会逃出 FastMCP 子应用被渲染为 500；内置中间件的声明式与分块式两条路径都返回 413
- FastMCP 子应用的 lifespan 必须交给根应用——原因：不传则 `/mcp` 请求抛 "task group was not initialized"
- 端到端鉴权与越权断言必须走 HTTP 链路，不得使用 `fastmcp.Client(mcp)` 内存传输——原因：该传输取不到鉴权上下文，`get_access_token()` 返回 `None`
- 数据库路径在调用期解析而非导入期——原因：导入期求值会让测试无法通过 `CAPSA_DB_PATH` 替换路径
- DAL 写函数自行 `commit()`——原因：`sqlite3` 默认隐式开启事务，漏提交会在连接关闭时静默回滚
- 服务启动路径不得创建分组或 Key——原因：容器重启会产生隐式业务数据并污染测试；初始化走显式 `capsa init`
- `forbidden` 判定只允许返回 `status` 与 `id` 两个键——原因：携带 `group_slug` 会泄露未授权分组名
- 写入路径的错误一律走工具级 `isError: true`，HTTP 状态码只留给协议层问题（401 / 413）——原因：字段超限、无写权限、目标不存在都是工具自身能给出可操作反馈的问题，与既有的 `ids` 上限分层一致
- 写入路径的 `forbidden` 与 `not_found` 共用同一文案模板，仅内嵌调用方自己传入的 id——原因：写工具的前置定位不做三态细分，未授权与不存在对调用方是同一件事

## 8. 决策记录

- 2026-09-12 选 SQLite 标准库 `sqlite3` 短连接而非 `aiosqlite`——理由：工具函数为同步函数，由 FastMCP 在线程池执行，个人规模下连接开销可忽略，多一个依赖无收益
- 2026-09-12 测试依赖声明 `httpx2` 而非 `httpx`——理由：starlette 1.6 的 `TestClient` 优先导入 `httpx2`，FastMCP 4 已传递引入该包，声明 `httpx` 属未被使用的依赖
- 2026-09-12 检索采用内存全量打分而非 FTS5——理由：SQLite 的 `unicode61` 分词器对中文召回为 0，`trigram` 令两字中文查询失效，引入分词库等于背上词典依赖；个人记忆库规模在毫秒级
- 2026-09-12 `ids` 超限报错落在工具级 `isError: true` 而非 JSON-RPC `invalid params`——理由：框架在进入工具体前完成校验，改到协议层需在调度之前接管参数校验，收益为零
- 2026-09-13 MCP 端点用 `Route` 直挂而非 `Mount("/mcp", ...)`——理由：`Mount` 不接受裸 `/mcp`，会先 307 再 404；改用子应用自带路径后，`curl` 与 FastMCP 客户端都能直达鉴权层，Phase 3 追加 `/api` 与静态根路径时同样按此顺序
- 2026-09-13 关键词查询按"词元命中"过滤，而非按总分——理由：置顶（+3）与过期复核（-2）是排序权重，不是命中判据；若用总分过滤，置顶但完全无关的条目会被召回。命中判据独立为标题、摘要、标签任一含查询词元，列出无命中条目只是噪声
- 2026-09-13 请求体 1MB 拦截改用 starlette 内置 `RequestBodyLimitMiddleware`——理由：自建 ASGI 中间件在分块分支抛出的异常会逃出 FastMCP 子应用，被上层渲染成 500；内置中间件是既有依赖，声明式与分块式两条路径都稳定返回 413
- 2026-09-13 局部更新用白名单字段字典、`None` 表示置空——理由：Python 签名无法同时表达"未提供"与"显式置空"，为覆盖单个字段引入哨兵对象只增加概念，调用方还容易传错
- 2026-09-13 记忆 ID 主键冲突时重新生成并重试至多 3 次；调用方显式传入的 ID 一旦冲突直接抛 `DuplicateMemoryId`，不静默改号——理由：6 位随机串在万条量级的碰撞已到可观测概率，三行重试即可消除用户可见的随机失败，加长 ID 或预生成唯一池都会改变已锁定的 ID 契约；显式 ID 属于调用方的意图，重试改号违背该意图
- 2026-09-13 `update_memory` 与 `soft_delete_memory` / `restore_memory` 一致，只对 `deleted_at IS NULL` 的条目生效——理由：回收站条目只经 CLI `restore` 回到活跃态，写工具不应绕过这一状态机
- 2026-09-13 写工具的权限拒绝文案不带 Key ID——理由：`_key_id()` 在无令牌 claim 的环境下取到空串，拼进文案只会产出「Key  对分组 …」这样的破损文本；调用方正是该 Key 的持有者，Key ID 对其无信息量
- 2026-09-13 标题近似查重只提示不拦截，条目照常落库——理由：误拦截的代价高于误提示，是否重复由 Agent 结合上下文判断
- 2026-09-13 回收站 CLI 不做 Key 作用域校验——理由：与既有的 `group` / `key` 子命令口径一致，CLI 本就是持有数据库的管理员通道，签发与撤销也只在 CLI

## 9. 术语表

- `scope` = Key 的分组到权限映射，形如 `{"proj": "rw", "study": "r"}`，是授权边界的唯一来源
- `group_slug` = 分组标识（`proj` / `study` / `life` / `track`），既是分类也是授权边界，不对未授权方披露
- 三态 = 单条记忆相对当前 Key 的三种判定：`authorized` / `forbidden` / `not_found`
- L1 / L2 / L3 = 三级披露层级，分别对应标题层（`memory_search`）、摘要层（`memory_peek`）、正文层（`memory_read`）
