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
| 调整检索匹配范围或打分权重 | §4 架构与数据流、§9 术语表 |
| 运行 / 启动 / 测试方式变化 | §2 环境与运行 |

## 1. 概述

- **一句话定位**：Capsa 是部署在个人 VPS 上的私人记忆服务，以 MCP 协议向 Agent 提供分组隔离、分级披露的长期记忆读写，并附带一套全权限单管理员 Web 管理台。
- **当前阶段**：Phase 8（Web 管理台 Fluent 2 完全重写）交付完成。
- **非目标**：不引入向量检索与自动抽取写入，不做多租户，不引入独立用户表、多角色 RBAC 与 Cookie/Session；回收站 CLI 仍为管理员通道。分类删除与 Key 签发/吊销/删除已纳入 Web 管理台。完整边界见 `SCOPE.md`。
- **设计与交付文档**：Phase 3 的设计方案、落地交付分期规划、可视化前端管理计划与架构功能报告归档于 `.docs/09-13-v3/docs/`；Phase 4 的部署形态收敛归档于 `.docs/09-16-v1/`。归档是带日期的历史快照，其中描述的容器编排形态以本文件与 `README.md` 为准；Phase 6 的检索能力扩展归档于 `.docs/09-17-v2/`

## 2. 环境与运行

- **运行平台**：Linux x86_64；本机开发，生产为 `docker compose` 部署到个人 VPS（1Panel 实战部署指南见 `docs/1panel-deployment-guide.md`）
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
  - 可选：设置 `CAPSA_ADMIN_TOKEN` 后，该字符串本身即是管理台管理员令牌，无需落库；未配置或仅含空白时不启用该通道
  - ★ 易错：管理台（`/api`）只接受通配 `*:rw` 凭据，普通分组 Key 一律被网关拒绝为 403；Agent 侧的 `/mcp` 不受此限
  - ★ 易错：默认数据库路径 `/data/capsa.db` 在本机不存在，本地运行须先设置 `CAPSA_DB_PATH` 指向可写目录；未执行 `capsa init` 时 `/healthz` 返回 503 而非 200
- **如何构建前端**：`cd web && npm ci && npm run build`，产物落在 `capsa/static/`（该目录不入版本库，由 `capsa/server.py` 条件挂载）
  - ★ 易错：npm 必须走 `web/.npmrc` 指定的 `.devtools/npm-cache`；本机默认缓存目录不可写，不设会直接失败
- **如何测试**：Python 侧 `.venv/bin/python -m pytest -v`；前端侧 `cd web && npm run test:e2e`（Playwright 驱动系统 Chrome，经 `web/tests/serve.sh` 起真实 uvicorn）。两侧用例全程使用临时数据库，不触碰 `/data`
- **如何构建镜像**：仅手动触发。网页在仓库 Actions 页签选 `build-image`，命令行 `gh workflow run build-image.yml -f tag=v0.1.0`；本地等价命令 `docker build -t ghcr.io/evan-1777/capsa:dev .`。私有 GHCR 包需先 `docker login ghcr.io`（PAT 需 `read:packages`）
- **定时热备（宿主机 Cron）**：`0 3 * * * docker compose -f /opt/capsa/docker-compose.yml exec -T capsa capsa backup /backup`

## 3. 目录结构与模块职责

