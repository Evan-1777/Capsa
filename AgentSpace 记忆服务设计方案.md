# Capsa 记忆服务设计方案

个人 Agent 记忆的云端托管与 MCP 接入

文档类型：设计方案（含选型论证与接口契约，不含实现代码）
技术基线：MCP 规范 2026-07-28（legacy 客户端兼容由 FastMCP 4 的 per-connection 协议协商承担）

> **【实施基准声明】**：本文档为初始系统设计方案，保留原始架构论证。后续代码实施与交付严格以根目录 `Capsa_落地交付分期规划.md` 及 `Capsa_可视化前端管理计划.md` 为准。当本文档中关于分期、待决事项或 Web 管理台范围的论述与落地规划存在出入时，以落地规划为最终权威执行基准。

---

## 摘要

本项目定名 Capsa，名字来源以及它与服务名、数据文件、Key 前缀的对应关系见第 1 节第 6 条。它解决一个具体问题：把散落在各个 AI 工具里的「对用户的理解」收敛成一份自己掌控的数据，并让任意 MCP 客户端按需读取。

形态定为一台云主机上的单进程服务，对外只暴露一个 MCP 端点。存储用单文件 SQLite。核心机制是三级披露协议：Agent 先检标题，再读摘要，最后才取正文，每一级都带体积契约。授权模型用 API Key 到分组白名单的映射，让不同用途的 Agent 拿到不同范围。

结论先列：

| 维度 | 决策 |
|---|---|
| 运行时 | Python 3.12+，FastMCP 4.0+ 框架，uvicorn 单进程 |
| 存储 | SQLite 单文件 + WAL，无外部依赖 |
| 对外接口 | 单个 Streamable HTTP 端点 `POST /mcp`，版本经每请求 `_meta` 声明 |
| 鉴权 | Bearer API Key，落库只存 sha256，Key 到分组白名单 |
| 检索 | 内存全量打分（标题 / 摘要 / 标签），不用向量、不用 FTS5 |
| 工具数 | 7 个（元信息 1、读 3、写 3） |
| 资源占用 | 1 vCPU / 256 MB / 磁盘 ≈ 条目数 × 正文长度，单条 ≤ 64 KB |
| 首版代码量 | 约 500 行（含 CLI） |

明确不做的部分在第九节列出，每一项都写了触发条件与升级路径。

---

## 一、理念：六条设计原则

### 1. 记忆是拉取的，不是推送的

常见做法是把记忆预先拼进 system prompt，让模型「天然记得」。代价是每轮对话都要为全部记忆付 token，且无关记忆会干扰判断。

本项目反其道：服务端不主动提供任何上下文，全部由 Agent 在需要时通过工具调用取用。收益是上下文只被真正用得上的内容占用；代价是每次取用增加一到三次工具往返。这个交换是否划算，取决于记忆量——几十条时推送更省事，上百条以后拉取开始占优。

判断依据：记忆条数超过单次对话能自然容纳的规模（约 20 条），按需取用才有意义。

### 2. 分级披露，每级都有体积契约

一次性把记忆全量返回，Agent 要在一堆正文里自己找。三级披露把「筛选」这个动作拆到三个粒度上，每一级只暴露刚好够做下一步判断的信息。

<figure>

<div style="border:1px solid #e5e7eb;border-radius:12px;padding:20px;background:#fafafa;color:#18181b;font-size:13px;line-height:1.65">

<div style="display:flex;align-items:stretch;gap:4px">

<div style="flex:1;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:14px">
<div style="font-size:11px;font-weight:600;letter-spacing:.08em;color:#2563eb">L1 · 检索</div>
<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;margin-top:7px;color:#18181b">memory_search</div>
<div style="height:1px;background:#e5e7eb;margin:12px 0"></div>
<div style="font-size:12px;color:#52525b">
输入：关键词<br>
输出：id · 标题 · 分组 · 标签 · 时间
</div>
<div style="font-size:11px;color:#a1a1aa;margin-top:12px">≤ 20 条 · 约 800 token</div>
</div>

<div style="display:flex;align-items:center;color:#2563eb;padding:0 2px">→</div>

<div style="flex:1;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:14px">
<div style="font-size:11px;font-weight:600;letter-spacing:.08em;color:#2563eb">L2 · 审阅</div>
<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;margin-top:7px;color:#18181b">memory_peek</div>
<div style="height:1px;background:#e5e7eb;margin:12px 0"></div>
<div style="font-size:12px;color:#52525b">
输入：一组 id<br>
输出：标题 + 摘要（不含正文）
</div>
<div style="font-size:11px;color:#a1a1aa;margin-top:12px">≤ 10 条 · 约 700 token</div>
</div>

<div style="display:flex;align-items:center;color:#2563eb;padding:0 2px">→</div>

<div style="flex:1;background:#ffffff;border:1px solid #2563eb;border-radius:8px;padding:14px">
<div style="font-size:11px;font-weight:600;letter-spacing:.08em;color:#2563eb">L3 · 取用</div>
<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;margin-top:7px;color:#18181b">memory_read</div>
<div style="height:1px;background:#e5e7eb;margin:12px 0"></div>
<div style="font-size:12px;color:#52525b">
输入：一组 id<br>
输出：正文原文（Markdown）
</div>
<div style="font-size:11px;color:#a1a1aa;margin-top:12px">≤ 5 条 · 单条 ≤ 4000 字符 · 单次 ≤ 20000 字符</div>
</div>

</div>

<div style="margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb">

<div style="font-size:12px;color:#71717a;margin-bottom:10px">同一批记忆，两种取用方式的上下文开销（按每条正文 800 token 估算）</div>

