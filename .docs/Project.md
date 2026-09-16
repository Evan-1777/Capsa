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

- **一句话定位**：Capsa 是部署在个人 VPS 上的私人记忆服务，以 MCP 协议向 Agent 提供分组隔离、分级披露的长期记忆读写，并附带一套权限对称的 Web 管理台。
- **当前阶段**：Phase 4（单服务编排、宿主 TLS、CI 镜像交付）交付完成。
- **非目标**：不引入向量检索与自动抽取写入，不做多租户；Key 签发/撤销、分组维护与回收站 CLI 仍为管理员通道，不 Web 化。完整边界见 `SCOPE.md`。
- **设计与交付文档**：Phase 3 的设计方案、落地交付分期规划、可视化前端管理计划与架构功能报告归档于 `.docs/09-13-v3/docs/`；Phase 4 的部署形态收敛归档于 `.docs/09-16-v1/`。归档是带日期的历史快照，其中描述的容器编排形态以本文件与 `README.md` 为准

## 2. 环境与运行

- **运行平台**：Linux x86_64；本机开发，生产为 `docker compose` 部署到个人 VPS
  - 镜像由 GitHub Actions 手动触发构建并推送到 GHCR，`docker-compose.yml` 只拉取不构建；TLS 由宿主机反向代理终止，容器只发布回环端口
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
  # 回收站维护与检索同源审阅（管理员通道，不做 Key 作用域校验）
  CAPSA_DB_PATH=/data/capsa.db .venv/bin/capsa memory list-deleted [--group proj]
  CAPSA_DB_PATH=/data/capsa.db .venv/bin/capsa memory restore <memory_id>
  CAPSA_DB_PATH=/data/capsa.db .venv/bin/capsa review [--group proj] [--query 关键词] [--limit 20]
  # 在线热备与回灌（backup 的位置参数优先于 CAPSA_BACKUP_DIR，默认 /backup）
  CAPSA_DB_PATH=/data/capsa.db .venv/bin/capsa backup /backup [--keep-days 14]
  CAPSA_DB_PATH=/data/capsa.db .venv/bin/capsa restore /backup/capsa-YYYY-MM-DD.db
  # 启动服务
  .venv/bin/uvicorn capsa.server:app --host 127.0.0.1 --port 8000
  ```
  - ★ 易错：默认数据库路径 `/data/capsa.db` 在本机不存在，本地运行须先设置 `CAPSA_DB_PATH` 指向可写目录；未执行 `capsa init` 时 `/healthz` 返回 503 而非 200
- **如何构建前端**：`cd web && npm ci && npm run build`，产物落在 `capsa/static/`（该目录不入版本库，由 `capsa/server.py` 条件挂载）
  - ★ 易错：npm 必须走 `web/.npmrc` 指定的 `.devtools/npm-cache`；本机默认缓存目录不可写，不设会直接失败
- **如何测试**：Python 侧 `.venv/bin/python -m pytest -v`；前端侧 `cd web && npm run test:e2e`（Playwright 驱动系统 Chrome，经 `web/tests/serve.sh` 起真实 uvicorn）。两侧用例全程使用临时数据库，不触碰 `/data`
- **如何构建镜像**：仅手动触发。网页在仓库 Actions 页签选 `build-image`，命令行 `gh workflow run build-image.yml -f tag=v0.1.0`；本地等价命令 `docker build -t ghcr.io/evan-1777/capsa:dev .`。私有 GHCR 包需先 `docker login ghcr.io`（PAT 需 `read:packages`）
- **定时热备（宿主机 Cron）**：`0 3 * * * docker compose -f /opt/capsa/docker-compose.yml exec -T capsa capsa backup /backup`

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
├── server.py        # Starlette 根应用工厂，装配 /healthz、/mcp、/api 与静态根路径
├── web_api.py       # REST API：统一信封、Bearer 守卫与 8 个端点
├── static/          # 前端构建产物（不入版本库，缺失时不挂载根路由）
└── cli.py           # init / group / key / memory / review / backup / restore 子命令
web/                     # Capsa Studio：Vite + React 18 + TypeScript + Tailwind
├── vite.config.ts       # build.outDir 由 CAPSA_STATIC_DIR 决定，默认 ../capsa/static
├── playwright.config.ts # channel: "chrome"，webServer 指向 web/tests/serve.sh
├── src/api.ts           # 凭据（sessionStorage）、统一信封解析与 401 拦截
├── src/useAsync.ts      # 加载 / 空 / 错误 / 未授权四态的状态机
└── tests/e2e.spec.ts    # 浏览器端到端套件
README.md                # 定位、架构、部署、宿主反代接入与运维速查
Dockerfile               # 两阶段构建：Node 产出静态产物，Python 打包运行时
docker-compose.yml       # 单服务编排，只拉取 GHCR 镜像
.github/workflows/       # build-image.yml：手动触发的镜像构建
tests/
├── conftest.py             # 临时库、种子数据、HTTP MCP 会话与 web_headers 夹具
├── test_acceptance.py      # 六条 Phase 1 交付验收断言
├── test_e2e.py             # 只读链路、装配与"启动不写数据"断言
├── test_units.py           # 存储基座、DAL 契约、标识符与分词单测
├── test_cli.py             # CLI 幂等、令牌长度、撤销与持久化
├── test_write.py           # 写入字段契约、查重提示、生命周期与权限分级
├── test_web_api.py         # 8 个端点、统一信封、错误码映射与授权对称性
├── test_phase3_assembly.py # 路由顺序、静态根路径的条件挂载
├── test_phase3_cli.py      # review 同源序、backup/restore 快照链路
├── test_deploy.py          # Dockerfile / compose / Cron 的静态校验
└── test_ci_workflow.py      # 镜像构建工作流的触发器、权限与推送参数静态校验
```

