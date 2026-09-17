# Tasks：管理页面增强（分类删除与 Key 深度管理及签发）

**关联 Plan**：Plan.md —— 管理页面增强 v1.1  
**总计 Task**：14 个

---

## Phase 1：存储层与 CLI 分类删除与 Key 生命周期扩展

### TASK-001：在 capsa/dal.py 中实现原子化分类删除函数

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：无
- **Description**：在 capsa/dal.py 中新增 delete_empty_group 函数，原子执行存在性判断、关联记忆校验与记录删除。
- **Details**：
  - delete_empty_group(conn: sqlite3.Connection, slug: str) -> str：在同一连接/事务内依次处理：
    1. 查询 groups 表中是否存在该 slug，若不存在直接返回 "not_found"；
    2. 查询 SELECT COUNT(*) FROM memories WHERE group_slug = ?，无论 deleted_at 是否为 NULL，若 count > 0 返回 "has_memories"；
    3. 执行 DELETE FROM groups WHERE slug = ?，提交事务，返回 "deleted"。
- **Acceptance Criteria**：
  - 单元测试验证：针对不存在分组调用返回 "not_found"。
  - 单元测试验证：针对含记忆分组（无论活跃或回收站）调用返回 "has_memories"，且 groups 表未被删除。
  - 单元测试验证：针对无记忆空分组调用返回 "deleted"，且 groups 表中该记录被彻底移除。

### TASK-002：在 capsa/dal.py 中实现 Key 状态吊销与原子物理删除函数

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：无
- **Description**：在 capsa/dal.py 中演进 revoke_key 返回三态状态码，并新增 delete_revoked_key 原子物理删除函数，不破坏 get_key 原有契约。
- **Details**：
  - 重构 revoke_key(conn: sqlite3.Connection, key_id: str) -> str：
    1. 查询 keys 表中该 id 的 revoked_at，若无记录返回 "not_found"；
    2. 若 revoked_at 已非空，返回 "already_revoked"；
    3. 否则 UPDATE keys SET revoked_at = ? WHERE id = ? 并提交，返回 "revoked"。
  - 新增 delete_revoked_key(conn: sqlite3.Connection, key_id: str) -> str：
    1. 查询 keys 表中该 id 的 revoked_at，若无记录返回 "not_found"；
    2. 若 revoked_at 为 NULL（仍处于有效状态），拒绝物理删除并返回 "still_active"；
    3. 否则执行 DELETE FROM keys WHERE id = ? 并提交，返回 "deleted"。
  - 明确要求：不修改 get_key() 返回的字典结构，保持原有字段及既有测试完全兼容。
- **Acceptance Criteria**：
  - 单元测试验证：revoke_key 对不存在 Key 返回 "not_found"，对有效 Key 成功吊销返回 "revoked"，对重复吊销返回 "already_revoked"。
  - 单元测试验证：delete_revoked_key 对有效 Key 拒绝删除返回 "still_active"，对已吊销 Key 成功物理删除返回 "deleted"，对不存在 Key 返回 "not_found"。
  - 既有 get_key 测试 test_get_key_round_trips_scopes 保持绿灯通过。

### TASK-003：在 capsa/cli.py 中新增 group delete 子命令

- **Status**：DONE
- **Priority**：P1
- **Dependencies**：TASK-001
- **Description**：在 capsa/cli.py 中新增 cmd_group_delete 处理函数并在 argparse 中注册 capsa group delete 子命令。
- **Details**：
  - cmd_group_delete(args: argparse.Namespace) -> int：
    - 连接数据库并初始化 Schema；
    - 调用 dal.delete_empty_group(conn, args.slug)；
    - 若返回 "not_found"，输出“未找到分组：[slug]”到 stderr 并返回 1；
    - 若返回 "has_memories"，输出“分组 [slug] 下仍有记忆（含回收站），无法删除”到 stderr 并返回 1；
    - 若返回 "deleted"，输出“已删除分组：[slug]”到 stdout 并返回 0。
  - 在 group_commands 子解析器中新增 delete 命令，接收位置参数 slug。
- **Acceptance Criteria**：
  - CLI 测试验证：删除空分组返回 0 并打印“已删除分组：[slug]”。
  - CLI 测试验证：删除含活跃或回收站记忆的分组返回 1 并打印阻断提示。
  - CLI 测试验证：删除不存在的分组返回 1 并打印未找到提示。

---

## Phase 2：Web RESTful API 端点交付与安全守卫