<div style="display:grid;grid-template-columns:150px 1fr 90px;gap:8px;align-items:center;font-size:12px">
<div style="color:#52525b">全量注入 20 条</div>
<div style="height:14px;background:#e4e4e7;border-radius:2px"></div>
<div style="color:#52525b;font-family:ui-monospace,monospace">~16,000</div>

<div style="color:#52525b">三级披露取 3 条</div>
<div style="height:14px;border-radius:2px;background:#2563eb;width:14%"></div>
<div style="color:#2563eb;font-family:ui-monospace,monospace">~2,100</div>
</div>

</div>

</div>

</figure>

### 3. 分组是授权边界，不是分类标签

如果分组只是标签，它可以被检索条件随意跨越，就没有隔离价值。本设计里分组同时承担两个职责：组织记忆，以及定义一把 Key 能看到什么。

由此推出一个硬约束：分组是数据行，不是代码里的枚举值。新增「追踪记忆」这类分组时不需要改代码、不需要重新部署，只需要往 `groups` 表插一行再给 Key 授权。

### 4. 写入靠 Agent，裁决靠人

自动记忆系统最常见的失败模式是记忆污染：Agent 把一次性的、过时的、推断错误的内容写进长期记忆，之后每一次检索都被污染。

本设计的处理方式是结构性的，而不是靠提示词约束：

- 新建的 Key 默认只读，写权限（`rw`）必须显式授予；
- 写入前做同分组内的近似重复检测，命中则返回相似条目让 Agent 自己决定是更新还是新建；
- 删除是软删除，`deleted_at` 置位，数据可恢复；
- 每条记忆带 `review_at`，到期后在检索结果里被标注并降权，而不是静默消失。

不引入「草稿 / 待审」状态机。理由是它会把写入路径变成两段式，让 Agent 的写操作无法自洽，而上面四条已经把污染风险压到可接受范围。

### 5. 记忆是文档，不是日志

一条记忆是一个能被独立引用、独立修改、独立废弃的最小单元，有稳定 ID、标题、摘要、正文。对话流水、原始日志不做归档——那类数据体量大、复用率低，放进来会稀释检索质量。

三个字段的长度契约直接决定了分级披露是否成立：

| 字段 | 上限 | 约束理由 |
|---|---|---|
| `title` | 60 字符 | L1 每条只占一行，保证 20 条能在一屏内读完 |
| `summary` | 200 字符 | L2 能让 Agent 判断「要不要读正文」，又不足以替代正文 |
| `body` | 64000 字符，超限拒绝写入 | L3 才展开，单条读取截断 4000 字符，用 `offset` 续读 |

标题、摘要与正文超限时服务端直接拒绝写入并返回具体字符数，不做静默截断。截断会让作者以为自己写进去了。

### 6. 项目名为 Capsa

名字取自拉丁语 capsa，指收纳卷轴与文书的圆筒书匣。它承接第 5 条的比喻：记忆是一条条可独立引用的文档，库是收纳它们的匣子，分组与作用域是匣内的分格，三级披露是按需取出一份，而不是倾倒整匣。

这个来源同时解释了命名取舍的四条判据：

| 判据 | Capsa 的取值 |
|---|---|
| 长度 | 5 字母、2 音节，可读可拼，命令行前缀不需要额外记忆 |
| 语义 | 容器同时覆盖存储、隔离、取用三层职责，与第 3、5 条一致 |
| 命名空间 | PyPI 与 npm 无占用；capsa.io、capsa.sh 无注册记录；github.com/capsa 是 2015 年注册、零公开仓库的闲置账号，按用户名建仓不受影响 |
| 冲突面 | 同名主体是医疗器械与网络分析仪，与个人知识库无交集 |

同根词 capere（抓取）在 AI 领域已有产品（capio.ai、CAPIO PRO），说明这个语义家族在被使用，而 AI 记忆这一细分下 Capsa 尚无同名项目。曾进入候选的 Engram、Mneme、Stele、Lethe、Cairn 都已被 AI 记忆领域的同名项目占用。

名字落到标识符上的对应：

| 用途 | 取值 |
|---|---|
| 服务与仓库名 | capsa |
| 数据文件 | /data/capsa.db |
| 命令行 | capsa group / capsa key / capsa review |
| Key 明文前缀 | capsa_<keyid>_<secret> |
| MCP 客户端配置键 | "capsa" |

服务名、数据文件、Key 前缀与命令行共用同一个词，配置与排障时不必在多个名字之间换算。命名空间的可用性取自取名当日的查询结果，PyPI、npm、GitHub 的占用与域名注册状态会变化，正式启用前需再做一次商标与域名复核。

---

## 二、为什么自建

按「先问需不需要建」的顺序检查过一遍。

MCP 生态里已有的记忆方案分两类。一类是知识图谱型（Anthropic 官方 memory server、Basic Memory 等），以实体和关系组织数据，检索是语义或全文搜索；另一类是托管记忆层（mem0、Zep 等），带自动抽取管线，从对话里蒸馏事实。

这两类解决的都是「记忆怎么存、怎么找」。你提出的两点需求不在它们范围内：

- **分组级授权作用域**。现成方案要么是单命名空间，要么按知识库 / 项目切分，没有「一把 Key 对应一组可访问分组」这一层。多 Key 接入时无法做到「工作 Agent 看不到生活记忆」。
- **三级披露协议**。现成方案的检索工具返回的是完整结果集，筛选责任留在 Agent 侧，没有「先标题、后摘要、再正文」的固定分步契约。

如果放弃这两点，直接用现成方案是更省事的选择。既然要保留，自己写的部分就只有一张表、七个工具和一个授权层；把 MCP 协议、HTTP 传输、鉴权框架交给 FastMCP，剩下要写的代码在 500 行以内。这是自建成本可接受的原因。

