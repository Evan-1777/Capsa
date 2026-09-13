> **参考示例**：以下内容为 Tasks.md 的填写范例，实际使用时请替换为真实项目信息。
>
> ---
>
> ## Task 与 Plan 的边界（重申）
>
> - **Plan 不涉及具体文件、函数签名、代码片段。这些全部归属于 Task。**
> - 每个 Task 必须可独立验证——执行完一个 Task 后，代码应处于可编译/可运行状态。
> - 禁止模糊动词（如"优化""完善""改进"），须用可验证动作描述（如"添加校验""重构为函数""提取接口"）。
> - Quick 模式：单 Task 修改不超过 3 个文件，禁止跨模块大重构。

---

# Tasks：用户认证模块

**关联 Plan**：`Plan.md` —— 用户认证模块 v1.0  
**总计 Task**：13 个

---

## Phase 1：数据库设计与用户表迁移

### TASK-001：创建 users/roles/permissions 建表迁移脚本

- **Status**：DONE
- **Description**：在 `migrations/` 目录下新增 `001_create_users.up.sql` 和 `001_create_users.down.sql`，定义三张表的完整 schema 与索引。
- **Details**：
  - `users` 表：id (UUID PK)、username (UNIQUE)、password_hash、email (UNIQUE)、created_at、updated_at
  - `roles` 表：id (UUID PK)、name (UNIQUE)、description
  - `permissions` 表：id (UUID PK)、name (UNIQUE)、description
  - 添加 `user_roles` 关联表：user_id + role_id 联合主键
  - 对 username、email 建立唯一索引
- **Acceptance Criteria**：
  - `up.sql` 可成功执行
  - `down.sql` 可完整回滚
  - 字段类型与约束符合规范

### TASK-002：插入初始角色与权限数据

- **Status**：DONE
- **Description**：在 `seeds/` 目录下新增 `seed_roles.sql`，预置管理员、编辑者、查看者三种角色及对应权限。
- **Details**：
  - 管理员：全部权限
  - 编辑者：读 + 写权限
  - 查看者：只读权限
  - 使用 `ON CONFLICT DO NOTHING` 确保幂等
- **Acceptance Criteria**：
  - 脚本可重复执行不报错
  - 运行后三张表各有预期行数

### TASK-003：编写回滚验证脚本

- **Status**：DONE
- **Description**：在 `scripts/` 下新增 `verify_migration.sh`，依次执行 up → seed → down → up，验证迁移的幂等性与可回滚性。
- **Details**：
  - 脚本使用本地开发数据库连接
  - 每步执行后检查退出码
- **Acceptance Criteria**：
  - 脚本在干净数据库上跑通
  - 最终状态与初始迁移一致

---

## Phase 2：登录 / 注册 API 实现

### TASK-004：实现注册端点 POST /auth/register

- **Status**：DONE
- **Description**：在 `src/routes/auth.ts` 中新增 `register` 处理函数，接收 username/email/password，写入 users 表。
- **Details**：
  - 校验 email 格式、password 最小长度 8 位
  - email/username 唯一性检查，重复返回 409
  - 密码使用 bcrypt 哈希后存储
  - 成功返回 201 + 用户基本信息（不含密码）
- **Acceptance Criteria**：
  - 合法输入 → 201 + 用户 JSON
  - 重复 email → 409
  - 无效 email → 422
  - 密码 < 8 位 → 422

### TASK-005：实现登录端点 POST /auth/login

- **Status**：DONE
- **Description**：在 `src/routes/auth.ts` 中新增 `login` 处理函数，验证凭据并签发 JWT。
- **Details**：
  - 接收 email + password
  - 查询 users 表，bcrypt 比对密码
  - 签发 RS256 JWT，payload 含 sub、role、iat、exp
  - 有效期 2 小时
- **Acceptance Criteria**：
  - 正确凭据 → 200 + access_token
  - 错误密码 → 401
  - 不存在用户 → 401（不区分具体原因）

### TASK-006：添加请求参数校验中间件