```
docs/
└── 1panel-deployment-guide.md # 1Panel 现代化运维面板部署 Capsa 实战指南
capsa/
├── __init__.py      # 包声明
├── db.py            # 连接辅助、幂等建表、健康检查
├── dal.py           # 三态授权数据访问层与记忆写读入口，唯一 SQL 出口
├── ids.py           # 标识符与令牌生成
├── auth.py          # 令牌校验器，接入 FastMCP 鉴权与管理级环境变量令牌
├── permissions.py   # 权限判定单一事实来源：permission_for 与管理级令牌常量
├── retrieval.py     # 归一化、二字组分词、打分排序（含正文低权重兜底）与标题近似查重
├── formatters.py    # 三级披露与分组列表的纯文本契约
├── mcp_service.py   # FastMCP 实例与 4 个只读工具、3 个写入工具
├── server.py        # Starlette 根应用工厂，装配 /healthz、/mcp、/api 与静态根路径
├── web_api.py       # REST API：统一信封、管理员网关守卫与多个 REST 端点
├── static/          # 前端构建产物（不入版本库，缺失时不挂载根路由）
└── cli.py           # init / group / key / memory / review / backup / restore 子命令
web/                     # Capsa Studio：Fluent 2 + React 18 + TypeScript + Tailwind
├── vite.config.ts       # build.outDir 由 CAPSA_STATIC_DIR 决定，默认 ../capsa/static
├── playwright.config.ts # channel: "chrome"，webServer 指向 web/tests/serve.sh
├── src/styles/index.css # Fluent 2 语义令牌层（CSS 变量）与排版工具类
├── tailwind.config.js   # 映射 Fluent 2 颜色、圆角与深度阴影
├── src/api.ts           # 凭据（sessionStorage）、统一信封解析与 401 拦截
├── src/components/ui/   # Fluent 2 原语层（Button, FormField, Inputs, Card, Badge, Dialog, States）
├── src/components/      # 视图与 App Shell（Sidebar.tsx, TopBar.tsx, Login.tsx, MemoryList.tsx, MemoryDetail.tsx, Markdown.tsx, EditDrawer.tsx, GroupManager.tsx, KeyManager.tsx, ReviewCenter.tsx, RecycleBin.tsx）
├── src/useAsync.ts      # 加载 / 空 / 错误 / 未授权四态的状态机
└── tests/e2e.spec.ts    # 浏览器端到端套件（12 条用例）
README.md                # 定位、架构、部署、宿主反代接入与运维速查
Dockerfile               # 两阶段构建：Node 产出静态产物，Python 打包运行时
docker-compose.yml       # 单服务编排，只拉取 GHCR 镜像
.github/workflows/       # build-image.yml：手动触发的镜像构建
tests/
├── conftest.py             # 临时库、种子数据、HTTP MCP 会话与 web_headers 夹具
├── test_acceptance.py      # 六条 Phase 1 交付验收断言
├── test_e2e.py             # 只读链路、装配与"启动不写数据"断言
├── test_units.py           # 存储基座、DAL 契约（含正文按需投影）、标识符、分词与打分单测
├── test_cli.py             # CLI 幂等、令牌长度、撤销与持久化
├── test_write.py           # 写入字段契约、查重提示、生命周期与权限分级
├── test_web_api.py         # 10 个端点、统一信封、错误码映射、管理员网关与分类生命周期
├── test_phase3_assembly.py # 路由顺序、静态根路径的条件挂载
├── test_phase3_cli.py      # review 同源序、backup/restore 快照链路
├── test_deploy.py          # Dockerfile / compose / Cron 的静态校验
└── test_ci_workflow.py      # 镜像构建工作流的触发器、权限与推送参数静态校验
```

## 4. 架构与数据流