---

## 三、系统框架

### 3.1 分层与信任边界

<figure>

<div style="border:1px solid #e5e7eb;border-radius:12px;padding:20px;background:#fafafa;color:#18181b;font-size:13px">

<div style="display:grid;grid-template-columns:104px 1fr;gap:10px;align-items:stretch">

<div style="display:flex;align-items:center;color:#71717a;font-size:12px">客户端</div>
<div style="border:1px solid #e5e7eb;border-radius:8px;background:#ffffff;padding:12px 14px">
Agent 侧：Claude Code · Cursor · 其他 MCP 客户端 · 命令行
<div style="font-size:11px;color:#a1a1aa;margin-top:4px">每把 Key 绑定一组可访问分组</div>
</div>

<div style="display:flex;align-items:center;color:#2563eb;font-size:12px">公网</div>
<div style="border:1px dashed #2563eb;border-radius:8px;background:#ffffff;padding:12px 14px">
HTTPS 443 · Bearer 令牌
<div style="font-size:11px;color:#a1a1aa;margin-top:4px">明文不落地，DB 只存 sha256</div>
</div>

<div style="display:flex;align-items:center;color:#71717a;font-size:12px">接入层</div>
<div style="border:1px solid #e5e7eb;border-radius:8px;background:#ffffff;padding:12px 14px">
Caddy · TLS 终止 · 自动证书
<div style="font-size:11px;color:#a1a1aa;margin-top:4px">默认不缓冲响应体，流式输出无需额外配置</div>
</div>

<div style="display:flex;align-items:center;color:#71717a;font-size:12px">协议层</div>
<div style="border:1px solid #e5e7eb;border-radius:8px;background:#ffffff;padding:12px 14px">
FastMCP · <span style="font-family:ui-monospace,monospace;font-size:12px">POST /mcp</span> · Streamable HTTP
<div style="font-size:11px;color:#a1a1aa;margin-top:4px">每请求重新校验 Bearer Key，撤销在下一次调用即生效</div>
</div>

<div style="display:flex;align-items:center;color:#2563eb;font-size:12px">授权层</div>
<div style="border:1px solid #2563eb;border-radius:8px;background:#ffffff;padding:12px 14px">
TokenVerifier 子类 · 查 Key 表 → <span style="font-family:ui-monospace,monospace;font-size:12px">{"proj":"rw","study":"r"}</span>
<div style="font-size:11px;color:#a1a1aa;margin-top:4px">未命中即 401，不进入工具层</div>
</div>

<div style="display:flex;align-items:center;color:#71717a;font-size:12px">工具层</div>
<div style="border:1px solid #e5e7eb;border-radius:8px;background:#ffffff;padding:12px 14px">
7 个 MCP 工具 · 元信息 1 · 读 3 · 写 3
<div style="font-size:11px;color:#a1a1aa;margin-top:4px">工具内不出现 SQL，只调用数据访问函数</div>
</div>

<div style="display:flex;align-items:center;color:#2563eb;font-size:12px">数据层</div>
<div style="border:1px solid #2563eb;border-radius:8px;background:#ffffff;padding:12px 14px">
唯一入口函数强制注入 scope · <span style="font-family:ui-monospace,monospace;font-size:12px">WHERE group_slug IN (...)</span>
<div style="font-size:11px;color:#a1a1aa;margin-top:4px">越权防线只有这一处，不分散到各工具</div>
</div>

<div style="display:flex;align-items:center;color:#71717a;font-size:12px">存储</div>
<div style="border:1px solid #e5e7eb;border-radius:8px;background:#ffffff;padding:12px 14px">
<span style="font-family:ui-monospace,monospace;font-size:12px">/data/capsa.db</span> · SQLite · WAL 模式
<div style="font-size:11px;color:#a1a1aa;margin-top:4px">单文件，随卷备份，无外部服务依赖</div>
</div>

</div>

</div>

</figure>

### 3.2 技术选型

<figure>

<div style="border:1px solid #e5e7eb;border-radius:12px;padding:20px;background:#fafafa;color:#18181b;font-size:13px">

<div style="display:grid;grid-template-columns:110px 1fr 1fr;gap:0">

<div style="padding:8px 10px;font-size:11px;letter-spacing:.06em;color:#71717a">决策点</div>
<div style="padding:8px 10px;font-size:11px;letter-spacing:.06em;color:#2563eb">选定</div>
<div style="padding:8px 10px;font-size:11px;letter-spacing:.06em;color:#71717a">否决的备选与理由</div>

<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">记忆服务框架</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb">FastMCP
<div style="font-size:11px;color:#a1a1aa;margin-top:4px">版本下限 4.0，内置 dual-era 协商；自带鉴权扩展点与工具注解</div>
</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">MCP 官方 SDK 裸写
<div style="font-size:11px;color:#a1a1aa;margin-top:4px">传输层与鉴权要自己接，多出约 200 行且是协议细节</div>
</div>

<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">存储</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb">SQLite 单文件
<div style="font-size:11px;color:#a1a1aa;margin-top:4px">备份是一条 <span style="font-family:ui-monospace,monospace">.backup</span> 命令</div>
</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">Postgres / 向量库
<div style="font-size:11px;color:#a1a1aa;margin-top:4px">个人规模下多一个常驻服务，运维成本高于收益</div>
</div>

<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">检索实现</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb">内存全量打分
<div style="font-size:11px;color:#a1a1aa;margin-top:4px">无查询长度限制，中英文行为一致</div>
</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">FTS5 / 向量检索
<div style="font-size:11px;color:#a1a1aa;margin-top:4px">见第四节实测数据，中文场景下限制明确</div>
</div>

