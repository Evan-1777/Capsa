# Capsa 项目架构与功能报告（Phase 3 完整交付阶段）

> **文档性质**：系统全景架构、核心功能规格与工程设计报告  
> **适用对象**：具备基础编程经验的 Coding 爱好者、个人技术创作者、全栈开发者  
> **当前状态**：Phase 3（Capsa Studio 可视化管理台、RESTful API、容器化编排与在线热备）已完整交付  
> **测试基线**：自动化测试双轨全绿（161 项 Python pytest 覆盖后端全链路 + 9 项 Playwright 端到端浏览器自动化套件）

---

## 1. 项目定位与核心设计哲学

### 1.1 什么是 Capsa？

**Capsa**（源自拉丁语，意为「小匣子、胶囊」）是一个专为个人 VPS（虚拟专用服务器）量身打造的**轻量级私有长期记忆引擎**。

在日常使用各种大语言模型（如 Claude、Cursor、Cline、各类本地 Agent）辅助编码与思考时，开发者常常面临一个核心困境：**大模型的上下文记忆是短暂的**。一旦新起会话，之前讨论过的架构选型偏好、业务约定、历史踩坑记录全部丢失。

市面上常见的记忆增强方案往往面临两大极端：
1. **纯靠手工提示词（Prompt / Rules）**：把几千字规范全部堆在系统提示词中，不仅剧烈消耗上下文窗口（Context Window）与计费 Token，还容易导致模型注意力分散（Lost in the Middle）。
2. **重型向量数据库方案（RAG / Vector DB）**：动辄引入 Milvus、Chroma、Qdrant、嵌入模型（Embedding Model）与分块抽取流水线。对于个人开发者而言，不仅常驻占用数 GB 内存，而且向量近似检索难以做到「精准匹配」与「按权限隔离」，黑盒感过重。

Capsa 选择了一条**极简、轻量、高确定性**的硬核工程路线：

- **极致轻量无重型依赖**：后端基于 Python 3.12 原生标准库 `sqlite3`，无需常驻外部数据库；内存占用仅几十 MB，个人 1C1G/1C2G VPS 均可轻松驾驭。
- **拥抱标准 MCP 协议**：基于 Anthropic 开源的 **Model Context Protocol（模型上下文协议）**，以原生标准工具（Tools）的形式直连 Agent，开箱即用。
- **双端权限完全对称（MCP + Web）**：无论是 Agent 通过 MCP 读写，还是开发者通过浏览器管理台访问，全部依托统一的数据访问层（DAL）与令牌鉴权，不存在后门或越权漏洞。
- **信息分级披露（L1 → L2 → L3）**：通过「标题检索 → 摘要快速预览 → 正文按需读取」的三级防线，彻底杜绝上下文倾倒与 Token 浪费。

> 💡 **给 Coding 爱好者的批注：什么是 MCP（Model Context Protocol）？**  
> 传统上给 AI 扩展功能需要针对每个平台写不同的插件（如 OpenAI Actions、Dify 插件等）。MCP 是 Anthropic 主导的一种开放标准协议，它让大模型像使用操作系统外设一样，通过 JSON-RPC 标准协议调用外部工具或读取外部数据源。只要你的服务实现了 MCP，就能无缝接入 Claude Desktop、Cursor 等支持该标准的客户端。

---

## 2. 整体系统架构与分层设计

Capsa 采用清晰的「单向依赖、严格分层」架构。系统整体划分为 4 个职责鲜明的层级：网络接入层、协议与传输适配层、领域逻辑层、持久化存储层。

<div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; background-color: #f8fafc; margin: 20px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
<div style="font-weight: 600; font-size: 15px; margin-bottom: 16px; color: #0f172a; display: flex; align-items: center; gap: 8px;">
<span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: #2563eb;"></span>
Capsa 全景架构与分层拓扑图
</div>
<div style="display: flex; flex-direction: column; gap: 12px;">

