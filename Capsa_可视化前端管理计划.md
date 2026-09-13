# Capsa Studio 可视化前端管理设计与实施计划

本文档为 Capsa 记忆服务提供**轻量、安全、专注核心价值**的 Web 可视化管理控制台（Capsa Studio）设计与实施规范。经批判性吸收复审意见，本计划采取 **MVP 聚焦策略**，重点解决日常高频的记忆检索、查阅、编辑、复核与回收站恢复痛点，将低频运维操作保持在 CLI，实现安全性与轻量化的双重闭环。

---

## 一、产品定位与设计决策演进

### 1. 原方案“不做 Web 管理台”的决策演进与 MVP 收缩
- **背景与痛点**：原设计方案曾将 Web 管理台设为待触发项（每日审阅 > 20 次）。但在实际部署使用中，用户在跨设备（如移动端手机/平板浏览器）快速查阅记忆、审阅正文 Markdown 排版时，纯终端 SSH 存在显著的操作摩擦。
- **MVP 范围收缩（防过度设计）**：
  为避免管理后台无度膨胀与安全漏洞，首版 Capsa Studio 实行严格的 **MVP 功能收缩**：
  - **纳入 Web 控制台（高频使用）**：
    1. **记忆工作台**：分组筛选、关键词即时检索、Markdown 正文预览、原地编辑与新建；
    2. **时效复核中心**：过期记忆聚合看板、一键确认顺延、原地修改；
    3. **回收站**：软删除条目原因排查、一键撤销恢复。
  - **暂缓并保留在 CLI（低频运维）**：
    - **Key 签发与吊销**：继续由 `capsa key` CLI 执行。彻底消除“普通 Key 如何通过 Web 签发管理 Key”的权限提升漏洞；
    - **分组创建与维护**：继续由 `capsa group` CLI 负责；
    - **数据库热备与还原**：继续由 `capsa backup` CLI 与宿主机 cron 负责。

### 2. 核心架构与资源契约
- **零 Node.js 常驻服务（Zero Runtime Node）**：采用现代单页应用（SPA），在 Docker 多阶段构建中完成静态打包，产物（HTML/JS/CSS，gzip 后 < 150KB）直接注入 Python 容器，由后端 Starlette 静态服务挂载，不增加任何常驻容器或后台 Node 进程。
- **零权限提升与对称鉴权（Zero Privilege Escalation）**：
  Web 控制台直接复用后端既有的 **Bearer API Key**。调用者的访问边界完全由其所持 Key 的 `scopes` 决定（如持有 `proj:rw, study:r`，则在 Web 界面中仅可见该两个分组，且 `study` 只能查看无法编辑）。**Web 控制台与 MCP 客户端在权限模型上完全对称，无任何特权后门**。

---

## 二、安全性架构与数据流

<figure>

<div style="border:1px solid #e5e7eb;border-radius:12px;padding:22px;background:#fafafa;color:#18181b;font-size:13px;line-height:1.6">

<div style="font-weight:600;color:#2563eb;margin-bottom:14px;font-size:14px">Capsa Studio 浏览器端安全控制模型</div>

<div style="display:grid;grid-template-columns:1fr 20px 1.2fr 20px 1fr;gap:0;align-items:center;font-size:12px">

<!-- Box 1: Storage -->
<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:14px">
  <div style="font-weight:600;color:#18181b">1. 凭据隔离存储</div>
  <div style="font-size:11px;color:#71717a;margin-top:6px;line-height:1.7">
    • 仅存保于 <code>sessionStorage</code><br>
    • 标签页关闭即销毁<br>
    • 严禁使用持久化 <code>localStorage</code><br>
    • 401 拦截即刻抹除凭据
  </div>
</div>

<div style="text-align:center;color:#2563eb;font-weight:bold">→</div>