<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">部署形态</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb">单容器 + 单卷
<div style="font-size:11px;color:#a1a1aa;margin-top:4px">重启即恢复，无状态可丢</div>
</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">Serverless / 多副本
<div style="font-size:11px;color:#a1a1aa;margin-top:4px">SQLite 与多副本冲突，个人规模无扩容诉求</div>
</div>

<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">管理入口</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb">命令行 CLI
<div style="font-size:11px;color:#a1a1aa;margin-top:4px">Key 签发、记忆审阅、备份各一条命令</div>
</div>
<div style="padding:12px 10px;border-top:1px solid #e5e7eb;color:#52525b">Web 管理台
<div style="font-size:11px;color:#a1a1aa;margin-top:4px">首版不做；等审阅量成为实际痛点再补</div>
</div>

</div>

</div>

</figure>

### 3.3 授权模型

Key 的明文格式为 `capsa_<keyid>_<secret>`，其中 `keyid` 是 8 位可读标识，`secret` 是 32 位随机串。这样设计有三个用处：日志里可以只记 `keyid`、撤销时无需比对全串、抓到泄露的 Key 时能一眼认出归属。

服务端只存 `sha256(明文)`，明文在签发时打印一次，之后无法找回。哈希用不加盐的 sha256 而非 bcrypt，因为令牌本身是 32 位高熵随机串，不存在字典攻击面，而每次工具调用都要比对哈希，性能优先。

作用域记在 Key 行的 `scopes` 字段里，是分组 slug 到权限的映射：

<figure>

<div style="border:1px solid #e5e7eb;border-radius:12px;padding:20px;background:#fafafa;color:#18181b;font-size:13px">

<div style="display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr 1fr;gap:0;font-size:12px">

<div style="padding:8px 10px;font-size:11px;letter-spacing:.06em;color:#71717a">Key</div>
<div style="padding:8px 10px;font-size:11px;letter-spacing:.06em;color:#71717a">proj 项目</div>
<div style="padding:8px 10px;font-size:11px;letter-spacing:.06em;color:#71717a">study 学习</div>
<div style="padding:8px 10px;font-size:11px;letter-spacing:.06em;color:#71717a">life 生活</div>
<div style="padding:8px 10px;font-size:11px;letter-spacing:.06em;color:#71717a">track 追踪</div>

<div style="padding:11px 10px;border-top:1px solid #e5e7eb;font-family:ui-monospace,monospace;font-size:11px">capsa_a1b2c3d4</div>
<div style="padding:11px 10px;border-top:1px solid #e5e7eb;color:#2563eb">读写</div>
<div style="padding:11px 10px;border-top:1px solid #e5e7eb;color:#2563eb">读写</div>
<div style="padding:11px 10px;border-top:1px solid #e5e7eb;color:#a1a1aa">—</div>
<div style="padding:11px 10px;border-top:1px solid #e5e7eb;color:#a1a1aa">—</div>

<div style="padding:11px 10px;border-top:1px solid #e5e7eb;font-family:ui-monospace,monospace;font-size:11px">capsa_e5f6a7b8</div>
<div style="padding:11px 10px;border-top:1px solid #e5e7eb;color:#2563eb">读写</div>
<div style="padding:11px 10px;border-top:1px solid #e5e7eb;color:#71717a">只读</div>
<div style="padding:11px 10px;border-top:1px solid #e5e7eb;color:#a1a1aa">—</div>
<div style="padding:11px 10px;border-top:1px solid #e5e7eb;color:#71717a">只读</div>

<div style="padding:11px 10px;border-top:1px solid #e5e7eb;font-family:ui-monospace,monospace;font-size:11px">capsa_c9d0e1f2</div>
<div style="padding:11px 10px;border-top:1px solid #e5e7eb;color:#2563eb">读写</div>
<div style="padding:11px 10px;border-top:1px solid #e5e7eb;color:#2563eb">读写</div>
<div style="padding:11px 10px;border-top:1px solid #e5e7eb;color:#2563eb">读写</div>
<div style="padding:11px 10px;border-top:1px solid #e5e7eb;color:#2563eb">读写</div>

</div>

<div style="margin-top:16px;padding-top:14px;border-top:1px solid #e5e7eb;font-size:12px;color:#71717a">
第一把给工作 Agent，第二把给学习助手，第三把给自己本机使用。撤销任意一把不影响其他。
</div>

</div>

</figure>

越权防线只有一处：数据访问层的查询函数签名强制要求传入 scope，SQL 里统一拼 `WHERE group_slug IN (...)`。工具函数不允许自行拼 SQL。这样做的原因是，如果每个工具各自判断权限，新增一个工具就多一处遗漏风险；把判断收到唯一入口，检查点是固定的。

授权不做缓存。每次请求重新校验 Bearer Key 并解析 scope，工具调用使用本次请求解析出的结果。`revoked_at` 一旦置位，下一次请求即返回 401，不需要额外的会话失效通道。

对于访问了不可见分组的具体条目（例如另一把 Key 创建的 id），单个条目返回「无权访问」而不让整个调用失败，其余条目正常返回。单用户系统只有一个所有者，不同 Key 由本人持有，键与键之间没有需要防守的边界；明确报错比模糊的「未找到」更便于 Agent 向用户说明情况。

写工具对不属于可访问分组的条目沿用同一「不存在或无权访问」口径；Key 均由所有者本人签发，无需在此之上另加防探测设计。

---

## 四、检索与排序

### 4.1 实测数据

中文场景下 FTS5 的两种分词器表现差异明确，本机 SQLite 3.46.1 实测：