- **核心模块**：`server.py` 是唯一 ASGI 入口（应用工厂 `create_app`），装配 starlette 内置 `RequestBodyLimitMiddleware`（1MB）后按 `/healthz → /mcp → /api → /` 顺序注册；`mcp_service.py` 与 `web_api.py` 是并列的两个传输适配层，两者内部都不出现 SQL，全部经 `dal.py` 访问数据
- **读数据流**：Agent → Bearer 令牌 → FastMCP 校验器（`auth.py`）→ 工具层读取 claims 中的 `key_id` 与 `grants` → `dal.py` 三态判定 → `retrieval.py` 打分排序 → `formatters.py` 渲染纯文本
- **写数据流**：适配层经 `permissions.permission_for(grants, group)` 判定 `rw` 与字段长度 → `retrieval.py` 规范化复核时间并计算标题近似度 → `dal.py` 写入并自行提交
- **权限判定单一来源**：`permissions.permission_for` 是唯一的有效权限计算函数，DAL、MCP 工具层与 `/api` 处理器共用；任一 `*` 通配都覆盖全库（是否可见与读写级别正交），`permission_for` 再逐条决定该分组是 `r` 还是 `rw`
- **检索范围与打分**：`memory_search` 默认只匹配标题（4 分）、摘要（1 分）与标签（2 分）；`include_body=True` 时经 `dal.list_active_memories_for_search(include_body=True)` 追加投影 `body` 列并并入命中判定，正文命中每词元 0.2 分、封顶 0.8 分，低于摘要单次命中的 1 分，因此同词下标题命中严格排在正文命中之前。空 `query` 是浏览而非检索，工具层以非空 query 收敛 `load_body`，此类请求一律不投影正文
- **正文兜底的能力边界**：`include_body` 只属于 MCP 工具层。Web 管理台与人审 `capsa review` 共用 `dal`/`retrieval` 的默认元数据检索，不暴露该参数，也不加载正文
- **Web 数据流**：浏览器 → `/api` 的 `BearerAuthGuard`（内部复用 `BearerAuthBackend(CapsaTokenVerifier())`）：未认证回 401 信封，凭据不含 `*:rw` 回 403 信封 → 处理器从 `request.user` 的 claims 读 `grants` → `dal.py` 三态判定 → JSON 统一信封（`{success, data, error}`）；分类经 `POST /api/groups`、`PUT /api/groups/{slug}` 与 `DELETE /api/groups/{slug}` 维护（仅空分类可删，存储层原子校验）；凭据经 `GET/POST /api/keys`、`POST /api/keys/{id}/revoke` 与 `DELETE /api/keys/{id}` 深度管理（仅已吊销可删，防管理员自锁与虚拟凭据拦截）；静态根路径由同一根应用条件挂载，注册在 `/api` 之后，不得劫持 API
- **部署形态**：公网 → 宿主机反向代理（TLS 终止、响应不缓冲）→ 容器 `127.0.0.1:8000` → `capsa-data` 数据卷。应用层是唯一职责边界：容器自带 `/healthz` 健康检查与 1MB 请求体上限，宿主反代不重复配置上限，只须关闭响应缓冲以保证 MCP 流式下发
- **模块依赖**：`server → mcp_service/web_api → dal/retrieval/formatters → db`；`dal` 是唯一执行 SQL 的模块，`retrieval` 与 `formatters` 为纯函数模块
  - ★ 易错：`dal` 与 `db` 禁止反向依赖工具层；授权范围由调用方（工具层 / API 层）从请求令牌注入，DAL 不接受全局状态

## 5. 关键约定

