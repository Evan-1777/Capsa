# Capsa 项目架构与功能报告（Phase 2 阶段）

> **文档性质**：当前阶段系统架构与功能规格报告  
> **适用对象**：具备基础编程与脚本经验的 Coding 爱好者、技术使用者  
> **当前状态**：Phase 2（读写生命周期闭环）已完成交付，Phase 3（管理台与容器化）规划中  
> **代码基线**：101 项单元与端到端自动化测试全部通过（退出码 0）

---

## 1. 项目定位与核心设计思路

### 1.1 什么是 Capsa？
**Capsa**（拉丁语中意为「匣子 / 胶囊」）是一个运行在个人 VPS（虚拟专用服务器）上的**轻量级私有记忆引擎**。

在日常使用各类 AI Agent（如 Claude、Cursor、本地智能体）时，我们往往希望 AI 记住用户的技术栈偏好、常用配置、过往方案或待办备忘。传统的做法通常是把所有内容塞进 Prompt，或者引入沉重的向量数据库（Vector DB / RAG）。Capsa 选择了更轻、确定性更高的工程路径：

- **轻量无外部重型依赖**：后端采用 Python 3.12 原生标准库 `sqlite3`，无需安装庞大的向量索引或常驻重型数据库。
- **只走标准 MCP 协议**：基于 Anthropic 提出的 Model Context Protocol（模型上下文协议），以原生工具形式被各类支持 MCP 的客户端直接调用。
- **分组隔离与权限管控**：每一把 API Key 拥有精细的作用域（Scope），例如仅允许读取 `study`（学习笔记）分组，而对 `proj`（项目工程）拥有读写权限。
- **防信息过载的分级披露（L1 / L2 / L3）**：避免一次性把成千上万字的记忆倾倒给大模型消耗上下文，由浅入深按需检索。

---

## 2. 整体系统架构与分层设计

Capsa 整体由外至内划分为 4 个职责分明的层级：网络接入层、协议与鉴权层、领域处理层、持久化存储层。

<div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; background-color: #f8fafc; margin: 20px 0; font-family: sans-serif;">
  <div style="font-weight: 600; font-size: 15px; margin-bottom: 16px; color: #0f172a;">Capsa 系统分层架构</div>
  <div style="display: flex; flex-direction: column; gap: 12px;">
    
    <!-- 客户端 -->
    <div style="background: #ffffff; border: 1px dashed #94a3b8; border-radius: 6px; padding: 12px; text-align: center;">
      <div style="font-weight: 600; color: #334155; font-size: 13px;">外部 AI Agent 客户端 / CLI 管理员</div>
      <div style="font-size: 11px; color: #64748b; margin-top: 4px;">通过 HTTP Bearer 令牌 或 本机 CLI 命令访问</div>
    </div>

    <div style="text-align: center; color: #94a3b8; font-size: 12px;">▼ 1MB 请求体限制 / Bearer 认证</div>

    <!-- 协议与接入层 -->
    <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 6px; margin-bottom: 8px;">
        <span style="font-weight: 600; font-size: 13px; color: #0f172a;">1. 接入与协议层 (server.py & auth.py)</span>
        <span style="font-size: 11px; background: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 4px;">Starlette + FastMCP 4</span>
      </div>
      <div style="font-size: 12px; color: #475569; line-height: 1.6;">
        • <b>RequestBodyLimitMiddleware</b>：严格拦截 &gt; 1MB 的超长请求，防止内存拒绝服务。<br/>
        • <b>CapsaTokenVerifier</b>：校验 Token 是否合法有效，解析该 Key 绑定的分组权限映射（grants）。
      </div>
    </div>

    <div style="text-align: center; color: #94a3b8; font-size: 12px;">▼ 经上下文注入 grants 权限</div>

    <!-- 工具与业务层 -->
    <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 6px; margin-bottom: 8px;">
        <span style="font-weight: 600; font-size: 13px; color: #0f172a;">2. MCP 业务工具层 (mcp_service.py)</span>
        <span style="font-size: 11px; background: #fef3c7; color: #92400e; padding: 2px 6px; border-radius: 4px;">7 个核心工具</span>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px; margin-top: 6px;">
        <div style="background: #f1f5f9; padding: 8px; border-radius: 4px;">
          <div style="font-weight: 600; color: #1e293b;">4 个只读检索工具</div>
          <div style="color: #64748b; margin-top: 2px;">groups, search (L1), peek (L2), read (L3)</div>
        </div>
        <div style="background: #f1f5f9; padding: 8px; border-radius: 4px;">
          <div style="font-weight: 600; color: #1e293b;">3 个生命周期工具</div>
          <div style="color: #64748b; margin-top: 2px;">save (新建), update (局部修改), forget (软删除)</div>
        </div>
      </div>
    </div>

    <div style="text-align: center; color: #94a3b8; font-size: 12px;">▼ 算法排序 / 数据格式化 / 隔离防线判定</div>

    <!-- 纯计算与数据层 -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
      <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px;">
        <div style="font-weight: 600; font-size: 12px; color: #0f172a; margin-bottom: 4px;">算法与展示 (纯函数无状态)</div>
        <div style="font-size: 11px; color: #475569; line-height: 1.5;">
          • <b>retrieval.py</b>：中文二字组分词、相关度打分、相似标题查重算法。<br/>
          • <b>formatters.py</b>：严格限制单次返回体积的纯文本渲染契约。
        </div>
      </div>
      <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px;">
        <div style="font-weight: 600; font-size: 12px; color: #0f172a; margin-bottom: 4px;">数据访问层 (唯一 SQL 出口)</div>
        <div style="font-size: 11px; color: #475569; line-height: 1.5;">
          • <b>dal.py</b>：三态授权隔离（authorized / forbidden / not_found）、事务管理。<br/>
          • <b>db.py</b>：SQLite 短连接池与幂等建表。
        </div>
      </div>
    </div>

  </div>