| 分词器 | 建表 | `MATCH '记忆'` | `MATCH '记忆服务'` | 结论 |
|---|---|---|---|---|
| `unicode61`（默认） | 成功 | 0 行 | — | 中文整串成为一个 token，`分层检索记忆` 无法被 `记忆` 命中 |
| `trigram` | 成功 | 0 行 | 命中 | 中文子串可命中，但查询串少于 3 个字符时无结果 |

trigram 分词器解决了中文检索，代价是「记忆」这类两字查询完全失效，而两字中文词在日常检索里占比不低。用 jieba 之类的分词库补齐，等于引入一个词典依赖和一套版本升级负担。

因此首版采用内存全量打分：把授权范围内的条目（id / 标题 / 摘要 / 标签 / 时间）一次读入，在 Python 里算分排序。个人记忆库的规模在几千条量级，这个操作是毫秒级。

全量载入内存打分的上限约 3000 条。打分只读取标题、摘要与标签，这部分约 6 MB；正文不参与打分，按 id 命中后再从库里取，因此上限不受正文长度影响。超过 3000 条后改为对授权分组做 hash 分片惰性扫描，接口不变。

### 4.2 打分函数

查询串先切分：按空白与标点分词；对含中文的词元，再拆成连续的二字组。例如 `记忆分组授权` 拆成 `记忆 / 忆分 / 分组 / 组授 / 授权`。命中判定是大小写无关的子串包含。

```
score(m, terms)
  = 4 × Σ 命中(m.title,   t)
  + 1 × Σ 命中(m.summary, t)
  + 2 × Σ 命中(m.tags,    t)
  + 3  当 m.pinned
  - 2  当 m.review_at 已过期
```

排序键依次为 `score`、`pinned`、`updated_at`、`id`，末位 `id` 保证 `updated_at` 相同时顺序稳定。查询串为空、全空白或纯标点时跳过打分，直接按置顶与更新时间倒序，用于「这个分组里都有什么」这类没有关键词的浏览场景。

打分前先做归一化，让同一输入必得同一顺序：

- 所有时间按 UTC 存储与比较，`review_at` 到期判定同样以 UTC 为准；
- 查询串按空白与标点切分后去重，重复词元不重复计分；
- 查询词与字段值统一做 Unicode NFC 与大小写归一化后再比对；
- 标签按数组元素逐个匹配，不按 JSON 原文匹配。

<figure>

<div style="border:1px solid #e5e7eb;border-radius:12px;padding:18px 20px;background:#fafafa;color:#18181b;font-size:13px">
<div style="font-size:12px;color:#71717a">为什么 L1 允许过度召回</div>
<div style="margin-top:10px;color:#52525b;font-size:12px">
一条 L1 结果只有标题行，约 30 到 60 token。20 条结果不到 800 token，成本低于一次多余的往返。
把召回率做高的收益，大于排序精度的收益——排序不准的代价只是 Agent 在 L2 多读几条摘要。
真正的筛选发生在 L2，那里才有摘要可看。
</div>
<div style="margin-top:12px;padding-top:12px;border-top:1px solid #e5e7eb;color:#71717a;font-size:12px">
这一条也是首版不做向量检索的理由：向量检索解决的是「字面对不上但语义相近」，
而本设计在第一层本来就不追求精确。
</div>
</div>

</figure>

---

## 五、数据模型

三张表，没有关联表，没有状态机。

<figure>

<div style="border:1px solid #e5e7eb;border-radius:12px;padding:20px;background:#fafafa;color:#18181b;font-size:13px">

<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">

<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:14px">
<div style="font-family:ui-monospace,monospace;font-size:12px;color:#2563eb">groups</div>
<div style="margin-top:10px;font-size:12px;color:#52525b;line-height:1.9">
<span style="font-family:ui-monospace,monospace;color:#18181b">slug</span> 主键，如 proj<br>
<span style="font-family:ui-monospace,monospace;color:#18181b">name</span> 显示名<br>
<span style="font-family:ui-monospace,monospace;color:#18181b">description</span> 用途说明，供 Agent 判断该不该查<br>
<span style="font-family:ui-monospace,monospace;color:#18181b">created_at</span>
</div>
</div>

<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:14px">
<div style="font-family:ui-monospace,monospace;font-size:12px;color:#2563eb">keys</div>
<div style="margin-top:10px;font-size:12px;color:#52525b;line-height:1.9">
<span style="font-family:ui-monospace,monospace;color:#18181b">id</span> 即 keyid<br>
<span style="font-family:ui-monospace,monospace;color:#18181b">name</span> 用途备注<br>
<span style="font-family:ui-monospace,monospace;color:#18181b">token_hash</span> sha256，唯一索引<br>
<span style="font-family:ui-monospace,monospace;color:#18181b">scopes</span> JSON，分组到权限的映射<br>
<span style="font-family:ui-monospace,monospace;color:#18181b">created_at / last_used_at / revoked_at</span>
</div>
</div>

<div style="background:#ffffff;border:1px solid #2563eb;border-radius:8px;padding:14px;grid-column:1 / -1">
<div style="font-family:ui-monospace,monospace;font-size:12px;color:#2563eb">memories</div>
<div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:0 20px;font-size:12px;color:#52525b;line-height:1.9">
<div>
<span style="font-family:ui-monospace,monospace;color:#18181b">id</span> 主键，<code>mem_</code> 前缀加 6 位随机字符，总长度 10，形如 <code>mem_7f3ka2</code><br>
<span style="font-family:ui-monospace,monospace;color:#18181b">group_slug</span> 外键 → groups<br>
<span style="font-family:ui-monospace,monospace;color:#18181b">title</span> ≤ 60 字符<br>
<span style="font-family:ui-monospace,monospace;color:#18181b">summary</span> ≤ 200 字符
</div>
<div>
<span style="font-family:ui-monospace,monospace;color:#18181b">body</span> Markdown 正文，CHECK 长度 ≤ 64000<br>
<span style="font-family:ui-monospace,monospace;color:#18181b">tags</span> JSON 数组<br>
<span style="font-family:ui-monospace,monospace;color:#18181b">review_at</span> 复核时间点，可空<br>
<span style="font-family:ui-monospace,monospace;color:#18181b">pinned · created_at · updated_at · deleted_at · deleted_reason</span>
</div>
</div>
</div>