### TASK-004：在 capsa/web_api.py 中实现分类删除端点 DELETE /api/groups/{slug}

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-001
- **Description**：在 capsa/web_api.py 中新增 group_delete 处理器并挂载 DELETE /api/groups/{slug} 路由。
- **Details**：
  - 从 request.path_params 中提取 slug；
  - 调用 dal.delete_empty_group(conn, slug)；
  - 若为 "not_found"，返回 _fail(NOT_FOUND, "分组 [slug] 不存在", 404)；
  - 若为 "has_memories"，抛出 ToolError("分类 [slug] 下仍有记忆（含回收站），禁止删除")；
  - 若为 "deleted"，返回 _ok({"slug": slug, "action": "deleted"})；
  - 在 routes 列表中添加 Route("/groups/{slug}", endpoint=group_delete, methods=["DELETE"])。
- **Acceptance Criteria**：
  - API 测试：管理员删除无记忆分类返回 200 与 action="deleted"。
  - API 测试：删除不存在分类返回 404 与 NOT_FOUND。
  - API 测试：删除仍有活跃或软删除记忆的分类返回 422 与 VALIDATION_ERROR。
  - API 测试：非管理员凭据被网关拦截返回 403。

### TASK-005：在 capsa/web_api.py 中实现 Key 列表与签发端点

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-002
- **Description**：在 capsa/web_api.py 中实现 GET /api/keys 与 POST /api/keys 端点，明确虚拟凭据边界。
- **Details**：
  - key_list(request: Request) -> JSONResponse：调用 dal.list_keys(conn)，返回统一信封 _ok({"items": items, "total": len(items), "offset": 0, "limit": len(items)})。明确 CAPSA_ADMIN_TOKEN 虚拟身份不落库，不在此列表中。
  - key_create(request: Request) -> JSONResponse：
    - 解析 JSON 请求体，提取 name 与 scopes；
    - 校验 name：使用 require_text(name, 60, "Key 名称")；
    - 校验 scopes：必须为 dict 且非空，每个键必须为 "*" 或存在于 groups 表中的真实 slug，每个值必须为 "r" 或 "rw"；若校验失败抛出 ToolError；
    - 调用 issue_key() 生成 key_id 与 plain_token；
    - 调用 dal.create_key(conn, key_id, name, hash_token(plain_token), scopes)；
    - 返回 201 状态：_ok({"id": key_id, "name": name, "token": plain_token, "scopes": scopes, "created_at": utcnow()}, status=201)。
  - 注册路由：Route("/keys", endpoint=key_list, methods=["GET"]) 与 Route("/keys", endpoint=key_create, methods=["POST"])。
- **Acceptance Criteria**：
  - API 测试：GET /api/keys 正确列出数据库内全部 Key，不混入虚拟环境变量凭据。
  - API 测试：POST /api/keys 创建成功返回包含明文 token 的数据对象，HTTP 状态码为 201。
  - API 测试：POST /api/keys 传入非法名称、空 scopes、无效 group_slug 或非法权限值返回 422。
  - API 测试：非管理员调用返回 403。

### TASK-006：在 capsa/web_api.py 中实现 Key 吊销与物理删除端点（含自锁与虚拟凭据防护）

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-002, TASK-005
- **Description**：在 capsa/web_api.py 中实现 POST /api/keys/{id}/revoke 与 DELETE /api/keys/{id} 端点，统一自锁防范与环境变量虚拟凭据拦截。
- **Details**：
  - 通用保护守卫：对比 request.user.access_token.claims.get("key_id") 与目标 target_id，若相同则抛出 ToolError("禁止对当前正在使用的管理凭据执行吊销或删除操作")；若 target_id == ADMIN_KEY_ID ("admin")，抛出 ToolError("环境变量管理员凭据不受管理接口支持，请通过环境变量变更或重启服务完成轮换")。
  - key_revoke(request: Request) -> JSONResponse：
    - 提取 path_params["id"]，执行通用保护守卫；
    - 调用 dal.revoke_key(conn, target_id)；
    - 若为 "not_found"，返回 _fail(NOT_FOUND, "Key [id] 不存在", 404)；
    - 若为 "already_revoked"，抛出 ToolError("Key [id] 已经处于吊销状态")；
    - 若为 "revoked"，返回 _ok({"id": target_id, "action": "revoked"})。
  - key_delete(request: Request) -> JSONResponse：
    - 提取 path_params["id"]，执行通用保护守卫；
    - 调用 dal.delete_revoked_key(conn, target_id)；
    - 若为 "not_found"，返回 _fail(NOT_FOUND, "Key [id] 不存在", 404)；
    - 若为 "still_active"，抛出 ToolError("Key [id] 仍处于有效状态，请先吊销后再删除")；
    - 若为 "deleted"，返回 _ok({"id": target_id, "action": "deleted"})。
  - 注册路由：Route("/keys/{id}/revoke", endpoint=key_revoke, methods=["POST"]) 与 Route("/keys/{id}", endpoint=key_delete, methods=["DELETE"])。