</div>

---

## 3. 核心功能深度解析

### 3.1 分级检索协议（L1 → L2 → L3）

大语言模型的上下文窗口虽然越来越大，但直接加载海量文本会造成严重的响应延迟与 Token 费用浪费。Capsa 规定了严格的递进读取协议：

<div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; background-color: #ffffff; margin: 16px 0;">
  <div style="font-weight: 600; font-size: 14px; color: #0f172a; margin-bottom: 12px;">三级披露协议工作流</div>
  <div style="display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: #334155; gap: 8px;">
    
    <div style="flex: 1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; background: #f8fafc;">
      <div style="font-weight: 600; color: #2563eb;">第 1 步：L1 标题层</div>
      <div style="font-family: monospace; color: #0f172a; margin: 4px 0;">memory_search</div>
      <div style="font-size: 11px; color: #64748b;">单次返回最多 20 条。<br/>仅包含：ID、标题、标签、分组、是否置顶。<br/><em>Token 消耗：极低</em></div>
    </div>

    <div style="color: #94a3b8; font-weight: bold;">➔</div>

    <div style="flex: 1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; background: #f8fafc;">
      <div style="font-weight: 600; color: #059669;">第 2 步：L2 摘要层</div>
      <div style="font-family: monospace; color: #0f172a; margin: 4px 0;">memory_peek</div>
      <div style="font-size: 11px; color: #64748b;">单次最多查询 10 条 ID。<br/>包含：200 字以内的摘要与基本信息。<br/><em>Token 消耗：中等</em></div>
    </div>

    <div style="color: #94a3b8; font-weight: bold;">➔</div>

    <div style="flex: 1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; background: #f8fafc;">
      <div style="font-weight: 600; color: #d97706;">第 3 步：L3 正文层</div>
      <div style="font-family: monospace; color: #0f172a; margin: 4px 0;">memory_read</div>
      <div style="font-size: 11px; color: #64748b;">单次最多查询 5 条 ID。<br/>获取完整正文，支持字符偏移分页。<br/><em>Token 消耗：按需精确控制</em></div>
    </div>

  </div>
</div>

> **给 Coding 爱好者的批注**：  
> 为什么这样设计？很多初学者构建 Agent 时喜欢「搜索关键词 -> 把搜出来的所有完整文章一次性粘给大模型」。当记忆达到几百条时，上下文瞬间被挤爆。Capsa 强制 Agent「先看目录（L1），觉得有相关性的看一眼摘要（L2），确认必须使用的才拉取具体内容（L3）」，这是工程落地的极简防膨胀机制。

---

### 3.2 写入生命周期与数据防腐

在 Phase 2 中，Capsa 补齐了完整的写入闭环，包含 3 个核心工具：