## 4. 架构与数据流

- **核心模块**：`server.py` 是唯一 ASGI 入口（应用工厂 `create_app`），装配 starlette 内置 `RequestBodyLimitMiddleware`（1MB）后按 `/healthz → /mcp → /api → /` 顺序注册；`mcp_service.py` 与 `web_api.py` 是并列的两个传输适配层，两者内部都不出现 SQL，全部经 `dal.py` 访问数据
- **读数据流**：Agent → Bearer 令牌 → FastMCP 校验器（`auth.py`）→ 工具层读取 claims 中的 `key_id` 与 `grants` → `dal.py` 三态判定 → `retrieval.py` 打分排序 → `formatters.py` 渲染纯文本
- **写数据流**：适配层按 `grants` 校验 `rw` 权限与字段长度 → `retrieval.py` 规范化复核时间并计算标题近似度 → `dal.py` 写入并自行提交
- **Web 数据流**：浏览器 → `/api` 的 `BearerAuthGuard`（内部复用 `BearerAuthBackend(CapsaTokenVerifier())`，未认证直接回 401 信封）→ 处理器从 `request.user` 的 claims 读 `grants` → `dal.py` 三态判定 → JSON 统一信封（`{success, data, error}`）；静态根路径由同一根应用条件挂载，注册在 `/api` 之后，不得劫持 API
- **部署形态**：公网 → 宿主机反向代理（TLS 终止、响应不缓冲）→ 容器 `127.0.0.1:8000` → `capsa-data` 数据卷。应用层是唯一职责边界：容器自带 `/healthz` 健康检查与 1MB 请求体上限，宿主反代不重复配置上限，只须关闭响应缓冲以保证 MCP 流式下发
- **模块依赖**：`server → mcp_service/web_api → dal/retrieval/formatters → db`；`dal` 是唯一执行 SQL 的模块，`retrieval` 与 `formatters` 为纯函数模块
  - ★ 易错：`dal` 与 `db` 禁止反向依赖工具层；授权范围由调用方（工具层 / API 层）从请求令牌注入，DAL 不接受全局状态

## 5. 关键约定

- **命名约定**：模块与函数 snake_case；记忆 ID 为 `mem_` + 6 位随机串（总长 10），Key ID 为 8 位随机串，明文令牌为 `capsa_{key_id}_{32位随机串}`（总长 47）
- **注释 / 文档语言**：代码注释与标识符用英文，用户可见的工具描述、错误消息与 CLI 输出用中文
- **错误处理**：协议层问题走 HTTP 状态码（401 / 413），工具自身可给出可操作反馈的问题走工具级 `isError: true`；同一契约在 Web 侧映射为 HTTP 状态码与 `error.code`（401 `UNAUTHORIZED` / 403 `FORBIDDEN` / 404 `NOT_FOUND` / 422 `VALIDATION_ERROR` / 500 `INTERNAL_ERROR`），`error.message` 与 MCP 工具文本逐字相同；数据库不可用原样上报，不降级为业务错误
- **前端约定**：凭据只存 `sessionStorage`（键名 `capsa_key`），401 即刻清空并回登录态；正文 Markdown 必须经 `react-markdown` + `rehype-sanitize` 渲染，`skipHtml` 置真，不出现 `dangerouslySetInnerHTML`
- **时间约定**：所有时间以 ISO 8601 UTC 字符串存储与比较

