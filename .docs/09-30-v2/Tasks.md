# Tasks：审阅意见批判性吸收与边界加固 (09-30-v2)

**关联 Plan**：`Plan.md` —— 审阅意见批判性吸收与边界加固 (09-30-v2)  
**总计 Task**：3 个

---

## Phase 1：代码重构与边界加固

### TASK-001：优化 `capsa/auth.py` 中的中间件实现

- **Status**：DONE
- **Description**：在 [capsa/auth.py](file:///home/dev/projects/MiniProject/Capsa/capsa/auth.py) 中，移除 `parse_qs` 外层的不可达 `try/except` 分支，并在 token 校验中增加 `isprintable()` 判定以过滤控制字符。
- **Details**：
  - 移除 `try...except Exception` 结构，将 `parse_qs` 直接下沉至主干执行。
  - 将判定条件加固为 `if not raw_token or not raw_token.isascii() or not raw_token.isprintable():`，防止包含 `\r`、`\n` 等不可见控制字符的畸形参数进入下游请求头。
- **Acceptance Criteria**：
  - 代码精炼克制，无不可达冗余分支。
  - 携带控制字符（如 CRLF）的 token 参数不再被注入为 Header。

---

## Phase 2：自动化测试覆盖与全量回归

### TASK-002：补充控制字符测试用例并执行全量测试

- **Status**：DONE
- **Description**：在 [tests/test_auth_query.py](file:///home/dev/projects/MiniProject/Capsa/tests/test_auth_query.py) 补充 CRLF 控制字符用例，并运行全量回归测试。
- **Details**：
  - 在 `test_boundary_and_invalid_query_tokens` 中追加针对 `%0d%0a`（CRLF）与包含控制字符的 token 测试断言（预期 401）。
  - 执行 `.venv/bin/python -m pytest -v`，确保全量测试 100% PASSED。
- **Acceptance Criteria**：
  - 新增控制字符用例测试通过。
  - 原有 215 项用例无任何回归。

---

## Phase 3：系统架构文档维护与归档

### TASK-003：同步维护 `Project.md` 架构文档与决策记录

- **Status**：DONE
- **Description**：更新 [.docs/Project.md](file:///home/dev/projects/MiniProject/Capsa/.docs/Project.md)，对齐控制字符过滤约定与过度设计防御剔除的决策记录。
- **Details**：
  - 更新 §5 关键约定：明确指出空参数、纯空白字符、非 ASCII 或不可打印控制字符（如 CRLF）均不予注入。
  - 更新 §8 决策记录：记录本次审阅吸收决策（剔除不可达 `try/except`，增加 `isprintable()` 守卫）。
- **Acceptance Criteria**：
  - `Project.md` 各章节与实际代码实现保持一致。