<!-- Box 2: Sanitizer -->
<div style="background:#ffffff;border:1px solid #2563eb;border-radius:8px;padding:14px">
  <div style="font-weight:600;color:#2563eb">2. Markdown XSS 净化管道</div>
  <div style="font-size:11px;color:#52525b;margin-top:6px;line-height:1.7">
    • 严禁解析原始 HTML (<code>skipHtml</code>)<br>
    • 引入 <code>rehype-sanitize</code> 白名单过滤<br>
    • 协议限定: 仅允许 <code>http/https/mailto</code><br>
    • 外链强制 <code>rel="noopener noreferrer"</code>
  </div>
</div>

<div style="text-align:center;color:#2563eb;font-weight:bold">→</div>

<!-- Box 3: Safe Render -->
<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:14px">
  <div style="font-weight:600;color:#18181b">3. 受控渲染与交互防线</div>
  <div style="font-size:11px;color:#71717a;margin-top:6px;line-height:1.7">
    • 原生排版与语法高亮<br>
    • 原地抽屉式编辑<br>
    • 实时字数限制指示<br>
    • 阻断脚本与伪协议注入
  </div>
</div>

</div>

</div>

</figure>

### 1. 凭据生命周期与退出机制
- 用户初次进入界面时显示登录卡片，要求输入已持有的 API Key（如 `capsa_a1b2c3d4_xxxx`）；
- 验证成功后将 Key 写入浏览器的 `sessionStorage`；
- 右上角常驻「退出登录」按钮，点击立即清空 `sessionStorage` 并重置界面至锁屏；
- 全局 Axios/Fetch 拦截器：一旦任意请求返回 **HTTP 401**，立即销毁内存凭据并跳转回登录弹窗，提示「凭据已失效或被吊销」。

### 2. Markdown 渲染安全策略（严格防 XSS）
记忆正文可能由各类外部 Agent 写入，不可假定其安全。前端通过禁用原始 HTML、白名单清洗和协议过滤，阻断定义范围内的跨站脚本注入路径：
- 使用 `react-markdown` 搭配 `rehype-sanitize`（基于 GitHub 清洗规则白名单）；
- 显式设置配置项：`skipHtml={true}`，禁止渲染任意内联 HTML 标签（如 `<script>`、`<iframe>`、`<img onerror=...>` 等一律转为纯文本转义字符）；
- 链接协议白名单：仅放行 `http:`、`https:` 与 `mailto:`，彻底过滤 `javascript:` 与 `data:` 伪协议；
- 所有超链接统一附加 `target="_blank" rel="noopener noreferrer"`。

---

## 三、后端 RESTful API 规范与数据契约 (`/api/*`)

后端挂载在 `/api` 前缀下，由 `capsa/web_api.py` 提供，统一由根应用 Starlette 挂载。所有接口均要求 `Authorization: Bearer <key>`，数据访问严格通过调用 DAL 方法（如 `list_memories_for_web`)。

### 1. 统一响应与错误信封规范 (JSON Envelope)

**列表类成功响应**：
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "mem_7f3ka2",
        "group_slug": "proj",
        "title": "MCP 授权模型设计",
        "summary": "Key 采用 sha256 存盘，单入口统一授权",
        "body": "# 正文 Markdown 原文...",
        "tags": ["mcp", "auth"],
        "pinned": 1,
        "review_at": "2026-10-01T00:00:00Z",
        "is_overdue": false,
        "created_at": "2026-09-01T12:00:00Z",
        "updated_at": "2026-09-01T12:00:00Z",
        "deleted_at": null,
        "deleted_reason": null,
        "permission": "rw"
      }
    ],
    "total": 1,
    "offset": 0,
    "limit": 20
  },
  "error": null
}
```

**新建类成功响应 (附带查重提醒)**：
```json
{
  "success": true,
  "data": {
    "id": "mem_7f3ka2",
    "similar_items": [
      { "id": "mem_123456", "title": "MCP 授权模型旧稿" }
    ]
  },
  "error": null
}
```

**统一失败响应**：
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "对分组 proj 只有只读权限，拒绝修改"
  }
}
```

