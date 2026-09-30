# Tasks：兼容 URL 查询参数传递访问凭据

**关联 Plan**：`Plan.md` —— 兼容 URL 查询参数传递访问凭据 v1.1  
**总计 Task**：5 个

---

## Phase 1：URL 查询参数凭据适配中间件设计与装配

### TASK-001：在 `capsa/auth.py` 中实现 `QueryTokenAuthMiddleware`

- **Status**：DONE
- **Description**：在 [capsa/auth.py](file:///home/dev/projects/MiniProject/Capsa/capsa/auth.py) 中新增 ASGI 中间件 `QueryTokenAuthMiddleware`，从 URL 查询参数解析访问凭据并在缺少 Authorization 请求头时代客注入 Bearer 请求头。
- **Details**：
  - 判断 `scope["type"] == "http"`，非 HTTP 请求（如 lifespan、websocket）直接透传。
  - 检查 `scope["headers"]` 中是否已存在不区分大小写的 `authorization` 请求头；若已存在，直接透传当前 scope，保证请求头优先。
  - 若不存在 `authorization` 头，从 `scope.get("query_string", b"")` 使用 `urllib.parse.parse_qs` 解析参数字典。
  - 依次获取 `token` 与 `access_token` 参数，提取首个非空字符串；若参数不存在或仅含空白字符，直接透传。
  - 检查 `token.isascii()`：若包含非 ASCII 字符，不进行注入，直接透传让下游自然返回 401，避免在 `encode("latin-1")` 处抛出 `UnicodeEncodeError` 逃出中间件导致 500。
  - 若获取到有效 ASCII 凭据，生成浅拷贝 scope 并将 `(b"authorization", f"Bearer {token.strip()}".encode("latin-1"))` 追加至 `scope["headers"]`，向下游传递。
- **Acceptance Criteria**：
  - 纯标准库实现，零外部依赖引入。
  - 在不带 Authorization 头但带有有效 `?token=...` 或 `?access_token=...` 时，下游 ASGI 应用可正确在 `scope["headers"]` 观测到格式正确的 Bearer Authorization 请求头。
  - 请求已含 Authorization 头时，不篡改已有头部。
  - 带有非 ASCII 字符的 token 请求不抛出未处理异常，直接透传至下游。

### TASK-002：在 `capsa/server.py` 中装配 `QueryTokenAuthMiddleware`

- **Status**：DONE
- **Description**：在 [capsa/server.py](file:///home/dev/projects/MiniProject/Capsa/capsa/server.py) 中导入 `QueryTokenAuthMiddleware` 并挂载至根应用中间件流水线。
- **Details**：
  - 从 `capsa.auth` 导入 `QueryTokenAuthMiddleware`。
  - 在 `create_app()` 工厂函数中，通过 `application.add_middleware(QueryTokenAuthMiddleware)` 完成中间件全局装配。
  - 与现有 `RequestBodyLimitMiddleware` 共同构成统一 ASGI 守卫链路。
- **Acceptance Criteria**：
  - 根应用正常实例化，无模块循环导入与运行时错误。
  - 挂载后 `/healthz`、`/mcp`、`/api` 及静态文件路由均能正常穿透并处理请求。

---

## Phase 2：端到端自动化测试覆盖与协议兼容性验证

### TASK-003：编写 URL 查询参数鉴权自动化测试套件

- **Status**：DONE
- **Description**：新建 `tests/test_auth_query.py`，针对 MCP Streamable-HTTP 端点与 Web REST API 端点编写完整的 URL 查询参数鉴权测试。
- **Details**：
  - **MCP Streamable-HTTP 测试**：
    - `POST /mcp?token=<valid_token>` 发送 `initialize` 请求，断言返回 HTTP 200 及 `mcp-session-id`。
    - 携带 session ID 并在 URL 中保留 `?token=<valid_token>` 调用 `memory_groups` 工具，断言返回正确的受控分组数据。
    - 使用 `?access_token=<valid_token>` 验证 RFC 6750 兼容性。
  - **Web REST API 测试**：
    - `GET /api/groups?token=<admin_token>`，断言返回 HTTP 200 及统一信封结构。
    - `GET /api/auth/me?token=<admin_token>`，断言返回正确的凭据详情。
  - **鉴权优先级与冲突测试**：
    - Header 有效凭据 + Query 无效凭据：断言 HTTP 200 成功，验证 Header 优先。
    - Header 无效凭据 + Query 有效凭据：断言 HTTP 401 失败，验证 Header 存在时不降级使用 Query。
  - **异常与边界测试**：
    - `POST /mcp?token=invalid_token` 返回 HTTP 401。
    - `POST /mcp?token=非ASCII令牌` 返回 HTTP 401（验证不抛 500）。
    - `POST /mcp?token=` 与 `POST /mcp?token=   ` 返回 HTTP 401。
    - 缺省任何凭据的 `POST /mcp` 返回 HTTP 401。
- **Acceptance Criteria**：
  - 所有新增测试用例通过 `.venv/bin/python -m pytest tests/test_auth_query.py -v` 执行无误。
  - 覆盖正常鉴权、参数别名、优先级冲突与非 ASCII / 空值异常边界。

### TASK-004：执行全量测试套件并验证无回归

- **Status**：DONE
- **Description**：执行项目全量 pytest 测试套件，确保原有 209 项用例无任何回归。
- **Details**：
  - 运行 `.venv/bin/python -m pytest -v`。
  - 检查是否存在警告或断言失败。
- **Acceptance Criteria**：
  - 原有 209 项用例与新增测试用例 100% PASSED。

---

## Phase 3：系统架构文档维护与安全面披露

### TASK-005：同步维护 `Project.md` 架构文档与决策记录

- **Status**：DONE
- **Description**：更新 [.docs/Project.md](file:///home/dev/projects/MiniProject/Capsa/.docs/Project.md)，对齐数据流、安全面披露与技术决策。
- **Details**：
  - 更新 §4 架构与数据流：补充 URL 查询参数凭据透传机制（ASGI 中间件层无损映射至 Authorization 头）。
  - 更新 §5 关键约定：记录 URL 凭据约定（支持 `token` 与 `access_token`，Header 优先，空值与非 ASCII 字符过滤）。
  - 更新 §6 约束与已知坑：披露 URL 凭据固有安全代价（易落入反代访问日志与历史），给出反代日志脱敏建议，明确推荐为第三方连接器签发专用低权限分组 Key 而非通配管理员令牌。
  - 更新 §8 决策记录：
    - 新增 2026-09-30 兼容 URL 查询参数凭据决策及理由（以根因结构归位解决 Claude Web 接入断点，无需引入复杂 OAuth 2.0，零破坏现有鉴权逻辑）。
    - 明确记录根应用全局装配为有意决策（最短有效差分、模型对称，免去 URL 路径前缀特判分支，与现有守卫层正交）。
  - 附录增加部署后验证指导：记录生产环境部署后使用真实 Claude Web 自定义连接器配置 `https://<host>/mcp?token=...` 的联调步骤。
- **Acceptance Criteria**：
  - `Project.md` 各章节与实际代码实现保持 100% 一致。