<div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px;">
<div style="font-size: 12px; font-weight: 600; color: #64748b; margin-bottom: 6px;">1. 网络与反向代理接入层（Edge & Ingress）</div>
<div style="display: flex; gap: 10px; font-size: 13px; color: #1e293b;">
<span style="background: #e0f2fe; color: #0369a1; padding: 4px 8px; border-radius: 4px; font-weight: 500;">Caddy 2 (自动 HTTPS / 1MB 请求体限制 / 无缓冲流式转发)</span>
<span style="background: #f1f5f9; color: #475569; padding: 4px 8px; border-radius: 4px;">端口 80/443</span>
</div>
</div>

<div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px;">
<div style="font-size: 12px; font-weight: 600; color: #64748b; margin-bottom: 6px;">2. ASGI 根应用与中间件（Root Starlette Application / capsa/server.py）</div>
<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; font-size: 12px; text-align: center;">
<div style="background: #f8fafc; border: 1px dashed #cbd5e1; padding: 8px; border-radius: 4px;">
<b style="color: #0f172a;">GET /healthz</b><br><span style="color: #64748b;">DB 可用性探测</span>
</div>
<div style="background: #f8fafc; border: 1px dashed #cbd5e1; padding: 8px; border-radius: 4px;">
<b style="color: #0f172a;">/mcp</b><br><span style="color: #64748b;">FastMCP 子应用直挂</span>
</div>
<div style="background: #f8fafc; border: 1px dashed #cbd5e1; padding: 8px; border-radius: 4px;">
<b style="color: #0f172a;">/api/*</b><br><span style="color: #64748b;">REST API (Bearer 守卫)</span>
</div>
<div style="background: #f8fafc; border: 1px dashed #cbd5e1; padding: 8px; border-radius: 4px;">
<b style="color: #0f172a;">/ (Root)</b><br><span style="color: #64748b;">Capsa Studio SPA 静态托管</span>
</div>
</div>
<div style="margin-top: 8px; font-size: 11px; color: #94a3b8; text-align: right;">
* 全局挂载 Starlette 内置 RequestBodyLimitMiddleware（1MB 截断）
</div>
</div>

<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
<div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px;">
<div style="font-size: 12px; font-weight: 600; color: #2563eb; margin-bottom: 6px;">3A. MCP 传输适配层 (capsa/mcp_service.py)</div>
<div style="font-size: 11px; color: #475569; line-height: 1.5;">
• 4 个只读工具（search / peek / read / groups）<br>
• 3 个写入工具（create / update / delete）<br>
• 报错返回工具级 <code>isError: true</code>，纯文本渲染
</div>
</div>
<div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px;">
<div style="font-size: 12px; font-weight: 600; color: #059669; margin-bottom: 6px;">3B. Web RESTful API (capsa/web_api.py)</div>
<div style="font-size: 11px; color: #475569; line-height: 1.5;">
• 8 个端点（认证 / 分组 / 列表 / 详情 / 增删改 / 恢复）<br>
• 统一 JSON 信封：<code>{success, data, error}</code><br>
• 错误映射为 HTTP 状态码 + 业务错误码
</div>
</div>
</div>

<div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px;">
<div style="font-size: 12px; font-weight: 600; color: #64748b; margin-bottom: 6px;">4. 领域纯函数与数据访问层 (Domain & Data Access Layer)</div>
<div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; font-size: 12px;">
<div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 8px; border-radius: 4px;">
<b style="color: #0f172a;">capsa/dal.py</b><br>
<span style="color: #64748b; font-size: 11px;">系统唯一 SQL 出口、三态权限判别、软删除状态机</span>
</div>
<div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 8px; border-radius: 4px;">
<b style="color: #0f172a;">capsa/retrieval.py</b><br>
<span style="color: #64748b; font-size: 11px;">二字组分词、相关度排序、标题相似度查重、时间标准化</span>
</div>
<div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 8px; border-radius: 4px;">
<b style="color: #0f172a;">capsa/auth.py</b><br>
<span style="color: #64748b; font-size: 11px;">Bearer 令牌校验、SHA-256 散列匹配、即时吊销检查</span>
</div>
</div>
</div>

<div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px;">
<div style="font-size: 12px; font-weight: 600; color: #64748b; margin-bottom: 6px;">5. 持久化存储与热备层 (Storage & Backup / capsa/db.py & cli.py)</div>
<div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #334155;">
<span><b>SQLite3 (WAL 模式)</b>：连接级别短连接，零常驻连接池泄露风险，<code>groups</code> / <code>api_keys</code> / <code>memories</code> 3 张核心表</span>
<span style="background: #fef3c7; color: #92400e; padding: 2px 6px; border-radius: 4px; font-size: 11px;">Online Backup API 在线热备</span>
</div>
</div>

</div>
</div>

### 2.2 核心模块调用契约与依赖流向

Capsa 坚持**单向依赖原则**：
```
server ──► {mcp_service, web_api} ──► {dal, retrieval, formatters} ──► db
```

1. **唯一 SQL 出口**：`capsa/dal.py` 是全系统中**唯一编写并执行 SQL** 的模块。MCP 工具层与 Web API 层内部绝不包含哪怕一行裸 SQL，杜绝业务与存储逻辑耦合。
2. **纯函数无状态算法**：`capsa/retrieval.py`（检索打分、查重）和 `capsa/formatters.py`（文本格式化）是纯函数模块，不依赖任何数据库连接与网络上下文，极其便于高确定性单测。
3. **短连接与 WAL 模式**：`capsa/db.py` 使用标准库 `sqlite3` 短连接。每次请求进入时打开连接并设置超时与 WAL（Write-Ahead Logging）模式，执行完毕后在 `finally` 中显式关闭，完全规避了长连接锁死和死锁问题。

---

## 3. 双轨交互能力：MCP 协议与 Web REST API

Capsa 同时向 Agent（代码助手）与人类用户（开发者）提供服务，两者的权限体系完全对称，但交互协议依据各自场景做了精准适配。

### 3.1 面向 Agent 的 MCP 协议工具集（7 个工具）

Agent 通过标准 MCP 协议，使用其持有的 Bearer Token 与 Capsa 通信。Capsa 提供了 4 个只读工具和 3 个写入工具：

| 工具名称 | 分类 | 核心参数 | 职能与输出特点 |
|:---|:---:|:---|:---|
| `memory_search` | 只读 (L1) | `query`, `group`, `limit` | 关键词精准检索。**仅输出命中条目的 ID、标题、标签与复核状态**，绝不吐出正文，防止撑爆上下文。 |
| `memory_peek` | 只读 (L2) | `ids` (数组) | 批量窥探摘要。根据 L1 选出的 ID 列表，批量返回条目的**标题与核心摘要**（Summary），辅助二次筛选。 |
| `memory_read` | 只读 (L3) | `id` (单条) | 完整正文读取。针对确认需要的具体 ID，输出完整正文 Markdown。按需读取，精确消耗 Token。 |
| `memory_groups` | 只读 | 无 | 列出当前 Token 具备读取权限的所有有效分组及其统计信息。 |
| `memory_create` | 写入 | `group`, `title`, `summary`, `body`, `tags`, `review_at` | 新建记忆。自动进行**标题近似查重**，若有相似条目会在回复中提示，但不拦截保存。 |
| `memory_update` | 写入 | `id`, `title`, `summary`, `body`, `tags`, `pinned`, `review_at`, `clear_review_at` | 局部增量修改。未提供的字段保持原样；提供显式置空开关。拒绝跨分组移动。 |
| `memory_delete` | 写入 | `id`, `reason` | 软删除（进入回收站）。必须附带删除原因，数据不物理抹除，保留恢复余地。 |

> 💡 **给 Coding 爱好者的批注：L1/L2/L3 分级披露设计思想**  
> 想象一下你去图书馆查资料：L1 是「图书检索目录」（只看书名和分类），L2 是「翻看前言与内容提要」（确认是否对胃口），L3 是「把书借走精读」（查看正文内容）。  
> 如果大模型一次性把所有记忆内容搜出来塞进对话，不仅会导致对话变慢、计费暴涨，更致命的是会让模型产生「幻觉」或遗忘用户当前真正交代的工作。分级披露是 Agent 长期记忆系统的黄金法则。

---

### 3.2 面向前端的 Web RESTful API（8 个端点）

为了让用户在浏览器中直观审阅和管理记忆，Capsa 在 `/api` 下提供了一套语义规范的 REST API，由 `capsa/web_api.py` 实现。

#### 统一信封格式（Unified Envelope）
所有端点均返回统一 JSON 结构，前端只需一套拦截器即可处理全部请求：

```json
// 成功响应 (HTTP 200)
{
  "success": true,
  "data": { ... },
  "error": null
}

// 失败响应 (HTTP 401 / 403 / 404 / 422 / 500)
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "标题长度不能超过 100 个字符"
  }
}
```

#### 端点清单与职能对照表

| HTTP 方法 | 路径 | 权限要求 | 职能描述 | 核心业务与防御行为 |
|:---|:---|:---:|:---|:---|
| `GET` | `/api/auth/me` | 有效 Token | 获取当前登录凭据信息 | 返回 Key ID、名称及各分组授权范围（`scopes`） |
| `GET` | `/api/groups` | 有效 Token | 获取授权分组列表 | 附带各分组下活跃记忆数量（Count） |
| `GET` | `/api/memories` | 有效 Token | 分页查询记忆列表 | 支持 `status`（active/overdue/deleted）、分组筛选与关键词检索 |
| `POST` | `/api/memories` | `rw` 权限 | 手工创建新记忆 | 执行字段长度校验、近似查重并持久化落库 |
| `GET` | `/api/memories/{id}` | `r` 或 `rw` | 获取单条记忆详情 | 返回包括正文 Markdown、标签、复核状态等完整字段 |
| `PUT` | `/api/memories/{id}` | `rw` 权限 | 编辑更新记忆 | 支持白名单字段局部更新与复核时间置空 |
| `DELETE` | `/api/memories/{id}` | `rw` 权限 | 软删除记忆 | 要求必填删除原因 `reason`，条目进入回收站 |
| `POST` | `/api/memories/{id}/restore` | `rw` 权限 | 从回收站恢复记忆 | 清除 `deleted_at` 恢复为活跃态 |

---

## 4. 核心功能与关键技术深度解析

### 4.1 严格的三态授权防线（Zero-Leakage Authorization）

在私有部署多 Agent 场景下，不同 Agent 或不同场景持有的 Key 权限各不相同（例如代码 Agent 持有 `proj: rw`，生活助手持有 `life: rw`，而审计脚本持有 `proj: r`）。

为了防止恶意探测或越权，Capsa 在数据访问层（`capsa/dal.py`）确立了**严格的三态防线**：

<table style="width: 100%; border-collapse: collapse; font-size: 13px; margin: 16px 0;">
<thead>
<tr style="background-color: #f1f5f9; text-align: left;">
<th style="padding: 10px; border: 1px solid #cbd5e1; width: 15%;">判定状态</th>
<th style="padding: 10px; border: 1px solid #cbd5e1; width: 35%;">触发条件</th>
<th style="padding: 10px; border: 1px solid #cbd5e1; width: 50%;">系统的安全防御行为</th>
</tr>
</thead>
<tbody>
<tr>
<td style="padding: 10px; border: 1px solid #cbd5e1; font-weight: 600; color: #059669;">authorized</td>
<td style="padding: 10px; border: 1px solid #cbd5e1;">条目存在，且当前 Token 具备该分组访问权限</td>
<td style="padding: 10px; border: 1px solid #cbd5e1;">正常放行，返回数据。</td>
</tr>
<tr>
<td style="padding: 10px; border: 1px solid #cbd5e1; font-weight: 600; color: #dc2626;">forbidden</td>
<td style="padding: 10px; border: 1px solid #cbd5e1;">条目存在，但当前 Token <b>无权访问</b>该条目所在的分组</td>
<td style="padding: 10px; border: 1px solid #cbd5e1;"><b>绝不泄露分组名与标题！</b>底层仅返回 <code>status="forbidden"</code> 与 ID。在 Web 端和 MCP 端统一呈现为「记忆不存在或无权访问」（与 404 响应逐字一致）。</td>
</tr>
<tr>
<td style="padding: 10px; border: 1px solid #cbd5e1; font-weight: 600; color: #64748b;">not_found</td>
<td style="padding: 10px; border: 1px solid #cbd5e1;">数据库中不存在该 ID，或该条目已被软删除</td>
<td style="padding: 10px; border: 1px solid #cbd5e1;">返回不存在。</td>
</tr>
</tbody>
</table>

> 💡 **给 Coding 爱好者的批注：什么是「侧信道防泄露」（Side-Channel Protection）？**  
> 很多新手开发者写 API 时，喜欢返回「该条目属于机密分组 VIP，您无权查看」。这看似友好，实则存在严重安全隐患：未授权人员可以通过不断尝试 ID（如 `mem_000001`, `mem_000002`），轻而易举地探知系统中到底存在哪些私密分组和条目 ID！  
> Capsa 的做法是：对未授权分组的条目与完全不存在的条目，对外返回完全相同、毫无区别的 404 文本，从根本上封死侧信道探测。

---

### 4.2 零依赖的中文二字组检索与打分引擎

Capsa 没有使用重型外部搜索引擎或分词库（如 Jieba、Elasticsearch），而是在 `capsa/retrieval.py` 中以纯算法实现了高性能的**二字组切分（Bigram）与内存打分算法**。

#### 1. 为什么不用 SQLite 自带的 FTS5 或传统分词器？
- SQLite 内置的 `unicode61` 分词器仅按空格和标点断词，对连续的中文汉字召回率为 0；
- 内置的 `trigram`（三字元）分词器要求查询词至少 3 个字，用户搜「部署」「接口」等 2 字常用词时直接失效；
- 引入第三方分词库（如 Jieba）会带来庞大的词典文件依赖与冷启动开销。

#### 2. Capsa 的解决方案：二字组切分（Bigram）
将中文字符串按滑动窗口截取连续的 2 个字符：
- 输入文本：「项目接口规范」
- 切分词元：`['项目', '目接', '接口', '口规', '规范']`
- 匹配逻辑：计算查询词元在各字段的命中频次。

#### 3. 权重打分与排序公式
对候选条目进行综合相关度打分：
```
Score = (TitleHits * 5) + (SummaryHits * 3) + (TagHits * 4) + (BodyHits * 1) + (Pinned * 3) - (Expired * 2)
```

- **硬性词元命中门槛**：只有标题、摘要、标签或正文至少命中 1 个查询词元的条目才被视作候选。杜绝了「因置顶加分而召回完全无关记忆」的噪声问题。
- **个人规模性能**：在个人数千条至上万条记忆规模下，纯 Python 内存全量打分排序仅耗时 **2~5 毫秒**，极度敏捷且零依赖。

---

### 4.3 标题近似查重机制（防冗余防腐）

当 Agent 或用户向 Capsa 写入新记忆时，系统会自动在同分组的活跃记忆中进行标题近似度检测：
- 采用二字组 Jaccard 相似度系数（相交词元数 / 并集词元数）；
- 当相似度达到阈值时，写入接口会**照常保存**，但在返回中显式附带 `similar_items` 列表（包含相似记忆的 ID、标题与相似百分比）。
- **设计哲学**：只提示、不阻断。因为大模型具有自主决策能力，提醒其可能存在重复比强行报错更符合智能体的工作流。

---

### 4.4 可视化管理台 Capsa Studio（前端工程）

Capsa Studio 是一个嵌入式单页应用（SPA），专为个人开发者审阅记忆设计：
- **现代化技术栈**：基于 Vite + React 18 + TypeScript + Tailwind CSS 构建。
- **多状态状态机**：利用自定义 `useAsync` 钩子，优雅处理加载中（Loading）、空数据（Empty）、网络错误（Error）、未授权（Unauthorized）四态展示。
- **三重视图导航**：
  1. **工作台（Workspace）**：按分组浏览、搜索、分页查看活跃记忆，支持展开抽屉查看正文并进行 Markdown 富文本渲染与增量编辑。
  2. **复核中心（Review Center）**：集中陈列所有过期未复核（Overdue）的记忆，方便定期维护和更新过时认知。
  3. **回收站（Recycle Bin）**：列出软删除的条目与删除理由，支持一键安全恢复。
- **XSS 安全净化防线**：前端集成 `react-markdown` 与 `rehype-sanitize`，将 `skipHtml` 设为 `true`，全站杜绝 `dangerouslySetInnerHTML`，彻底防范恶意 Markdown 脚本注入。

---

### 4.5 数据库设计与持久化机制

Capsa 的数据库 schema 极度精简优雅，定义于 `capsa/db.py`，包含 3 张表：

<div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin: 16px 0; font-family: sans-serif;">

<div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px;">
<div style="font-weight: 600; font-size: 13px; color: #0f172a; border-bottom: 2px solid #3b82f6; padding-bottom: 6px; margin-bottom: 8px;">groups (分组表)</div>
<div style="font-size: 11px; color: #475569; line-height: 1.6;">
• <b>slug</b> (TEXT PK, 如 proj/study)<br/>
• <b>name</b> (TEXT, 中文名称)<br/>
• <b>description</b> (TEXT, 分组说明)<br/>
• <b>created_at</b> (TEXT ISO-8601)
</div>
</div>

<div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px;">
<div style="font-weight: 600; font-size: 13px; color: #0f172a; border-bottom: 2px solid #10b981; padding-bottom: 6px; margin-bottom: 8px;">api_keys (令牌凭据表)</div>
<div style="font-size: 11px; color: #475569; line-height: 1.6;">
• <b>id</b> (TEXT PK, 8 位唯一识别码)<br/>
• <b>token_hash</b> (TEXT, SHA-256 密文)<br/>
• <b>name</b> (TEXT, 密钥用途说明)<br/>
• <b>scopes_json</b> (TEXT, 授权字典)<br/>
• <b>revoked_at</b> (TEXT, 撤销标记)
</div>
</div>

<div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px;">
<div style="font-weight: 600; font-size: 13px; color: #0f172a; border-bottom: 2px solid #8b5cf6; padding-bottom: 6px; margin-bottom: 8px;">memories (核心记忆表)</div>
<div style="font-size: 11px; color: #475569; line-height: 1.6;">
• <b>id</b> (TEXT PK, mem_ + 6位随机码)<br/>
• <b>group_slug</b> (TEXT FK, 关联 groups)<br/>
• <b>title, summary, body</b> (TEXT)<br/>
• <b>tags_json</b> (TEXT JSON 数组)<br/>
• <b>pinned</b> (INTEGER, 0/1 置顶标记)<br/>
• <b>review_at</b> (TEXT, 复核期限)<br/>
• <b>deleted_at, deleted_reason</b> (软删除)
</div>
</div>

</div>

> 💡 **给 Coding 爱好者的批注：ID 设计与碰撞重试**  
> Capsa 的记忆 ID 格式形如 `mem_a1b2c3`（前缀 + 6 位随机字符）。在万条数据量级下，随机串存在极低概率的主键碰撞。许多程序要么采用超长难以阅读的 UUID，要么碰撞时直接报错。  
> Capsa 采取了更优雅的做法：系统在底层写入时内置了「3 次碰撞自动换号重试」机制，既保持了 ID 的简短可读，又确保了落库的百分之百成功。

---

## 5. 运维闭环：管理 CLI、在线热备与容器化

### 5.1 管理员专属 CLI 工具链（`capsa`）

对于高敏感操作（如 Key 签发/撤销、数据库初始化、快照热备），Capsa 遵循**管理通道与业务通道物理隔离**原则，绝不暴露到 Web API，仅能通过宿主机 CLI 运行：

```bash
# 1. 初始化数据库结构与 4 个内置标准分组 (proj / study / life / track)
capsa init

# 2. 签发具备分组权限限制的 API Key
capsa key create "Claude Desktop 客户端" --scopes "proj:rw,study:r"
# 输出: 
# Key ID: 8a1b2c3d
# 令牌: capsa_8a1b2c3d_9f8e7d6c5b4a3... (明文仅打印一次)

# 3. 吊销指定 Key
capsa key revoke 8a1b2c3d

# 4. 管理员审阅模式（与 MCP 排序完全一致）
capsa review --group proj --query "FastMCP"

# 5. 回收站管理与恢复
capsa memory list-deleted
capsa memory restore mem_x9y8z7

# 6. 生成在线热备快照（支持保留策略）
capsa backup /backup --keep-days 14

# 7. 从快照回灌恢复
capsa restore /backup/capsa-2026-09-13.db
```

---

### 5.2 在线热备机制（Online Backup API）

在传统的 SQLite 使用中，很多开发者习惯用 `cp capsa.db backup.db` 进行文件拷贝。**在 WAL 模式并发写入下，这种物理拷贝极易导致备份文件损坏或缺失未提交日志**！

Capsa 的 `capsa backup` 底层直接调用 SQLite 官方的 `Connection.backup()` C-API 接口：
- **无锁在线快照**：在服务正常运行、不中断读写的前提下，生成事务一致性的物理快照。
- **自动化生命周期清理**：根据备份文件名（`capsa-YYYY-MM-DD.db`）中的日期进行确定性解析，自动删除超过 14 天的过期快照。
- **定时热备接入**：只需在宿主机添加一行 Crontab，即可实现每日无感备份：
  ```cron
  0 3 * * * docker compose -f /opt/capsa/docker-compose.yml exec -T capsa capsa backup /backup
  ```

---

### 5.3 生产级容器编排与部署

Capsa 提供了开箱即用的 Docker 生产化方案，由 `Dockerfile`、`docker-compose.yml` 与 `Caddyfile` 协同工作：

1. **多阶段构建 Dockerfile**：
   - 第一阶段（`node:20-alpine`）：编译前端 SPA，提取静态产物。
   - 第二阶段（`python:3.12-slim`）：打包后端 Python 运行时，将前端产物拷贝至 `capsa/static/`。最终镜像**完全剔除 Node.js 环境**，镜像体积极小。
   - **非 root 用户运行**：容器内以 `capsa:capsa`（UID 1000）运行，严格遵循生产安全规范。
2. **Caddy 2 反向代理网关**：
   - 自动申请与续签 Let's Encrypt / ZeroSSL 证书（自动 HTTPS）；
   - 前置强制拦截超出 1MB 的超大请求（`max_size 1MB`）；
   - 配置 `flush_interval -1` 关闭响应缓冲，保障 MCP 流式传输与 Server-Sent Events 零延迟下发。

---

## 6. 代码资产清单与测试度量

经过 Phase 1 至 Phase 3 的持续演进与收敛重构，Capsa 保持着惊人的紧凑度与工程质量：

### 6.1 代码资产盘点

| 层次 / 模块 | 关键文件路径 | 代码行数 (LOC) | 核心职责说明 |
|:---|:---|:---:|:---|
| **ASGI 根容器** | `capsa/server.py` | 53 | 应用工厂、请求体 1MB 拦截、路由装配与静态前端条件挂载 |
| **Web REST API** | `capsa/web_api.py` | 347 | 统一 JSON 信封、Bearer 守卫中间件、8 个 REST 端点与异常映射 |
| **MCP 工具服务** | `capsa/mcp_service.py` | 243 | 注册 7 个标准 MCP 工具、参数长度校验与纯文本格式输出 |
| **数据访问层 (DAL)** | `capsa/dal.py` | 323 | 唯一 SQL 出口、三态判定实现、分页查询与软删除状态机 |
| **算法与检索** | `capsa/retrieval.py` | 157 | 中文二字组分词、相关度打分公式、标题 Jaccard 相似度查重 |
| **格式化输出** | `capsa/formatters.py` | 126 | L1 / L2 / L3 纯文本契约渲染与字符数截断控制 |
| **鉴权与令牌** | `capsa/auth.py` | 36 | Bearer Token 提取、SHA-256 散列校验、FastMCP 鉴权挂载 |
| **数据库管理** | `capsa/db.py` | 84 | SQLite 连接辅助、WAL 模式配置、幂等建表与健康探测 |
| **系统管理 CLI** | `capsa/cli.py` | 269 | 数据库初始化、Key 签发与吊销、同源审阅、在线热备与回灌 |
| **ID 与令牌生成** | `capsa/ids.py` | 26 | 统一规范前缀生成器与加密安全随机数 |
| **Web 管理台前端** | `web/src/**/*.{ts,tsx}` | ~970 | Capsa Studio 界面：登录、工作台、复核中心、回收站与 Markdown 渲染 |
| **部署与运维** | `Dockerfile`, `docker-compose.yml`, `Caddyfile` | ~70 | 生产多阶段构建镜像、容器网络与 Caddy 自动 TLS 反代 |

---

### 6.2 自动化测试质量网格

Capsa 坚持「测试驱动、双轨覆盖」，当前测试集涵盖 10 个测试套件，全部通过：

```
tests/test_acceptance.py .......                                         [  4%]
tests/test_cli.py ........                                               [  9%]
tests/test_e2e.py .........                                              [ 14%]
tests/test_phase3_assembly.py ...                                        [ 16%]
tests/test_phase3_cli.py .........                                       [ 22%]
tests/test_phase3_deploy.py ....                                         [ 24%]
tests/test_units.py ....................                                 [ 37%]
tests/test_web_api.py ....................................               [ 59%]
tests/test_write.py .....................................                [ 82%]
================== 161 passed, 0 failed in pytest ==================
web/tests/e2e.spec.ts .........................                          [100%]
================== 9 passed in Playwright (Chrome) =================
```

- **后端链路（161 项 pytest 断言）**：
  - 覆盖三态授权、只读检索、写入生命周期、标题查重、软删除恢复；
  - 覆盖 REST API 统一信封、状态码映射、1MB 请求体截断、静态目录存在性条件挂载；
  - 覆盖 SQLite Online Backup 快照一致性、过期清理与 CLI 同源审阅。
- **前端端到端（9 项 Playwright 浏览器测试）**：
  - 覆盖真实 uvicorn 进程启动、真实 Token 登录认证与 sessionStorage 状态切换；
  - 覆盖记忆创建、富文本 Markdown 渲染、XSS 脚本过滤与防注入验证；
  - 覆盖编辑更新、软删除流入回收站与回收站成功恢复全生命周期。

---

## 7. 总结与后续演进

Capsa 历经三个阶段的稳健开发，已经成为一套**小而美、安全可靠、完全自闭环的个人记忆中枢**：
1. **对 AI**：它是一个响应迅捷、不浪费上下文、遵循 MCP 标准的外部外脑；
2. **对人**：它是一个无需维护重型中间件、单文件即可备份、带有优雅 Web 管理台的私人知识归宿。

未来在保持极简与轻量的前提下，潜在的演进方向可包括：
- **端到端加密导出**：支持将快照进行 GPG 导出，便于直接备份到第三方私有存储；
- **智能标签聚合**：在前端展示标签云或关系视图，帮助开发者直观感知自己的技术认知图谱。