</div>

</div>

</figure>

几个字段的存在理由：

- `review_at` 服务于「追踪记忆」这类有时效的条目。到期后仍然能被检索到，但在结果里标注并降 2 分，而不是被静默排除——静默排除会让人以为记忆丢了。
- `pinned` 是关键词排序唯一的人工干预点。没有它，重要的旧记忆会一直排在无关的新记忆后面。
- `deleted_at` 是软删除，`deleted_reason` 记录删除原因。记忆是长期资产，误删的恢复成本高于多存一个字段的成本；原因随条目一起留在回收站，`capsa memory list-deleted` 才能回答"这条为什么被删"。
- `groups.description` 会出现在 `memory_groups` 的输出里，是 Agent 判断「这个分组该不该查」的唯一依据。写它是设计的一部分，不是可选项。

不设 `source`、`confidence`、`version` 字段。前两个没有消费方（没有自动抽取，也就没有需要标注来源的场景），第三个的诉求由 `updated_at` 覆盖。

索引只需要 `memories(group_slug, pinned DESC, updated_at DESC)` 一条，与浏览模式的排序键对齐。关键词检索走内存打分，用不到索引。

---

## 六、MCP 工具契约

七个工具。读工具三个、写工具三个、元信息一个。

工具描述本身是 Agent 的使用手册。三级协议能否被正确执行，取决于 `memory_search` 的返回值里有没有明确的下一步提示，以及工具描述里有没有写清「不要一次性读正文」。因此固定输出格式是协议的一部分，不是展示细节。

### 6.1 工具清单

| 工具 | 参数 | 注解 | 说明 |
|---|---|---|---|
| `memory_groups` | 无 | `readOnlyHint` | 列出当前 Key 可访问的分组、条目数、读写权限 |
| `memory_search` | `query?` `group?` `limit?=10` | `readOnlyHint` | L1。返回标题层，`limit` 上限 20 |
| `memory_peek` | `ids[]` | `readOnlyHint` | L2。返回摘要层，`ids` 上限 10 |
| `memory_read` | `ids[]` `offset?=0` | `readOnlyHint` | L3。返回正文，`ids` 上限 5，`offset` 为字符偏移 |
| `memory_save` | `group` `title` `summary` `body` `tags?` `review_at?` | `destructiveHint=false` | 新建，需该分组 `rw` |
| `memory_update` | `id` + 任意可写字段 | `idempotentHint` | 局部修改，只传要改的字段 |
| `memory_forget` | `id` `reason` | `destructiveHint` | 软删除，需该分组 `rw` |

`memory_search` 在 `query` 省略时退化为浏览模式（按置顶与更新时间倒序），因此不单独设 `memory_list` 工具。少一个工具就是少一份工具 schema 的 token，也少一个 Agent 选错的可能。

`memory_save` 与 `memory_update` 不合并。创建和修改的失败后果不同：误建一条可以删，误覆盖一条旧记忆则内容不可恢复。分成两个工具能让模型在「覆盖」这个动作上多一次显式决策。

### 6.2 固定输出格式

三个读工具各自返回一种固定结构，用纯文本而非 JSON。原因是纯文本对模型更易读，同样的信息占更少 token，且不需要模型解析嵌套结构。

**L1 `memory_search`**

```
# 记忆检索: "授权 分组" | 命中 5 条 | 范围: proj,study
[1] mem_7f3ka2 | proj | 2026-03-11 | 标签: mcp,auth
    MCP 记忆服务的授权模型定稿
[2] mem_2ab91c | proj | 2026-02-28 | 标签: key
    API Key 的签发与轮换流程
[3] mem_9d0e14 | study | 2026-01-06 | 标签: -
    OAuth 2.1 的 scope 设计（复核已过期）
> 下一步: memory_peek(ids=["mem_7f3ka2","mem_2ab91c"])
```

**L2 `memory_peek`**

```
[1] mem_7f3ka2 | proj | 更新 2026-03-11
    标题: MCP 记忆服务的授权模型定稿
    摘要: Key 落库只存 sha256；分组白名单在数据访问层统一注入；写权限需显式授予 rw。
> 下一步: memory_read(ids=["mem_7f3ka2"]) 取正文
```

**L3 `memory_read`**

```
===== mem_7f3ka2 | proj | 更新 2026-03-11 =====
# MCP 记忆服务的授权模型定稿

（正文 Markdown 原文）

> 续读: memory_read(ids=["mem_7f3ka2"], offset=4000)
```

三个格式共有的约定：

- `|` 分隔的元信息头固定字段顺序，截断时在同一行末尾追加 `[截断: 本条剩余 N 字符未返回]`；
- 单次读工具响应的正文总量上限 20000 字符，按 id 顺序累加，到达额度即截断；
- 输出末尾的 `> 下一步:` / `> 续读:` 行写出下一级调用的确切参数，让 Agent 不必自己拼 id 列表；L3 是最后一级，默认不输出，只在还有截断内容时输出 `> 续读:`。

`memory_read` 的 `offset` 是字符偏移，对本次传入的全部 id 统一生效。请求多条且都有截断时，续读按同一条链路继续。

### 6.3 一次典型会话的时序

<figure>

<div style="border:1px solid #e5e7eb;border-radius:12px;padding:20px;background:#fafafa;color:#18181b;font-size:13px">