- **Acceptance Criteria**：
  - API 测试：成功吊销指定 Key，再次使用该 Key 发起请求被拒绝为 401。
  - API 测试：尝试吊销自身当前请求凭据返回 422 并提示禁止自吊销；尝试操作 admin 虚拟凭据返回 422。
  - API 测试：重复吊销已吊销 Key 返回 422。
  - API 测试：物理删除已吊销 Key 返回 200，记录彻底从 keys 表移除。
  - API 测试：物理删除未吊销 Key 返回 422 并提示先吊销。
  - API 测试：尝试删除自身当前请求凭据返回 422。

---

## Phase 3：前端 API 契约与分类删除交互增强

### TASK-007：在 web/src/types.ts 与 web/src/api.ts 中补齐分类删除与 Key 管理契约

- **Status**：DONE
- **Priority**：P1
- **Dependencies**：TASK-004, TASK-006
- **Description**：在 web/src/types.ts 中定义 Key 相关数据类型，并在 web/src/api.ts 中封装对应 REST 客户端方法。
- **Details**：
  - 在 web/src/types.ts 中新增接口：
    - KeyRecord：包含 id: string, name: string, scopes: Record<string, Permission>, created_at: string, last_used_at: string | null, revoked_at: string | null。
    - CreateKeyInput：包含 name: string, scopes: Record<string, Permission>。
    - CreatedKeyResult：包含 id: string, name: string, token: string, scopes: Record<string, Permission>, created_at: string。
  - 在 web/src/api.ts 中扩展 api 对象：
    - deleteGroup: (slug: string) => request<{ slug: string; action: string }>(`/api/groups/${slug}`, { method: 'DELETE' })
    - keys: () => request<ListData<KeyRecord>>("/api/keys")
    - createKey: (payload: CreateKeyInput) => request<CreatedKeyResult>("/api/keys", { method: "POST", body: JSON.stringify(payload) })
    - revokeKey: (id: string) => request<{ id: string; action: string }>(`/api/keys/${id}/revoke`, { method: 'POST' })
    - deleteKey: (id: string) => request<{ id: string; action: string }>(`/api/keys/${id}`, { method: 'DELETE' })
- **Acceptance Criteria**：
  - TypeScript 类型检查通过（npm run build 无类型错误）。
  - 接口调用能正确解包统一信封与映射 ApiError。

### TASK-008：在 web/src/components/GroupManager.tsx 中增加分类删除交互与二次确认

- **Status**：DONE
- **Priority**：P1
- **Dependencies**：TASK-007
- **Description**：在 GroupManager.tsx 的分类卡片中新增删除按钮，提供防误触模态框与错误信息展示。
- **Details**：
  - 引入 Trash2 图标；
  - 每个分类卡片操作区添加“删除”按钮；
  - 维护 deletingGroup 状态，点击删除时打开轻量二次确认模态弹层：
    - 展示确认文本：“确认删除分类「{name}」({slug}) 吗？此操作不可撤销。”；
    - 提供“取消”与“确认删除”按钮；
    - 执行 api.deleteGroup(slug)，调用期间按钮处于 busy 状态；
    - 若捕获异常（如该分类下仍有记忆），在模态框内展示错误文字；
    - 删除成功后调用 onGroupsChange() 刷新列表，关闭确认弹层。
- **Acceptance Criteria**：
  - 点击删除弹出轻量确认框；
  - 空分类确认删除后成功从界面移除；
  - 含记忆分类确认删除后模态框展示阻断原因且不关闭；
  - 取消按钮可安全关闭弹层。

---

## Phase 4：前端 Key 深度管理视图与签发披露交互

### TASK-009：开发 web/src/components/KeyManager.tsx 凭据管理组件（列表与状态）