1. **`memory_save`（创建新记忆）**：
   - **严格字段校验**：标题 $le 60$ 字符，摘要 $le 200$ 字符，正文 $le 64,000$ 字符。一旦超限，直接拒绝并报错，绝不静默截断文本（防止信息被截断导致 Agent 产生幻觉）。
   - **标题近似查重（Soft Duplication Check）**：利用 Jaccard 相似度与公共子串算法，如果同一分组下存在相似标题，**照常创建成功，但在返回结果中明确列出相似条目**。这样既避免了误拦截 Agent 的写入意图，又提醒了 Agent「你可能记了重复的事」。
2. **`memory_update`（局部字段更新）**：
   - 支持单独更新某个字段（标题、正文、标签、置顶标记 `pinned` 等），无需每次传递全量内容。
   - 复核提醒支持：可设置 `review_at`（例如过期提示），也可以通过 `clear_review_at: true` 显式移除。
3. **`memory_forget`（安全软删除）**：
   - 彻底避免物理删除（`DELETE FROM memories`）。
   - 删除时必须填写删除原因（`reason`），系统仅打上 `deleted_at` 时间戳，数据被移入回收站。
   - 若 Agent 误删除了重要记忆，管理员可通过命令行 CLI 轻松查看回收站并一键恢复（`capsa memory restore <id>`）。

---

### 3.3 零重型依赖的检索与打分算法

很多记忆系统一上来就引入向量模型（Embedding）和向量库（Chroma / Milvus），这在个人 VPS（通常仅 1C 1G/2G 内存）上极易 OOM（内存溢出）。Capsa 在 `retrieval.py` 中实现了一套高效的**纯内存二字组分词与打分系统**：

- **二字组切分（Bigram）**：将中文文本按连续两个字符切分，例如「学习笔记」切分为「学习」「习笔」「笔记」。无需词典依赖，对中英文混合场景召回率极高。
- **权重分层打分机制**：
  - 命中标题关键词：$+5$ 分
  - 命中摘要关键词：$+3$ 分
  - 命中标签：$+4$ 分
  - 命中正文：$+1$ 分
  - 置顶加权（`pinned`）：$+3$ 分
  - 过期复核降权：$-2$ 分
- **硬过滤与排序保障**：只有真正命中查询词元的条目才会出现在结果中，零命中条目直接剔除，确保 Agent 看到的都是高度相关的内容。

---

### 3.4 严格的三态授权防线

在私有部署多 Agent 场景下，一个 Agent 可能只负责工作项目（持有 `proj: rw`），不能读取私人生活笔记（`life` 分组）。

Capsa 在数据访问层（`dal.py`）确立了严格的**三态防线**：

<table style="width: 100%; border-collapse: collapse; font-size: 12px; margin: 16px 0;">
  <thead>
    <tr style="background-color: #f1f5f9; text-align: left;">
      <th style="padding: 10px; border: 1px solid #cbd5e1;">判定状态</th>
      <th style="padding: 10px; border: 1px solid #cbd5e1;">含义与触发条件</th>
      <th style="padding: 10px; border: 1px solid #cbd5e1;">系统的安全防御行为</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="padding: 10px; border: 1px solid #cbd5e1; font-weight: 600; color: #059669;">authorized</td>
      <td style="padding: 10px; border: 1px solid #cbd5e1;">条目存在，且当前 Key 具备对应分组权限</td>
      <td style="padding: 10px; border: 1px solid #cbd5e1;">正常返回记忆内容</td>
    </tr>
    <tr>
      <td style="padding: 10px; border: 1px solid #cbd5e1; font-weight: 600; color: #dc2626;">forbidden</td>
      <td style="padding: 10px; border: 1px solid #cbd5e1;">条目存在，但当前 Key 无权访问所在分组</td>
      <td style="padding: 10px; border: 1px solid #cbd5e1;"><b>绝不泄露分组名与标题</b>！仅返回 <code>status="forbidden"</code> 与 ID，调用层对外呈现与 404 无异</td>
    </tr>
    <tr>
      <td style="padding: 10px; border: 1px solid #cbd5e1; font-weight: 600; color: #64748b;">not_found</td>
      <td style="padding: 10px; border: 1px solid #cbd5e1;">数据库中根本不存在该 ID 或已被软删除</td>
      <td style="padding: 10px; border: 1px solid #cbd5e1;">返回不存在</td>
    </tr>
  </tbody>
</table>

> **给 Coding 爱好者的批注**：  
> 这在安全领域叫「侧信道防泄露」。如果一个没权限访问的人请求了某一资源，系统告诉他「无权访问分组 XXX」，攻击者就能通过枚举 ID 探知系统中有哪些私密分组和条目存在。Capsa 从底层根绝了这种可能。