- **Status**：PENDING
- **Description**：在 `src/middleware/validate.ts` 中实现通用请求体校验，为 auth 路由接入。
- **Details**：
  - 基于 JSON Schema 或 zod 定义校验规则
  - 校验失败返回 422 + 字段级错误详情
  - 注册和登录端点均接入
- **Acceptance Criteria**：
  - 缺失必填字段 → 422 + 字段路径
  - 类型错误 → 422 + 期望类型
  - 合法输入不受影响

### TASK-007：定义错误码映射与统一错误响应

- **Status**：PENDING
- **Description**：在 `src/errors.ts` 中定义错误码枚举与标准响应格式 `{ code, message, details? }`。
- **Details**：
  - 覆盖 400/401/403/404/409/422/500
  - 每个错误码附带英文 message
  - 全局错误处理中间件捕获未处理异常
- **Acceptance Criteria**：
  - 所有 API 错误响应格式一致
  - 未处理异常返回 500 + 通用消息（不泄露堆栈）

---

## Phase 3：JWT 中间件与 RBAC 鉴权

### TASK-008：实现 AuthMiddleware

- **Status**：PENDING
- **Description**：在 `src/middleware/auth.ts` 中实现 JWT 验证中间件，从 Authorization header 提取令牌并解析。
- **Details**：
  - 解析 Bearer token
  - 使用 RS256 公钥验证签名
  - 检查 exp 过期
  - 解析成功后将用户信息挂载到 request context
- **Acceptance Criteria**：
  - 无 Authorization header → 401
  - 格式非 Bearer → 401
  - 过期令牌 → 401
  - 有效令牌 → 放行并注入 user context

### TASK-009：实现 RequireRole 装饰器/中间件

- **Status**：PENDING
- **Description**：在 `src/middleware/auth.ts` 中实现角色校验函数，接收允许的角色列表，拒绝无权限用户。
- **Details**：
  - 支持单角色和多角色（满足任一即可）
  - 从 request context 读取用户角色
  - 不匹配返回 403
- **Acceptance Criteria**：
  - 角色匹配 → 放行
  - 角色不匹配 → 403
  - 无认证信息 → 401（非 403）

### TASK-010：实现 Token 刷新端点 POST /auth/refresh

- **Status**：PENDING
- **Description**：在 `src/routes/auth.ts` 中新增 `refresh` 处理函数，接收 refresh_token，签发新 access_token。
- **Details**：
  - refresh_token 存储在 Redis，key 格式 `refresh:<user_id>`
  - 验证 refresh_token 有效性后签发新 access_token
  - 旧 refresh_token 单次使用后失效（rotation）
- **Acceptance Criteria**：
  - 有效 refresh_token → 200 + 新 access_token
  - 过期/无效 → 401
  - 重复使用 → 401 + 该用户全部 refresh_token 失效

---

## Phase 4：接口测试与文档更新

### TASK-011：编写注册/登录集成测试

- **Status**：PENDING
- **Description**：在 `tests/auth.test.ts` 中编写注册与登录端点的集成测试。
- **Details**：
  - 使用测试数据库，每个 case 后清理
  - 覆盖：正常注册、重复注册、格式校验、正常登录、错误密码、不存在的用户
- **Acceptance Criteria**：
  - 全部用例通过
  - 每个端点至少 3 个用例

### TASK-012：编写鉴权边界测试

- **Status**：PENDING
- **Description**：在 `tests/auth.test.ts` 中补充鉴权边界场景。
- **Details**：
  - 无令牌访问受保护路由 → 401
  - 低权限角色访问高权限路由 → 403
  - 过期令牌 → 401
  - 篡改令牌 → 401
  - 并发登录不互相踢出
- **Acceptance Criteria**：
  - 全部用例通过
  - 覆盖所有角色组合

### TASK-013：更新 API 文档

- **Status**：PENDING
- **Description**：在 `docs/api.md` 中补充认证相关端点说明，包含请求/响应示例与错误码。
- **Details**：
  - 每个端点列出 Method、Path、Headers、Body、Response
  - 标注认证要求
  - 错误码速查表
- **Acceptance Criteria**：
  - 文档与实际返回格式一致
  - 每个端点至少有请求示例和成功/失败响应示例