**错误代码枚举 (`error.code`)**：
- `UNAUTHORIZED` (HTTP 401)：未携带 Token 或 Token 无效/被吊销；
- `FORBIDDEN` (HTTP 403)：访问未授权分组或只读 Key 尝试写操作；
- `NOT_FOUND` (HTTP 404)：条目不存在；
- `PAYLOAD_TOO_LARGE` (HTTP 413)：请求体大于 1MB；
- `VALIDATION_ERROR` (HTTP 422)：字段超长（标题>60、摘要>200、正文>64000）；
- `INTERNAL_ERROR` (HTTP 500)：底层数据库或服务异常。

### 2. MVP API 端点列表

| 端点 | 方法 | 请求参数 / Body | 作用与权限限制 |
|---|---|---|---|
| `/api/auth/me` | GET | 无 | 校验当前 Key，返回 `{key_id, name, scopes: {slug: "r"|"rw"}}` |
| `/api/groups` | GET | 无 | 获取当前 Key 授权范围内的分组列表（含名称、描述与有效条目数） |
| `/api/memories` | GET | `query?`, `group?`, `status=active|overdue|deleted`, `offset=0`, `limit=20` | 综合记忆检索与列表，直连 DAL `list_memories_for_web`，支持分页 |
| `/api/memories/{id}` | GET | 无 | 获取单条记忆完整详情（含 Markdown 正文）。若无权访问返回 403 |
| `/api/memories` | POST | `{group, title, summary, body, tags?, review_at?}` | 新建记忆（需对应分组 `rw` 权限；字数强校验；若有近似条目在 `data.similar_items` 中提示） |
| `/api/memories/{id}` | PUT | `{title?, summary?, body?, tags?, review_at?, clear_review_at?, pinned?}` | 局部增量修改（需对应分组 `rw` 权限；支持 `clear_review_at=True` 置空） |
| `/api/memories/{id}` | DELETE | `{reason: string}` | 软删除记忆（需对应分组 `rw` 权限；记录 `deleted_reason`） |
| `/api/memories/{id}/restore` | POST | 无 | 从回收站恢复软删除记忆（需对应分组 `rw` 权限） |

---

## 四、前端 3 大核心视图与生产级状态机

界面风格采用 Zinc 灰阶极简工业设计，字体采用系统无衬线字体与等宽字体，无花哨动效。

<figure>

<div style="border:1px solid #e5e7eb;border-radius:12px;padding:20px;background:#fafafa;color:#18181b;font-size:13px">

<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">

<!-- View 1 -->
<div style="background:#ffffff;border:1px solid #2563eb;border-radius:8px;padding:14px">
  <div style="font-weight:600;color:#2563eb;font-size:13px">1. 记忆工作台 (Memory Studio)</div>
  <div style="font-size:12px;color:#52525b;margin-top:8px;line-height:1.7">
    • <strong>多维筛选栏</strong>：分组标签胶囊 (Pills)、关键词即时搜索、置顶筛选；<br>
    • <strong>条目主列表</strong>：紧凑展示标题、摘要、标签、更新时间与只读/读写标识；<br>
    • <strong>正文预览栏</strong>：优雅排版的只读 Markdown，带一键复制与快捷编辑入口；<br>
    • <strong>编辑/新建抽屉</strong>：右侧滑出抽屉，实时显示 Title (0/60)、Summary (0/200)、Body (0/64k) 剩余字符指示。
  </div>
</div>

<!-- View 2 -->
<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:14px">
  <div style="font-weight:600;color:#18181b;font-size:13px">2. 时效复核中心 (Review Center)</div>
  <div style="font-size:12px;color:#52525b;margin-top:8px;line-height:1.7">
    • <strong>到期记忆专区</strong>：自动筛选 <code>review_at &lt; NOW()</code> 的记忆；<br>
    • <strong>视觉警示</strong>：黄色时效预警标签，并指示检索引擎中已执行扣 2 分降权；<br>
    • <strong>一键顺延操作</strong>：提供「确认并延期（+30天/+90天）」快捷按钮，或就地点击移入回收站。
  </div>
</div>