## 6. 约束与已知坑

- MCP 端点用 `Route("/mcp", endpoint=mcp_app)` 挂载，子应用自带路径 `mcp.http_app(path="/mcp")`；不用 `Mount("/mcp", ...)`——原因：`Mount` 的路径正则是 `^/mcp/(?P<path>.*)$`，裸 `POST /mcp` 只得到 307 跳转，跳转目标又因空路径 404，标准 MCP 客户端与 `curl` 均无法连接（本机真实 uvicorn 实测）。FastMCP 4 的 `http_app()` 默认路径已是 `/mcp`，显式传入属冗余而非必需
- 请求体 1MB 拦截用 starlette 内置 `RequestBodyLimitMiddleware`，不自建 ASGI 中间件——原因：自建版本在分块分支抛出的异常会逃出 FastMCP 子应用被渲染为 500；内置中间件的声明式与分块式两条路径都返回 413。该 413 的响应体是中间件的纯文本，不经过 `/api` 的统一信封，因此不存在 `PAYLOAD_TOO_LARGE` 错误码
- `/api` 子应用自带异常处理器（`ToolError → 422`、`Exception → 500`），其 500 信封由处理器外的兜底发出后再向服务器重抛异常——原因：测试客户端默认会重抛，断言 500 用例须用 `TestClient(app, raise_server_exceptions=False)`
- FastMCP 子应用的 lifespan 必须交给根应用——原因：不传则 `/mcp` 请求抛 "task group was not initialized"
- 端到端鉴权与越权断言必须走 HTTP 链路，不得使用 `fastmcp.Client(mcp)` 内存传输——原因：该传输取不到鉴权上下文，`get_access_token()` 返回 `None`
- 数据库路径在调用期解析而非导入期——原因：导入期求值会让测试无法通过 `CAPSA_DB_PATH` 替换路径
- DAL 写函数自行 `commit()`——原因：`sqlite3` 默认隐式开启事务，漏提交会在连接关闭时静默回滚
- 服务启动路径不得创建分组或 Key——原因：容器重启会产生隐式业务数据并污染测试；初始化走显式 `capsa init`
- `forbidden` 判定只允许返回 `status` 与 `id` 两个键——原因：携带 `group_slug` 会泄露未授权分组名
- 写入路径的错误一律走工具级 `isError: true`，HTTP 状态码只留给协议层问题（401 / 413）——原因：字段超限、无写权限、目标不存在都是工具自身能给出可操作反馈的问题，与既有的 `ids` 上限分层一致
- 写入路径的 `forbidden` 与 `not_found` 共用同一文案模板，仅内嵌调用方自己传入的 id——原因：写工具的前置定位不做三态细分，未授权与不存在对调用方是同一件事
- Web 端 `PUT` / `DELETE` / `restore` 的 404 文案固定为「记忆不存在或无权访问」，**不回显调用方传入的 id**——原因：条目不存在、已软删除、分组不可见三种情形若可区分，响应体就成了探测未授权分组的侧信道
- 根应用按 `create_app(static_directory)` 工厂构造，静态目录由参数注入——原因：是否挂载根路由取决于构建产物当时是否存在，导入期定死的模块级常量无法在测试里替换
- npm 缓存固定到 `.devtools/npm-cache`（`web/.npmrc`）——原因：本机默认缓存目录不可写，npm 会直接报错退出
- Playwright 用 `channel: "chrome"` 驱动系统 Chrome——原因：本机已有 Chrome，下载自带 chromium 是约 300 MB 的一次性产物，与 SCOPE §5 冲突
- 私有 GHCR 包在 VPS 上拉取前必须 `docker login ghcr.io`——原因：仓库与包均为私有，未登录时 `docker compose pull` 直接返回 401
- compose 端口默认写 `${CAPSA_BIND:-127.0.0.1}:8000:8000`——原因：固定 `0.0.0.0` 在防火墙未配好时等于明文公网暴露，固定回环又让容器化反代无法接入；容器化反代用该变量指向宿主网桥地址覆盖
- 宿主反代必须关闭响应缓冲（Nginx 的 `proxy_buffering off`）——原因：MCP Streamable HTTP 逐块下发，缓冲会让连接成功但工具结果迟迟不返回；该职责原由 `Caddyfile` 的 `flush_interval -1` 承担，反代移出仓库后随之转移给宿主
- E2E 的服务与令牌由 `web/tests/serve.sh` 现场生成（临时库 + 两把 Key，令牌写入被忽略的 `web/tests/keys.json`）——原因：硬编码假令牌只能验证前端形态，无法覆盖真实鉴权链路

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
- 2026-09-13 Web 鉴权用单层 Bearer 守卫中间件，而非 starlette 的 `AuthenticationMiddleware`——理由：后者把未认证判定推给处理器，解析失败默认回 400 纯文本；守卫内部复用 MCP 同一个 `BearerAuthBackend(CapsaTokenVerifier())`，撤销即时生效，且只作用于 `/api` 子应用，不触碰 `/mcp` 与 `/healthz`
- 2026-09-13 字段校验与上限常量复用 `mcp_service.require_text` 与 `TITLE_MAX/SUMMARY_MAX/BODY_MAX`，不新建 `validation.py`——理由：一处契约一处文案，两侧只在 HTTP 分层上不同（MCP 回工具级 `isError`，Web 回 422 `VALIDATION_ERROR`）；为一个函数与三个常量引入新模块和一层胶水，收益为零
- 2026-09-13 关键词检索不在 SQL 里做过滤，`list_memories_for_web` 不接受 `query`——理由：命中判据与排序统一由 `retrieval.rank_memories` 承担，SQL `LIKE` 与二字组判据不等价（标签检索全盲、跨词命中丢失），且 `total` 会失真
- 2026-09-13 备份保留策略按文件名日期（`capsa-YYYY-MM-DD.db`）计算 14 天，不依赖 mtime——理由：确定性可测，跨文件系统复制不会改写文件名；快照用连接级 `Connection.backup()` 生成，WAL 模式下直接复制文件会产生损坏快照