<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:2.1">
<div><span style="color:#2563eb">1</span>&nbsp; memory_groups() <span style="color:#a1a1aa">→ 2 个可访问分组 · ~60 token</span></div>
<div><span style="color:#2563eb">2</span>&nbsp; memory_search("授权 分组") <span style="color:#a1a1aa">→ 5 条标题 · ~420 token</span></div>
<div><span style="color:#2563eb">3</span>&nbsp; memory_peek([3 个 id]) <span style="color:#a1a1aa">→ 3 条摘要 · ~700 token</span></div>
<div><span style="color:#2563eb">4</span>&nbsp; memory_read(["mem_7f3ka2"]) <span style="color:#a1a1aa">→ 1 条正文 · ~1500 token</span></div>
<div><span style="color:#a1a1aa">5&nbsp; memory_update(...) <span style="color:#a1a1aa">← 仅在需要补充时</span></span></div>
</div>

<div style="margin-top:16px;padding-top:14px;border-top:1px solid #e5e7eb;font-size:12px;color:#71717a">
第 1 步每个会话做一次即可，后续轮次可以跳过。第 2 到 4 步是固定链路，合计三次往返、约 2700 token。
</div>

</div>

</figure>

### 6.4 错误与边界

| 情况 | 层 | 处理 |
|---|---|---|
| 标题、摘要或正文超长 | 工具执行错误 | 拒绝写入，返回实际字符数与上限（如「标题超长 (当前 61 字符，上限 60 字符，拒绝写入)」），不截断，不落库 |
| 无该分组写权限 | 工具执行错误 | `memory_save` 返回「对分组 proj 没有写权限，拒绝写入」；`memory_update` 与 `memory_forget` 返回「对分组 proj 只有只读权限，拒绝修改」。两者均不落库 |
| 目标条目不存在或不在授权范围 | 工具执行错误 | 两者共用同一文案模板「记忆 `mem_7f3ka2` 不存在或无权访问」，仅内嵌调用方传入的 id |
| `ids` 超出条数上限 | 工具执行错误 | 拒绝，返回上限值与本次实际条数（参数校验在工具调度处完成，与其余工具错误同层渲染为 `isError: true`） |
| HTTP 请求体超过 1 MB | HTTP 413 | 在接入层拒绝，不进入工具层 |
| 正文超过 4000 字符 | 成功结果 | 截断并标注剩余字符数，响应附 `> 续读:` 行 |
| 单次响应正文达到 20000 字符 | 成功结果 | 在额度处截断，其余条目与剩余内容靠 `offset` 续读 |
| 单条不属于可访问分组 | 工具执行错误 | 该条标记「无权访问」，其余正常返回 |
| 同分组存在高相似条目 | 成功结果 | `memory_save` 返回相似条目的 id、标题与相似度，并照常创建，把取舍留给 Agent |
| 令牌无效或已撤销 | HTTP 401 | 每个请求重新校验 Key，不进入工具层 |
| 数据库不可用 | JSON-RPC internal error | 原样上报，不降级为业务错误 |

错误分层按 MCP 规范落定：协议层问题走 JSON-RPC error 与 HTTP 状态码，工具自身能给出可操作反馈的问题走工具结果的 `isError: true`。参数条数上限属于后者——框架在进入工具体前完成校验，其结果仍以工具错误返回，不再细分到协议层。

相似度判定用标题的二字组 Jaccard 系数 `|A ∩ B| / |A ∪ B|`，阈值 0.6，两侧集合皆空时相似度定义为 0。这个判定只做提示，不做拦截——误拦截比误提示的代价高。

写入路径的错误分层与只读路径一致：字段超限、无写权限、目标不可达、`review_at` 非法、`clear_review_at` 与 `review_at` 同时给出、删除原因为空、未提供任何待更新字段，全部走工具级 `isError: true`（HTTP 仍为 200）。HTTP 状态码只留给协议层问题。

---

## 七、部署与运维

### 7.1 部署形态

单个容器，单个数据卷，前面一个反向代理负责 TLS。

```
/opt/capsa
├── app/              服务代码
├── data/capsa.db       记忆数据（挂载卷，必须持久化）
├── backup/           每日备份
└── docker-compose.yml
```

反向代理用 Caddy，两行配置自动申请并续期证书：

```
capsa.example.com {
    reverse_proxy 127.0.0.1:8000
}
```

Caddy 默认不缓冲响应体，Streamable HTTP 的流式输出无需额外配置。若改用 nginx，必须显式设置 `proxy_buffering off`、`proxy_http_version 1.1` 与 `proxy_read_timeout 300s`，否则表现为「连接成功但工具结果迟迟不返回」——这是 MCP 服务反代最常见的故障，且现象容易被误判为服务端卡死。

### 7.2 备份

记忆是本项目唯一不可再生的数据，备份不是可选项。WAL 模式下用 SQLite 的在线备份接口，不要在服务运行时直接复制 db 文件：

```bash
sqlite3 /opt/capsa/data/capsa.db ".backup /opt/capsa/backup/$(date +%F).db"
find /opt/capsa/backup -name '*.db' -mtime +14 -delete
```

每日一次，保留 14 天。备份文件建议再同步一份到对象存储，因为主机故障和磁盘故障是两回事。

### 7.3 客户端接入

不同客户端的配置入口不同（Claude Code 用 `claude mcp add`，Cursor 写在 `~/.cursor/mcp.json`），需要填的是同样三项：传输方式、端点、认证头。

```json
{
  "mcpServers": {
    "capsa": {
      "type": "http",
      "url": "https://capsa.example.com/mcp",
      "headers": { "Authorization": "Bearer capsa_a1b2c3d4_xxxxxxxx" }
    }
  }
}
```