<!-- View 3 -->
<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:14px">
  <div style="font-weight:600;color:#18181b;font-size:13px">3. 回收站 (Recycle Bin)</div>
  <div style="font-size:12px;color:#52525b;margin-top:8px;line-height:1.7">
    • <strong>安全隔离</strong>：清晰陈列所有 <code>deleted_at IS NOT NULL</code> 的记忆；<br>
    • <strong>原因审计</strong>：完整展示当时传入的 <code>deleted_reason</code> 与删除时间戳；<br>
    • <strong>一键撤销</strong>：具备对应分组 <code>rw</code> 权限的用户可一键恢复，条目立刻重新在工作台可见。
  </div>
</div>

</div>

</div>

</figure>

### 生产级视图状态契约
每个视图必须实现完整的 4 类 UI 状态，杜绝空白卡死或不响应：
1. **加载中状态 (Loading State)**：使用轻量灰白脉冲骨架屏（Skeleton UI），保持布局稳定不抖动；
2. **空数据状态 (Empty State)**：
   - 工作台无记忆时：展示「暂无匹配记忆，点击新建」；
   - 复核中心无到期项时：展示绿标「所有追踪记忆均在有效期内」；
   - 回收站为空时：展示「回收站暂无条目」；
3. **错误与重试状态 (Error State)**：接口超时或网络异常时，在列表顶端显示告警条，并提供「重试」按钮；
4. **表单安全与防丢机制**：
   - 标题、摘要、正文超过上限时，输入框即时变红并**禁用提交按钮**，明确提示超出字符数；
   - 编辑抽屉若发生内容改动，在用户尝试点击遮罩层关闭时，弹出二次确认弹窗防误关丢失。
5. **移动端响应式布局**：
   - 屏幕宽度 $ge 768px$：两栏/三栏分栏布局；
   - 屏幕宽度 $< 768px$：折叠为单栏主屏，点击条目滑出详情全屏视图，底部常驻移动端导航栏。

---

## 五、工程构建契约与自动化浏览器测试

### 1. 前端工程文件结构 (`web/`)
```
web/
├── package.json
├── package-lock.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
├── index.html
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── api.ts              # Fetch 客户端封装、sessionStorage 凭据注入与 401 拦截
│   ├── types.ts            # 前端契约类型定义 (与后端 JSON 信封对齐)
│   ├── components/
│   │   ├── Header.tsx      # 分组展示与退出登录
│   │   ├── MemoryList.tsx  # 记忆主列表与骨架屏
│   │   ├── MemoryDetail.tsx# Markdown 安全渲染与操作按钮
│   │   ├── EditDrawer.tsx  # 原地抽屉编辑器与字数校验器
│   │   ├── ReviewCenter.tsx# 时效复核看板
│   │   └── RecycleBin.tsx  # 回收站管理
│   └── styles/
│       └── index.css       # Tailwind 导入
└── tests/
    └── e2e.spec.ts         # Playwright 最小端到端浏览器自动化烟测
```

### 2. 前端锁定依赖清单 (`web/package.json`)
```json
{
  "name": "capsa-studio",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "lucide-react": "0.395.0",
    "react-markdown": "9.0.1",
    "rehype-sanitize": "6.0.0"
  },
  "devDependencies": {
    "@playwright/test": "1.45.0",
    "@types/react": "18.3.3",
    "@types/react-dom": "18.3.0",
    "@vitejs/plugin-react": "4.3.1",
    "autoprefixer": "10.4.19",
    "postcss": "8.4.38",
    "tailwindcss": "3.4.4",
    "typescript": "5.4.5",
    "vite": "5.3.1"
  }
}
```