- **命名约定**：模块与函数 snake_case；记忆 ID 为 `mem_` + 6 位随机串（总长 10），Key ID 为 8 位随机串，明文令牌为 `capsa_{key_id}_{32位随机串}`（总长 47）
- **注释 / 文档语言**：代码注释与标识符用英文，用户可见的工具描述、错误消息与 CLI 输出用中文
- **错误处理**：协议层问题走 HTTP 状态码（401 / 413），工具自身可给出可操作反馈的问题走工具级 `isError: true`；同一契约在 Web 侧映射为 HTTP 状态码与 `error.code`（401 `UNAUTHORIZED` / 403 `FORBIDDEN` / 404 `NOT_FOUND` / 422 `VALIDATION_ERROR` / 500 `INTERNAL_ERROR`），`error.message` 与 MCP 工具文本逐字相同；数据库不可用原样上报，不降级为业务错误
- **前端约定**：凭据只存 `sessionStorage`（键名 `capsa_key`），401 即刻清空并回登录态，403 提示仅支持管理员凭据并同样清空；界面采用 Fluent 2 体系，以 CSS 变量承载语义令牌并通过根节点 `data-theme` 切换（持久化于 `localStorage` 键 `capsa_theme`，`index.html` 首帧内联脚本即时挂载防闪烁），分为 Layer 0–3 物理层级（Mica 画布、Acrylic 导航与顶栏、Depth 4 卡片、Depth 16 弹层）；正文与排版收敛为 `text-body`（13px/20px）与 `text-caption`（12px/16px）；实心按钮采用 `--color-fill-foreground` 确保深色高对比（WCAG AAA 8:1~13:1）；弹层走原生 `<dialog>` 与 `showModal()`；组件统一基于克制规范的 `ui/` 原语构建；正文 Markdown 必须经 `react-markdown` + `rehype-sanitize` 渲染，`skipHtml` 置真，不出现 `dangerouslySetInnerHTML`
- **MCP 工具契约**：工具描述与参数注解只陈述可观察事实（返回什么、上限多少、需要何种权限），不写调用顺序训诫或负向告诫；三级披露边界由各工具描述中立陈述，字段级自解释注解用 `typing.Annotated` + `pydantic.Field` 声明
- **管理级令牌规范**：`CAPSA_ADMIN_TOKEN` 每次请求读取环境变量，非空即启用，身份固定为 `id="admin"`、`grants={"*": "rw"}`；轮换方式为更新环境变量并重启服务
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
- E2E 的服务与令牌由 `web/tests/serve.sh` 现场生成（临时库 + 管理员与分组两把 Key，令牌写入被忽略的 `web/tests/keys.json`）——原因：硬编码假令牌只能验证前端形态，无法覆盖真实鉴权链路；管理台用例必须持通配管理员 Key，分组 Key 用于验证网关拦截
- 分类标识 `slug` 创建后严格不可变，编辑只改名称与描述——原因：`memories(group_slug)` 依赖该唯一标识做外键参照，允许改名就要级联重写全部记忆
- `add_group` 用 `INSERT OR IGNORE` 的 `rowcount` 表达插入结果，不先查后插——原因：先查后插在并发下会静默成功却未入库（TOCTOU），唯一约束在 SQL 内原子裁决
- 正文字段按需投影，默认查询不选 `body` 列；含正文字段的命中判据与打分只在 MCP 兜底检索路径开启——原因：正文是库内体积最大的列，全库浏览或默认检索把它读进内存只增加 VPS 的峰值占用，而兜底召回只在元数据未命中时才有价值
- 空 `query` 的浏览请求即使传入 `include_body=True` 也不投影正文——原因：此时没有关键词可供打分，正文加载不产生任何召回收益，只留下全库扫描正文的开销；守卫落在工具层一次收敛，不散到 DAL

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
- 2026-09-17 Web 管理台收敛为单管理员面板，`/api` 网关强制核验 `*:rw` 并拒绝其他凭据——理由：单人场景下管理台是服务拥有者的全局控制台，而 `/mcp` 面向 Agent 保持分组隔离；只在前端拦截会留下绕过浏览器直接调用的缺口，边界必须落在唯一入口
- 2026-09-17 权限判定提取为 `permissions.permission_for` 纯函数，位于 `auth`/`dal`/`mcp_service` 之下的独立模块——理由：同一规则原先散落在 DAL 与两处工具层，通配支持若逐点补齐必然漏改；单一函数让所有调用方一次性获得一致判定，且不引入循环导入
- 2026-09-17 管理级令牌走环境变量而非独立管理员表——理由：服务拥有者只有一人，键值与令牌的映射不构成需要维护的状态；环境变量每次请求读取，轮换只需改值重启，同时避免为单人场景引入用户表与密码管理
- 2026-09-17 分类创建与编辑放入 Web 管理台，`POST /api/groups` 返回 422 表达 slug 冲突——理由：分类是记忆的组织维度，日常维护发生在管理界面；创建与编辑语义正交于 `GET /groups`，复用既有信封与错误码映射即可，无需新错误码