### 7.4 命令行

服务之外，低频运维命令保留在 CLI；Web 管理台只承担日常查阅与编辑，不提供 Key 与分组的维护入口：

| 命令 | 作用 |
|---|---|
| `capsa init` | 预置 proj / study / life / track 四个标准分组 |
| `capsa group add <slug> <name> --desc "..."` | 建分组 |
| `capsa key create <name> --scopes proj:rw,study:r` | 签发 Key，明文只打印这一次 |
| `capsa key revoke <keyid>` | 撤销，下一次调用立即失效 |
| `capsa memory list-deleted` / `capsa memory restore <id>` | 回收站列出与恢复，管理员通道 |
| `capsa review [--group proj] [--query 关键词]` | 复用三级检索函数列出记忆，供人工审阅 |
| `capsa backup [dir]` / `capsa restore <snapshot>` | 在线热备快照与回灌 |

命令行前缀与项目名一致，服务、数据文件、Key 前缀与 CLI 共用一个词，配置和排障时不需要在多套命名之间换算。

`capsa review` 与 MCP 工具共用同一套检索实现，因此人工审阅看到的排序和 Agent 看到的一致。这是「审阅」这件事能被信任的前提。

### 7.5 资源估算

| 项 | 估算 |
|---|---|
| CPU / 内存 | 1 vCPU / 256 MB（常驻约 80 MB；检索载入的标题、摘要与标签约 3000 条 × 2 KB） |
| 磁盘 | 条目数 × 正文实际长度，单条正文上限 64 KB；2 KB/条 是典型取值，不是上限 |
| 网络 | HTTP 请求体上限 1 MB，超限在接入层返回 413 |
| 延迟 | 单次工具调用 10 ms 以内（本机），跨地域加一个 RTT |

---

## 八、分期落地

| 阶段 | 内容 | 验收 |
|---|---|---|
| P0 | 建表、授权层、`memory_groups` / `_search` / `_peek` / `_read`、Key CLI、容器化部署 | 用两把不同作用域的 Key 连接，检索到的分组互不可见 |
| P1 | `memory_save` / `_update` / `_forget`、相似条目提示、`review_at` 到期降权 | 只读 Key 写库被拒；超长标题被拒且返回实际字符数；软删除后默认检索不再返回 |
| P2 | 检索调优（权重、标签参与）随 Phase 1 落地；`capsa review` 审阅命令与备份定时任务（`capsa backup` / `restore` + 宿主机 Cron）随 Phase 3 落地 | 同一查询在 CLI 与 MCP 两侧返回顺序一致 |
| P3 | 按需触发，见第九节；其中 Web 管理台已提前作为 Capsa Studio 于 Phase 3 交付（Key 签发 / 分组维护 / 热备仍保留在 CLI） | — |

P0 与 P1 合计在一天工作量级。P3 不应在 P0 之前动工。

---

## 九、明确不做的事

每一项都给出触发条件。条件未达成就不做，达成再评估。

| 不做 | 理由 | 触发条件 |
|---|---|---|
| 向量检索 | L1 本就追求召回而非精度，语义检索解决的问题在这里不构成瓶颈 | 记忆超过 3000 条，或出现「记得内容但关键词对不上」的实际案例三次以上 |
| 自动抽取写入 | 从对话蒸馏事实是记忆污染的主要来源，且需要额外的模型调用 | 不触发。写入始终是显式动作 |
| 知识图谱 | 实体关系推理不是本项目要解决的问题，成本高 | 不触发 |
| 多用户 / 多租户 | 个人项目，多一层租户隔离只会让每条查询都多一个条件 | 出现第二个真实使用者 |
| Web 管理台 | 原触发条件（跨设备查阅与 Markdown 排版摩擦）已达成，Web 管理台作为 Capsa Studio 随 Phase 3 交付；Key 签发 / 分组维护 / 热备与还原仍保留在 CLI | 已触发并交付，演进说明见 `Capsa_可视化前端管理计划.md` §一.1 |
| 待审状态机 | 会把写入变成两段式，且当前的四条约束已覆盖污染风险 | 出现「Agent 写入的错误记忆被采纳并造成实际损失」的案例 |
| 对话流水归档 | 体量大、复用率低，会稀释检索质量 | 不触发 |
| 多副本部署 | SQLite 与多副本冲突，个人规模无扩容诉求 | 单机无法承载时先换存储再谈 |

---

## 十、遗留待决

动工前需要确定的三件事，都不影响架构：

1. **初始分组集合**。目前的设计里分组是数据行，可以随时增删。建议首版先建 `proj` / `study` / `life` / `track` 四组，用一段时间后再调整。
2. **字段加密**。当前设计里 `body` 明文存盘，依赖主机安全与备份加密。若生活类记忆涉及敏感内容，需要在数据访问层加一个固定的对称加密层——这会引入密钥管理，因此先确认是否真的需要。此条决定名字的**来源口径**：需要加密，则 Capsa 的含义取拉丁语原义「书匣」；不需要，则同时取古希腊语 kapsa 的「存放处 / 骨灰瓮」义，把「记忆存放处」这层直接读出来。加密与否不影响已定下的服务名、数据文件与 Key 前缀。
3. **`review_at` 默认值**。是每个分组设一个默认复核周期，还是逐条指定。前者省事，后者精确。建议按分组设默认值，逐条可覆盖。
4. **文件是否随项目改名**。项目定名 Capsa 后，本文件仍是 `docs/Coding/AgentSpace 记忆服务设计方案.md`，评审报告的名称与其中指向本文件的引用也保留 AgentSpace。改名会断开这批路径引用，需要连带修正，因此单独决定。