- 2026-09-16 移除仓库自带的 Caddy 容器，TLS 与反向代理交给宿主机——理由：证书生命周期与应用发布解耦，宿主已有反代可直接复用；仓库内维护一份 Caddyfile 等于绑定一种反代选型
- 2026-09-16 compose 收敛为单服务且只写 `image` 不写 `build`——理由：VPS 无需 Node 与 pip 构建链，部署退化为 pull + up，镜像成为可回滚的版本化产物
- 2026-09-16 容器端口默认绑定回环并用 `CAPSA_BIND` 覆盖——理由：默认不向公网暴露明文端口，同时保留容器化反代的接入路径
- 2026-09-16 健康检查只保留 `Dockerfile` 的 `HEALTHCHECK`——理由：单服务后不再需要 `depends_on` 健康门控，compose 内重复声明会产生第二处间隔与超时定义
- 2026-09-16 镜像构建只在 CI 手动触发，工作流用内置 `GITHUB_TOKEN` 登录 GHCR——理由：用户要求手动点击，避免每次推送消耗配额；无长期密钥入库，权限按 `packages: write` 最小授予
- 2026-09-16 归档目录内的历史设计文档不回溯改写——理由：归档是带日期的历史快照，改写会让它与其时决策不符；事实变更记录在本文件与 `README.md`

## 9. 术语表

- `scope` = Key 的分组到权限映射，形如 `{"proj": "rw", "study": "r"}`，是授权边界的唯一来源
- `group_slug` = 分组标识（`proj` / `study` / `life` / `track`），既是分类也是授权边界，不对未授权方披露
- 三态 = 单条记忆相对当前 Key 的三种判定：`authorized` / `forbidden` / `not_found`
- L1 / L2 / L3 = 三级披露层级，分别对应标题层（`memory_search`）、摘要层（`memory_peek`）、正文层（`memory_read`）