- **Status**：DONE
- **Priority**：P1
- **Dependencies**：TASK-007
- **Description**：新建 web/src/components/KeyManager.tsx，支持查看全部 Key 的状态、最后活跃时间与细粒度权限分布，并支持吊销与删除操作。
- **Details**：
  - 组件接收 groups: GroupInfo[] 与 currentKeyId: string；
  - 加载并展示 api.keys() 数据列表；
  - 列表卡片展示：
    - Key 名称、ID（等宽字体）；
    - 状态标签：若 revoked_at 为空展示绿色“有效”，否则展示灰色“已吊销 (时间)”；
    - 当前凭据高亮标注：若 key.id === currentKeyId 显示蓝色“当前凭据”徽标；
    - 时间信息：创建时间、最后使用时间（若为 null 显示“从未调用”）；
    - 授权明细：解析 scopes，若为 {"*": "rw"} 显示“全库读写”，若为 {"*": "r"} 显示“全库只读”，否则逐个列出分组标签及权限等级（如 proj: 读写, study: 只读）；
  - 操作按钮：
    - 对非当前且有效的 Key 提供“吊销”按钮，点击弹出轻量确认框调用 api.revokeKey(key.id)；
    - 对非当前且已吊销的 Key 提供“删除”按钮，点击弹出轻量确认框调用 api.deleteKey(key.id)；
    - 对当前凭据禁用上述破坏性操作。
- **Acceptance Criteria**：
  - 正确渲染 Key 列表及状态；
  - 吊销与删除操作成功后列表自动刷新；
  - 当前登录凭据无法被吊销或删除。

### TASK-010：在 KeyManager.tsx 中实现 Key 签发（含空 Scope 校验）与单次明文安全披露

- **Status**：DONE
- **Priority**：P1
- **Dependencies**：TASK-009
- **Description**：在 KeyManager.tsx 中添加“签发 Key”对话框（含自定义空权限前端阻断）与签发成功后的“单次明文安全披露”对话框（保持轻量克制）。
- **Details**：
  - 头部提供“签发 Key”按钮（Plus 图标）；
  - 签发弹层包含：
    - Key 名称输入框（校验非空、长度上限 60）；
    - 权限模式单选：
      1. 全库读写（scopes: {"*": "rw"}）
      2. 全库只读（scopes: {"*": "r"}）
      3. 自定义分组权限：渲染 groups 列表，每一行包含分类名、slug 与权限单选/下拉组（无权限、只读 r、读写 rw）；
    - 表单校验阻断：自定义模式下若所有分组均选“无权限”，在弹窗内行内提示“请至少为一个分组授予权限”，并禁用“签发”按钮；
    - 提交调用 api.createKey({ name, scopes })；
  - 签发成功披露弹层（保持轻量克制，不搞页面卸载拦截或剪贴板监控）：
    - 醒目警示框：“明文令牌仅在本次创建后展示一次，服务端仅保存哈希，关闭后无法找回，请立即复制保存。”；
    - 明文令牌展示区域（等宽字体背景填充）；
    - “复制令牌”按钮（使用 navigator.clipboard.writeText），复制后反馈“已复制”；
    - “我已保存并关闭”单一明确确认按钮，关闭后刷新列表并清空内存中的明文令牌。
- **Acceptance Criteria**：
  - 自定义分组权限模式全选“无权限”时禁用签发并显示行内提示；
  - 正常配置权限后成功签发，弹出独立披露窗口并可成功复制完整明文令牌；
  - 点击“我已保存并关闭”后窗口正常关闭，页面不再残留明文令牌，列表中呈现新 Key 记录。

### TASK-011：在 web/src/App.tsx 中集成凭据管理视图与导航

- **Status**：DONE
- **Priority**：P1
- **Dependencies**：TASK-009, TASK-010
- **Description**：在 App.tsx 中注册“凭据管理”导航项，并装配 KeyManager 组件。
- **Details**：
  - 在 VIEWS 常量数组中添加 { id: "keys", label: "凭据管理" }；
  - 更新 View 类型支持 "keys"；
  - 在主视图条件渲染中挂载：view === 'keys' && <KeyManager groups={groups} currentKeyId={info.key_id} />；
  - 保证切换视图时不会丢失用户上下文。
- **Acceptance Criteria**：
  - 顶部导航可见“凭据管理”Tab；
  - 点击可正常切换至凭据管理视图，且能与其他视图自由往返。

---

## Phase 5：全栈测试验证与文档对齐