- 2026-09-17 `memory_search` 的正文兜底检索采用"条件投影 + 非空 query 守卫"——理由：正文只在显式开启且 query 非空时进内存，默认检索与全库浏览的开销与改动前完全一致；守卫落在工具层一处，DAL 只负责按传入值决定字段投影，两侧职责不重叠
- 2026-09-17 正文命中用非对称低权重（0.2/词元，封顶 0.8）而非与元数据等权——理由：正文是长文本，词频远高于标题与摘要，等权打分会让正文命中条目在排序上逆袭标题命中条目；把单次正文命中压到低于摘要命中的 1 分，可保证同词下元数据命中严格优先，同时仍能让只在正文出现的细节被召回
- 2026-09-17 移除 MCP 工具层的全局 `USAGE` 微操文本，改为中立披露契约与字段级注解——理由：跨工具重复的"先 search 再 peek 最后 read"训诫在每次工具调用都占用上下文，且与工具自身的返回结构重复；披露边界由各工具描述中立陈述、参数含义由 `Field(description=...)` 自解释，Agent 的调用顺序交给模型自主规划
- 2026-09-17 `include_body` 只暴露给 MCP 工具，Web 与 CLI 不提供——理由：正文兜底是为自主 Agent 在细节召回失败时的推理补偿；管理台面向人工浏览（有分页与详情视图），`review` 是确定性的元数据审阅，两者都不需要全库正文扫描，接口面扩大没有对应场景
- 2026-09-17 分类删除原子化契约——理由：DAL 在 BEGIN IMMEDIATE 写锁事务内原子执行"存在性检查+记忆关联（含回收站）检查+删除"，消除 Web 业务层先查后删的 TOCTOU 竞态与并发插入导致的 IntegrityError/500 异常
- 2026-09-17 CLI 与 Web 端 Key 签发输入校验对齐——理由：CLI key create 在落库前统一校验名称长度、非空 scopes、有效分组与 r/rw 权限值，防止 CLI 入口误入悬空脏数据
- 2026-09-17 delete_revoked_key 状态约束下沉 DAL——理由：物理删除前原子校验 revoked_at 非空，拒绝直接删除活跃 Key，保持 get_key 契约不变且防止并发竞态
- 2026-09-17 环境变量管理员虚拟凭据边界——理由：CAPSA_ADMIN_TOKEN 每次从环境读取，服务无状态管理，不落库、不进 Key 列表、不可作为管理接口操作目标，防自锁统一拦截
- 2026-09-17 分类删除后的悬空 Key Scope 语义——理由：仅允许删除无记忆空分类，保留历史 Key 中的已配置 Scope；记忆库无记忆即无越权风险，若重建同名分类则权限自然衔接，避免级联重写 JSON 产生数据副作用
- 2026-09-17 凭据单次明文披露交互轻量克制——理由：创建后弹层安全展示明文并提供一键复制，关闭后内存立即销毁，不搞 beforeunload 页面拦截或剪贴板监控，符合个人 VPS 工具定位
- 2026-09-20 Web 管理台完全重写采用自建 Fluent 2 语义令牌与原语层，而非引入 Fluent UI React v9 或第三方组件库——理由：个人 VPS 工具优先轻量与零新增依赖，既有 Tailwind + CSS 变量即可表达完整 Fluent 2 令牌、Layer 0–3 材质层级与深度阴影；引入外部大组件库产物膨胀数倍且带来双样式体系维护负担
- 2026-09-20 弹层统一采用原生 <dialog> 与 showModal() 表达 Layer 3 表面——理由：焦点约束、Esc 关闭与背景 inert 由浏览器平台原生提供，无需手写焦点循环或外置 focus-trap 依赖；全屏透明重置 UA 边距后既可承载居中 Modal，亦可承载右侧滑出抽屉
- 2026-09-20 UI 原语与令牌层规范收敛与死代码剔除——理由：严格按 Ponytail 原则淘汰未使用的过度设计分支（Card 的 clickable/selected、Dialog 的 drawer、Button 的 subtle 及零引用阴影/排版令牌）；全库正文字号统一收敛至 text-body 语义类；在 index.html 首帧内联执行主题同步解决刷新闪白；为填充按钮配置深色高对比 fill-foreground 令牌确保 WCAG 合规；Card 支持 as="ul" 修复复核与回收站 HTML 列表语义合法性

## 9. 术语表

- `scope` = Key 的分组到权限映射，形如 `{"proj": "rw", "study": "r"}`，是授权边界的唯一来源
- 通配权限 = 含 `*` 键即覆盖全库，具体级别由 `permission_for` 决定：`{"*": "rw"}` 全库可写，`{"*": "r"}` 全库只读；显式分组键优先于通配。管理台登录条件即 `grants["*"] == "rw"`
- `group_slug` = 分组标识（`proj` / `study` / `life` / `track`），既是分类也是授权边界，不对未授权方披露
- 三态 = 单条记忆相对当前 Key 的三种判定：`authorized` / `forbidden` / `not_found`
- 三级披露 = 检索（`memory_search`）返回标题与元数据、peek（`memory_peek`）返回摘要、read（`memory_read`）返回正文；边界由工具描述陈述，不作为调用顺序约束
- 正文兜底检索 = `memory_search` 的 `include_body=True` 可选能力：把正文并入命中判定与打分，权重低于全部元数据字段