### 3. Playwright 浏览器自动化烟测套件 (`web/tests/e2e.spec.ts`)
```typescript
import { test, expect } from '@playwright/test';

test.describe('Capsa Studio 浏览器核心链路烟测', () => {
  test('1. 凭据存储与退出销毁测试', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[type="password"]', 'capsa_testkey_12345678901234567890123456789012');
    await page.click('button:has-text("连接")');
    await expect(page.locator('text=记忆工作台')).toBeVisible();

    // 检查 sessionStorage
    const token = await page.evaluate(() => sessionStorage.getItem('capsa_key'));
    expect(token).toBeTruthy();

    // 点击退出登录
    await page.click('button:has-text("退出")');
    const clearedToken = await page.evaluate(() => sessionStorage.getItem('capsa_key'));
    expect(clearedToken).toBeNull();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('2. XSS 脚本与伪协议净化拦截测试', async ({ page }) => {
    // 注入恶意 Markdown
    await page.goto('/');
    await page.evaluate(() => sessionStorage.setItem('capsa_key', 'capsa_testkey_12345678901234567890123456789012'));
    await page.reload();

    // 验证 <script> 标签被过滤为文本而非执行
    await page.click('text=新建记忆');
    await page.fill('input[placeholder*="标题"]', '安全测试');
    await page.fill('input[placeholder*="摘要"]', 'XSS 拦截');
    await page.fill('textarea[placeholder*="正文"]', '<script>window.xss_flag=true;</script>[点击链接](javascript:window.xss_link=true)');
    await page.click('button:has-text("保存")');

    // 验证 flag 为空且脚本未执行
    const xssFlag = await page.evaluate(() => (window as any).xss_flag);
    expect(xssFlag).toBeUndefined();
  });

  test('3. 移动端 375px 响应式单栏与抽屉展开测试', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.evaluate(() => sessionStorage.setItem('capsa_key', 'capsa_testkey_12345678901234567890123456789012'));
    await page.reload();

    // 移动端单栏导航
    await expect(page.locator('nav[aria-label="移动端导航"]')).toBeVisible();
  });
});
```

### 4. Docker 多阶段构建实现 (Dockerfile)
生产镜像采用两阶段构建，**VPS 镜像最终仅保留 Python 运行时，Node.js 零残留**：
```dockerfile
# Stage 1: Build Frontend Assets
FROM node:20-alpine AS web-builder
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: Production Python Runtime
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    CAPSA_DB_PATH=/data/capsa.db

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 -s /bin/bash capsa \
    && mkdir -p /data /backup /app/capsa/static \
    && chown -R capsa:capsa /app /data /backup

COPY --chown=capsa:capsa pyproject.toml .
COPY --chown=capsa:capsa capsa/ capsa/
COPY --from=web-builder --chown=capsa:capsa /web/dist/ capsa/static/

RUN pip install --no-cache-dir .

USER capsa
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8000/healthz || exit 1

CMD ["uvicorn", "capsa.server:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## 六、Phase 3 实施验收断言清单

AI Code Agent 交付 Phase 3 前端部分时，必须满足以下测试与验收标准：

- [ ] **Playwright 自动化全通**：运行 `npm run test:e2e`，凭据存销、401 清理、XSS 净化、375px 移动端单栏与核心 CRUD 自动化用例 100% 通过；
- [ ] **XSS 净化断言**：在记忆正文中注入 `<script>alert(1)</script>`、`<img src=x onerror=alert(1)>` 以及 `[恶意链接](javascript:alert(1))`，在 Web 界面中查看详情时，脚本不执行、事件属性被抹除、链接伪协议被屏蔽；
- [ ] **权限自适应断言**：使用只读 Key 登录，工作台中的「新建记忆」按钮置灰禁用，记忆详情中的「编辑」与「删除」按钮隐藏或不可点击；
- [ ] **字数校验与错误拦截断言**：编辑抽屉中输入 61 字标题时，保存按钮置灰并标红提示；API 层模拟发送 61 字标题，接口返回 HTTP 422 及统一错误 JSON 信封；
- [ ] **全流程 CRUD 与回收站断言**：
  1. 通过 Web 成功创建一条包含 Markdown 列表的正文；
  2. 工作台成功检索并展示正文排版；
  3. 执行软删除并填写删除原因；
  4. 进入回收站查看该条目及删除原因；
  5. 点击一键恢复，条目重新回到工作台可见；
- [ ] **响应式移动端断言**：在移动端视口（宽度 375px）下，界面自适应为单栏流式布局，抽屉自适应全屏展开无遮挡。