### TASK-012：在 tests/test_web_api.py 中补齐分类删除与 Key 生命周期全量测试

- **Status**：DONE
- **Priority**：P0
- **Dependencies**：TASK-004, TASK-006
- **Description**：编写 pytest 测试用例，全面覆盖原子分类删除、Key 状态机约束、虚拟凭据自锁边界与悬空 scope 预期行为。
- **Details**：
  - test_delete_empty_group_succeeds：测试删除无记忆的分类成功，返回 200 与 deleted；
  - test_delete_missing_group_returns_404：测试删除不存在分类返回 404 NOT_FOUND；
  - test_delete_group_with_active_memories_returns_422：测试删除包含活跃记忆分类返回 422 VALIDATION_ERROR；
  - test_delete_group_with_soft_deleted_memories_returns_422：测试删除仅含回收站记忆的分类同样返回 422；
  - test_key_create_and_list_lifecycle：测试创建 Key 返回明文令牌、列表可见且不含环境变量虚拟管理员、哈希存储正确；
  - test_key_create_rejects_empty_or_invalid_scopes：测试空 scopes 或包含不存在分组时返回 422；
  - test_key_revoke_and_delete_lifecycle：测试吊销 Key 后令牌失效、物理删除已吊销 Key 成功；
  - test_key_delete_requires_prior_revocation：测试物理删除有效 Key 返回 422；
  - test_key_operations_prevent_self_lock_and_virtual_admin：测试试图吊销/删除当前管理员自身 Key 或虚拟 admin 目标均返回 422 并阻断；
  - test_orphaned_scope_behavior_on_group_delete：测试分类删除后已有 Key 上的 scope 保持原样、重建同名分类后重新获得有效权限；
  - test_non_admin_token_rejected_on_all_new_endpoints：测试非 *:rw 凭据调用所有新增端点均被 403 拦截。
- **Acceptance Criteria**：
  - tests/test_web_api.py 新增用例全部 PASSED；
  - 整个测试套件 .venv/bin/python -m pytest 全绿无回归。

### TASK-013：在 web/tests/e2e.spec.ts 中编写端到端浏览器测试用例

- **Status**：DONE
- **Priority**：P1
- **Dependencies**：TASK-008, TASK-011
- **Description**：使用 Playwright 编写端到端测试，覆盖分类删除与 Key 签发/吊销/删除全流程。
- **Details**：
  - test('分类管理：新建分类、阻断含记忆删除、清理后成功删除')：
    - 在分类管理中新建空分类 test-temp；
    - 在工作台往该分类添加记忆，返回分类管理点击删除，断言出现阻断报错；
    - 回收站清理该记忆后再次删除分类，断言卡片成功消失。
  - test('凭据管理：签发分组 Key、查看权限明细、吊销与物理删除')：
    - 进入“凭据管理”视图；
    - 点击“签发 Key”，测试全选“无权限”时按钮禁用；配置有效权限并提交；
    - 验证弹出明文展示模态框，包含一键复制与提示文字；
    - 点击关闭后在列表中核对该 Key 存在且状态为“有效”；
    - 点击“吊销”并确认，状态变更为“已吊销”；
    - 点击“删除”并确认，该 Key 彻底从列表中移除。
- **Acceptance Criteria**：
  - cd web && npm run test:e2e 全部通过。

### TASK-014：同步维护项目事实来源文档与说明文件

- **Status**：DONE
- **Priority**：P1
- **Dependencies**：TASK-012, TASK-013
- **Description**：对照 Project.md §0 规则更新各章节，并同步更新根目录 README.md 消除过期描述。
- **Details**：
  - .docs/Project.md：
    - §1 概述：更新非目标描述，澄清“分类删除与 Key 签发/吊销/删除已纳入 Web 管理台”；
    - §3 目录结构：记录新增的 web/src/components/KeyManager.tsx；
    - §4 架构与数据流：记录 Web 端 Key 签发、吊销、删除数据流与管理员自锁保护网关策略；
    - §8 决策记录：追加“分类删除原子化契约”、“delete_revoked_key 状态下沉”、“环境变量虚拟凭据边界”与“悬空 scope 预期语义”记录；
  - README.md：更新关于 Web 管理台能力与“Key 签发与撤销仅保留在 CLI”的历史陈旧描述，保持对齐。
- **Acceptance Criteria**：
  - Project.md 与 README.md 完整准确，与本次改动完全一致，无遗留过期边界描述。