---

## 4. 数据表结构设计与说明

Capsa 的数据库极度简洁，仅由 3 张表构成，定义于 `capsa/db.py`：

<div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin: 16px 0; font-family: sans-serif;">
  
  <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px;">
    <div style="font-weight: 600; font-size: 13px; color: #0f172a; border-bottom: 2px solid #3b82f6; padding-bottom: 6px; margin-bottom: 8px;">groups (分组表)</div>
    <div style="font-size: 11px; color: #475569; line-height: 1.6;">
      • <b>slug</b> (主键，如 proj / study)<br/>
      • <b>name</b> (中文名称)<br/>
      • <b>description</b> (分组说明)<br/>
      • <b>created_at</b> (创建时间)
    </div>
  </div>

  <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px;">
    <div style="font-weight: 600; font-size: 13px; color: #0f172a; border-bottom: 2px solid #10b981; padding-bottom: 6px; margin-bottom: 8px;">api_keys (鉴权令牌表)</div>
    <div style="font-size: 11px; color: #475569; line-height: 1.6;">
      • <b>key_id</b> (主键，8 位唯一标识)<br/>
      • <b>token_hash</b> (sha256 密文散列)<br/>
      • <b>name</b> (密钥用途描述)<br/>
      • <b>scopes_json</b> (权限字典)<br/>
      • <b>revoked_at</b> (撤销时间标记)
    </div>
  </div>

  <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px;">
    <div style="font-weight: 600; font-size: 13px; color: #0f172a; border-bottom: 2px solid #8b5cf6; padding-bottom: 6px; margin-bottom: 8px;">memories (核心记忆表)</div>
    <div style="font-size: 11px; color: #475569; line-height: 1.6;">
      • <b>id</b> (主键，mem_ 开头)<br/>
      • <b>group_slug</b> (所属分组外键)<br/>
      • <b>title, summary, body</b><br/>
      • <b>tags_json</b> (标签数组)<br/>
      • <b>pinned</b> (置顶标记)<br/>
      • <b>review_at</b> (复核过期时间)<br/>
      • <b>deleted_at, deleted_reason</b>
    </div>
  </div>

</div>

---

## 5. 当前代码资产与文件清单

整个 Capsa 核心层代码高度精简，总代码量仅约 1,200 行 Python，没有任何冗余抽象：

| 模块文件 | 代码行数 | 主要职责说明 |
|:---|:---|:---|
| `capsa/server.py` | 36 行 | 系统总入口，装配 1MB 请求体限制中间件，挂载 `/healthz` 与 `/mcp` |
| `capsa/mcp_service.py` | 236 行 | 注册 7 个对外暴露的标准 MCP 工具，处理参数校验与报错契约 |
| `capsa/dal.py` | 258 行 | 数据访问层（唯一写 SQL 的模块），实现分组统计、三态批量查询、CRUD |
| `capsa/retrieval.py` | 157 行 | 纯算法模块：中文二字组分词、相关度排序、标题相似度计算、时间规范化 |
| `capsa/formatters.py` | 126 行 | 文本渲染格式化：输出规范的纯文本回复，控制响应体积截断 |
| `capsa/auth.py` | 36 行 | 鉴权逻辑：从 HTTP Header 提取 Bearer Token，比对 SHA256 哈希 |
| `capsa/db.py` | 84 行 | SQLite 连接管理、WAL 模式配置、幂等数据表与索引初始化 |
| `capsa/cli.py` | 183 行 | 管理员运维 CLI：初始化、Key 签发与撤销、分组管理、回收站恢复 |
| `capsa/ids.py` | 30 行 | 唯一 ID 与安全随机 Token 生成器（统一前缀契约） |

---

## 6. 后续演进路线（Phase 3 展望）

当前 Phase 2 已将服务核心能力（读、写、搜、删、查重、软删除恢复）全部夯实闭环。根据规划，后续的 **Phase 3** 将专注于工程化交付与生产就绪：

1. **可视化 Web 管理台**：引入基于现代轻量前端的 Web 界面，让用户在浏览器中直观地浏览、搜索、编辑记忆，查看各分组条目统计。
2. **生产容器化交付**：输出生产级 `Dockerfile` 与 `docker-compose.yml`，支持一键在个人 VPS 部署运行。
3. **在线热备能力**：基于 SQLite Online Backup API 提供定时/按需无锁数据备份，确保个人资产万无一失。
