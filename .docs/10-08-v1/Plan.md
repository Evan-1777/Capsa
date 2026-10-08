# Plan：Go 语言重构后端以降低内存与性能开销

**状态**：DONE  
**日期**：2026-10-08  
**版本**：v1.5（吸收 Review v1.4：修正 Web 回收站排序与 DAL 签名、明确静态产物入库策略、补充内存风险闸门）  
**完成日期**：2026-10-08  
**回归测试结论**：四阶段全部落地。`go test ./...` 全量通过；前端 Playwright E2E 12 条用例全绿；`go vet ./...` 无告警；`gofmt -l` 无差异。实测裁剪二进制 13.1 MiB，`capsa serve` 空载常驻 RSS ≈ 2.2 MB，达成 15MB 内存目标；容器镜像由 CI 构建（本机无 Docker）。  

---

## 1. 背景与目标

当前 Capsa 后端基于 Python 3.12 (CPython) + Starlette + FastMCP 构建。实测表明服务启动后常驻内存峰值（RSS）达到 **81 MB**（82924 kB）。同时，项目元文档 [.docs/SCOPE.md](file:///home/dev/projects/MiniProject/Capsa/.docs/SCOPE.md) 尚存占位符待填充，[.docs/Project.md](file:///home/dev/projects/MiniProject/Capsa/.docs/Project.md) 仍沿用旧版编号体系，需对齐最新 [.docs/Project.example.md](file:///home/dev/projects/MiniProject/Capsa/.docs/Project.example.md) 规范。

本次重构使用 Go 语言对后端服务进行完整重构，达成以下核心目标：

- **基准文档规范化**：补齐 `SCOPE.md` 核心定义填空并同步开发环境描述，按最新示例规范重构 `Project.md`（无编号章节、整合约束与决策、沉底维护表，包含架构数据流与联调指导），确立统一的单一事实来源。
- **极致低内存常驻**：将常驻内存从当前的实测 81MB 压降至 **15MB 以内**，大幅削减个人 VPS 的常态内存开销。
- **极简镜像与单一静态二进制**：通过语言原生编译与静态资源内嵌，消除容器内 Python 与 Node 运行时依赖，基于 Alpine 构建小于 30MB 的自包含极简镜像（可执行文件约 15~18MB 安装至 `/usr/local/bin/capsa`，满足 PATH 直接调用与既有 README 运维习惯）。
- **外部契约严格保真**：严格保持既有 SQLite 数据结构、MCP 工具原名（`memory_save`、`memory_forget` 等 7 个工具）、Web REST API 真实端点（`/api/auth/me` 及 `/api/memories?status=...`）、统一信封格式、纯文本三级披露输出及错误消息逐字对齐，确保前端管理台与外部 Agent 零改动接入。

---

## 2. 阶段划分

### Phase 1：基准文档规范化、Go 基础骨架与存储数据访问层

| 项目 | 内容 |
|------|------|
| **输入** | 现有 SQLite 数据库 Schema 定义、数据表索引、Python 数据访问层契约，待补全的 [.docs/SCOPE.md](file:///home/dev/projects/MiniProject/Capsa/.docs/SCOPE.md) 与规范模板 [.docs/Project.example.md](file:///home/dev/projects/MiniProject/Capsa/.docs/Project.example.md)，既有前端静态产物 `capsa/static/` |
| **输出** | 补齐定义的 `SCOPE.md`、无编号规范重构的 `Project.md`、Go 模块骨架、前端产物迁入 `internal/server/static/`、微秒级时间戳工具、CSPRNG 标识符与哈希、SQLite WAL 存储连接管理、Schema 幂等初始化、三态数据访问层 (DAL) 及存储单测与阶段编译验证 |
| **验收标准** | `SCOPE.md` 无下划线；`Project.md` 包含旧到新章节完整对照核验；时间戳严格固定 `2006-01-02T15:04:05.000000+00:00` 布局（定宽增强，非逐字对齐 Python `isoformat()`）；随机源与字符表锁定；存储层 WAL 模式正常工作，三态判定脱敏、虚拟管理员 Key 凭据、分组/Key/记忆 CRUD 及软删除状态机通过单测；`cmd/capsa` 最小桩可独立编译并通过 `go test` |

### Phase 2：核心算法、纯文本契约与鉴权中间件

| 项目 | 内容 |
|------|------|
| **输入** | CJK/拉丁分词规则、非对称检索打分机制、全量排序快照规则、Bigram Jaccard 查重算法、三级披露纯文本契约（`capsa/formatters.py`）与鉴权规约 |
| **输出** | 确定性分词打分引擎、`RankMemories` 稳定排序快照模块、标题近似查重模块、三级披露纯文本格式化模块、单一来源权限判定纯函数、令牌校验器与 URL 查询参数鉴权中间件及单测 |
| **验收标准** | 分词打分结果包含 `round(total, 2)` 精度且与测试向量逐分对齐；`RankMemories` 完整实现词元命中过滤、空 query 浏览及 4 级稳定 tie-breaker；纯文本输出逐函数以 `capsa/formatters.py` 为单一事实来源实现输出一致性；URL 凭据中间件精准过滤非 ASCII 与控制字符；权限计算覆盖分组及全库通配规则 |

### Phase 3：双通道传输适配层与管理 CLI

| 项目 | 内容 |
|------|------|
| **输入** | Phase 1 与 Phase 2 交付的数据访问层、算法与格式化引擎、鉴权中间件，前端真实 REST API 调用契约与 MCP 原生传输契约 |
| **输出** | MCP Streamable HTTP 服务（保留 `memory_save` / `memory_forget` 原名，逐请求 Claims 上下文透传，SSE 分帧与 Session 响应头）、Web RESTful API 统一信封服务（1:1 映射真实端点与逐字错误文案，防自锁守卫与字段级校验）、前端 SPA 静态无条件内嵌托管与管理员 CLI 13 个叶子命令 |
| **验收标准** | MCP 端点支持 initialize 握手协议头、SSE 分帧及 7 个工具读写调用，未认证返回 401 + `WWW-Authenticate: Bearer`，业务错误走工具级 `isError: true`；Web API 统一信封格式与错误码（401/403/404/422/500）及文本逐字对齐；静态产物编译期内嵌且路由正确回退；CLI 完整支持 13 项叶子指令，`key create` 原样输出关键行；输出 Phase 3 完整依赖下的常驻内存与产物体积基线 |

### Phase 4：全套回归验证、容器化与工程清理

| 项目 | 内容 |
|------|------|
| **输入** | 前三阶段全部 Go 实现产物、前端测试套件、`web/tests/serve.sh` 脚本、既有容器编排与待清理的 Python 栈代码 |
| **输出** | Go 后端全量集成测试套件、更新适配后的 `web/tests/serve.sh`、基于 Alpine 的单二进制极简 Dockerfile（安装至 `/usr/local/bin/capsa`，CMD 监听 `0.0.0.0:8000`）、更新后的 Docker Compose 编排、Python 死代码与旧测试清理、项目基线文档运行时更新 |
| **验收标准** | 容器常驻内存实测低于 15MB；前端 Playwright E2E 套件经由 Go 启动器全量通过；后端集成测试全量通过；镜像体积低于 30MB 且保留 HEALTHCHECK，PATH 直接支持 `capsa` 子命令；Python 栈代码彻底清理；项目事实文档同步更新完成 |

---

## 3. 架构决策

| 决策项 | 选择 | 理由 | 替代方案（为何不选） |
|--------|------|------|----------------------|
| 文档规范架构 | 无编号自然章节 + 整合约束与决策 | 遵循最新 `Project.example.md` 规范，消减编号级联维护成本，消除坑与决策的同构重复 | 保留数字编号体系（维护脆弱，跨文档引用易脱节） |
| SQLite 驱动 | `modernc.org/sqlite` | 纯 Go 移植实现，无 CGO 依赖，支持静态跨平台交叉编译与原生备份接口 | `github.com/mattn/go-sqlite3`（强依赖 CGO 与系统 gcc/musl，增加跨平台与容器构建复杂度） |
| 时间戳格式串 | 固定 `2006-01-02T15:04:05.000000+00:00` | 保证字符串字典序与时间先后严格等价，同秒内微秒对齐；相对 Python `isoformat()`（微秒为 0 时省略小数部分）属有意增强的定宽布局，非逐字对齐 | `time.RFC3339Nano`（会省略尾随 0 且用 Z，破坏 SQL 字符串字典序比较） |
| 文本契约标准 | 以 `capsa/formatters.py` 为唯一事实来源（SSOT） | 消除任何中间转述模板带来的事实偏差，保证 MCP Agent 客户端三级披露文本完全无感 | 二次总结模板（容易漏掉三态分支或引入格式微小漂移） |
| HTTP 路由体系 | Go 标准库 `net/http` (Go 1.22+) | 标准库自带方法匹配与路径参数解析（如 `GET /api/memories/{id}`），零第三方依赖，符合规范克制与最小差分原则 | `go-chi/chi` 或 `gin`（标准库能力已完全覆盖，引入框架属冗余抽象） |
| MCP 协议栈 | `github.com/mark3labs/mcp-go` | 社区成熟的 Go MCP SDK，支持 Streamable HTTP、SSE 与工具元数据注解，API 简洁 | 自建 JSON-RPC 2.0 协议解析（维护 MCP 握手和流式传输细节成本高） |
| 静态资源分发 | Go 标准库 `embed` 强内嵌 | 原生将前端构建产物嵌入可执行文件，源目录固定为 `internal/server/static/`；产物不入库（由 `.gitignore` 忽略，延续 SCOPE §5），编译前须先由前端构建产出，无目录时编译期直接失败 | 运行时条件读盘、提交构建产物入库或保留空目录占位（分别为过度防御分支、与 SCOPE §5 冲突、无法通过 embed 校验） |
| 容器安装与运行 | 安装至 `/usr/local/bin/capsa`，监听 `0.0.0.0` | 保持容器内默认 PATH 直接可执行，与 README 现存运维命令严格兼容；监听通配地址保证宿主反向代理正常接入 | 放入根目录 `/capsa`（破坏 PATH 运维命令）或监听 `127.0.0.1`（容器外端口映射不可达） |
| 容器运行时基底 | `alpine:latest` + curl | 镜像体积小（约 7MB），自带包管理器可补充 curl 满足健康检查，且与静态二进制组合后总镜像体积稳居 25MB 左右 | `scratch`（无法运行 curl 健康检查）、`python:3.12-slim`（体积巨大且背负冗余 Python 运行时） |

---

## 4. 风险清单

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| MCP 传输层协议头与 SSE 格式不完整导致外部 Agent（如 Claude Web）连接断开 | 🔴 高 | 在 HTTP 层完整输出 `Mcp-Session-Id`、`X-Accel-Buffering: no`、`Content-Type: text/event-stream`、`protocolVersion: 2024-11-05`，未认证请求返回 401 + `WWW-Authenticate: Bearer` |
| 容器启动命令与监听地址配置不当导致部署后无法连接 | 🔴 高 | 二进制安装至 `/usr/local/bin/capsa`，Dockerfile CMD 显式声明 `capsa serve --host 0.0.0.0 --port 8000` |
| MCP 逐请求 Bearer Claims 无法透传至工具执行上下文 | 🔴 高 | 在 HTTP 中间件层完成令牌校验并将用户 claims 存入 `context.Context`，工具处理器通过 context 提取 claims |
| `modernc.org/sqlite` 在并发写入下的锁竞争 | 🟡 中 | 严格保持与现有架构一致的 WAL 模式与短连接模式，写事务使用排他锁，继承既有事务边界 |
| 时间戳微秒位数不一致导致 SQL 字符串排序错乱 | 🔴 高 | 在 Phase 1 即锁定 `2006-01-02T15:04:05.000000+00:00` 格式串，并在单测中加入字典序断言 |
| 浮点计算尾差导致检索打分断言脆弱 | 🟡 中 | 移植 `round(total, 2)` 精度处理，逐分对齐 Python 测试向量 |
| Web API 统一信封错误消息泄露敏感未授权 ID | 🟡 中 | 继承既有防侧信道约束：404 错误统一返回固定文案“记忆不存在或无权访问”，不回显请求传入的 ID |
| `modernc.org/sqlite` 的体积与常驻开销可能使 15MB RSS / 30MB 镜像目标失守 | 🟡 中 | 以 TASK-006 的体积基线与 TASK-015 的完整依赖内存基线作为决策闸门；若超标则评估改用 `mattn/go-sqlite3`（CGO，镜像需 gcc/musl）或裁剪依赖，不在无实测前预设结论 |

---

## 5. Phase 依赖关系

```
Phase 1 (文档规范化与存储层) ──→ Phase 2 (核心算法与鉴权中间件) ──→ Phase 3 (传输适配层与 CLI) ──→ Phase 4 (验证与容器基线)
```

Phase 1 至 Phase 3 呈严格数据与逻辑依赖链；Phase 4 在接口与传输层就绪后执行端到端闭环验证、工程清理与基准沉淀。

---

## 6. Subagent 协同规划

依据三维效益模型（任务复杂度、上下文关联度、经济与时间效益）评估本阶段委托需求：

| 阶段 | 上下文依赖 | 并行收益 | 执行主体 | 决策理由 |
|------|-----------|---------|----------|----------|
| Phase 1：文档规范与存储层 | 强（涉及数据模型约束与基准事实） | 无（底层基石） | 主线 | 避免因隔离会话导致文档约束与状态机语义丢失 |
| Phase 2：算法与鉴权中间件 | 强（涉及权限单一事实来源与打分逻辑） | 无（依赖 Phase 1 模型） | 主线 | 逻辑紧凑且计算敏感，主线连续推演更加精确 |
| Phase 3：传输适配与 CLI | 强（涉及 MCP 协议细节与 Web 信封契约） | 无（串行承接 Phase 1/2） | 主线 | 涉及双通道适配与统一错误转换，需保持上下文高度一致 |
| Phase 4：验证与容器化 | 低（接口契约与功能已冻结） | 高（端到端测试与镜像编写可独立闭环） | Subagent: executor | 测试验证与 Docker 改造边界清晰自包含，委托执行可提升交付效益 |

> **协同结论**：Phase 1-3 涉及后端领域模型与核心数据流转，由主线连续实现；Phase 4 具有高独立性，待服务完全可运行后由 Subagent: executor 进行全量回归测试、工程清理与容器基线构建。

---

> ### Task 拆解预览
>
> 完整 Task 详见 `Tasks.md`。Plan 在此止步，不展开具体函数签名与实施细节。
>
> | Phase | 预估 Task 数 | 执行主体 | 目标覆盖 |
> |-------|-------------|----------|----------|
> | Phase 1 | 6 | 主线 | 文档规范化/填空补齐、Go 模块骨架与 main 桩（含 `.gitignore` 产物归位策略）、SQLite WAL 基座与时间戳、CSPRNG ID/Token、DAL 完整移植（含三态与列表/回收站排序）及单测编译 |
> | Phase 2 | 5 | 主线 | 分词打分算法与排序快照、formatters 纯文本契约（以 Python 为 SSOT 1:1 对齐）、权限判定纯函数、令牌校验器与 URL 鉴权中间件及单测 |
> | Phase 3 | 4 | 主线 | MCP HTTP 服务（原名原契约、协议头与 SSE 校验）、Web API 统一信封（1:1 真实端点、防自锁守卫）、前端 SPA 静态内嵌托管与 CLI 13 项叶子指令（12 既有 + `serve`）及中期基线 |
> | Phase 4 | 3 | Subagent: executor | E2E 脚本适配与接口验证、Dockerfile/Compose 单二进制化（/usr/local/bin 与 0.0.0.0 绑定）、Python 栈代码清理与项目文档更新 |
>
> **总计预估**：18 个原子 Task。
