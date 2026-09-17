# Capsa

部署在个人 VPS 上的私人记忆服务。以 MCP 协议向 Agent 提供分组隔离、分级披露的长期记忆读写，并附带一套全权限单管理员 Web 管理台。

## 能力与边界

| 提供 | 不提供 |
|---|---|
| 四个只读工具（分组、检索、摘要、正文）与三个写入工具（新建、更新、软删除） | 向量检索与自动抽取写入 |
| 三级披露：标题层、摘要层、正文层 | 多租户 |
| 三态授权：授权、不可见、不存在；未授权分组不披露存在性 | Key 签发与撤销的 Web 化（保留在 CLI） |
| 时效复核、回收站软删除与恢复 | 分组标识（slug）创建后的修改 |
| 全权限单管理员 Web 管理台：工作台、分类管理、时效复核、回收站 | 独立用户表、多角色 RBAC 与 Cookie/Session |
| Web 端分类创建与就地编辑 | 回收站条目的物理清理 |
| 在线热备与快照回灌 | 备份的异地对象存储同步 |

## 架构

<figure>

<div style="border:1px solid #e5e7eb;border-radius:12px;padding:22px;background:#fafafa;color:#18181b;font-size:13px;line-height:1.6">

<div style="display:grid;grid-template-columns:1fr 26px 1fr 26px 1fr;align-items:center;gap:0">

<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:14px">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#71717a">公网</div>
  <div style="font-size:13px;font-weight:600;margin:6px 0 8px 0">Agent 与浏览器</div>
  <div style="font-size:11px;color:#52525b">MCP 客户端 · 管理台页面</div>
</div>

<div style="display:flex;align-items:center;justify-content:center;color:#2563eb;font-weight:bold">→</div>

<div style="background:#ffffff;border:1px solid #2563eb;border-radius:8px;padding:14px">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#2563eb">宿主机</div>
  <div style="font-size:13px;font-weight:600;margin:6px 0 8px 0">反向代理</div>
  <div style="font-size:11px;color:#52525b">TLS 终止与证书续期 · 响应不缓冲</div>
</div>

<div style="display:flex;align-items:center;justify-content:center;color:#2563eb;font-weight:bold">→</div>

<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:14px">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#71717a">容器</div>
  <div style="font-size:13px;font-weight:600;margin:6px 0 8px 0">Capsa</div>
  <div style="font-size:11px;color:#52525b">127.0.0.1:8000</div>
</div>

</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px;padding-top:14px;border-top:1px solid #e5e7eb">
  <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:12px">
    <div style="font-size:12px;font-weight:600;margin-bottom:6px">容器内的四条路由</div>
    <div style="font-size:11px;color:#52525b;line-height:1.9">
      <code style="background:#f4f4f5;padding:1px 5px;border-radius:3px">/healthz</code> 健康检查<br>
      <code style="background:#f4f4f5;padding:1px 5px;border-radius:3px">/mcp</code> MCP 工具端点<br>
      <code style="background:#f4f4f5;padding:1px 5px;border-radius:3px">/api</code> REST API<br>
      <code style="background:#f4f4f5;padding:1px 5px;border-radius:3px">/</code> 管理台静态页面
    </div>
  </div>
  <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:12px">
    <div style="font-size:12px;font-weight:600;margin-bottom:6px">两个数据卷</div>
    <div style="font-size:11px;color:#52525b;line-height:1.9">
      <code style="background:#f4f4f5;padding:1px 5px;border-radius:3px">capsa-data</code> → <code style="background:#f4f4f5;padding:1px 5px;border-radius:3px">/data</code> SQLite 数据库<br>
      <code style="background:#f4f4f5;padding:1px 5px;border-radius:3px">capsa-backup</code> → <code style="background:#f4f4f5;padding:1px 5px;border-radius:3px">/backup</code> 热备快照
    </div>
  </div>
</div>

<div style="margin-top:14px;font-size:11px;color:#71717a">
TLS 证书、域名路由与公网监听由宿主机承担，容器只发布一个回环端口。1MB 请求体上限在应用层执行，宿主反代无需重复配置。
</div>

</div>

</figure>

## 部署到 VPS

前置：VPS 已装 Docker 与 Compose 插件，并有一个已解析到该机器的域名。

私有的 GHCR 包需要凭据才能拉取。在 GitHub 生成一个具备 `read:packages` 权限的 PAT，然后：

```bash
echo "$GHCR_PAT" | docker login ghcr.io -u <你的用户名> --password-stdin
```

把 `docker-compose.yml` 放到 VPS 的部署目录（例如 `/opt/capsa/`），然后按顺序执行：

```bash
cd /opt/capsa

# 1. 初始化数据库与四个标准分组
docker compose run --rm capsa capsa init

# 2. 签发一把 Agent 用的 Key（分组隔离）与一把管理台管理员 Key（通配全库）
docker compose run --rm capsa capsa key create agent --scopes proj:rw,study:r
docker compose run --rm capsa capsa key create admin --scopes "*:rw"

# 3. 启动服务
docker compose up -d

# 4. 验证
curl -fsS http://127.0.0.1:8000/healthz
```

第 2 步输出的明文令牌只显示一次，服务端只存 SHA256，之后无法找回。`/healthz` 返回 `{"status":"ok"}` 表示数据库已就绪；未执行 `init` 时返回 503。

## 宿主反向代理与 TLS

容器默认只监听 `127.0.0.1:8000`，公网流量必须经宿主反代进入。反代配置有两条硬要求。

**关闭响应缓冲**。MCP 的 Streamable HTTP 依赖逐块下发，反代若缓冲响应体，表现为连接成功但工具结果迟迟不返回。Nginx 需要：

```nginx
location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;

    # MCP 流式响应要求逐块下发
    proxy_buffering off;
    proxy_read_timeout 300s;
}
```

用 Caddy 反代时 `reverse_proxy` 默认不缓冲，加一行 `flush_interval -1` 显式固定该行为。Nginx Proxy Manager 在 Advanced 页签粘贴上述指令。

**不要配置请求体上限**。1MB 上限由应用层的 `RequestBodyLimitMiddleware` 执行，超限返回 413。宿主侧重复配置只会产生第二处需要同步的常量。

反代加入容器的网络时，用环境变量放宽端口绑定：

```bash
# .env，与 docker-compose.yml 同目录
CAPSA_BIND=172.18.0.1   # 指向宿主的网桥地址，而非 0.0.0.0
CAPSA_TAG=v0.1.0        # 部署具体版本，便于回滚
```

## 接入 MCP

端点 `https://<你的域名>/mcp`，Bearer 鉴权，令牌来自 `capsa key create`。

```json
{
  "mcpServers": {
    "capsa": {
      "type": "http",
      "url": "https://memory.example.com/mcp",
      "headers": { "Authorization": "Bearer capsa_<key_id>_<secret>" }
    }
  }
}
```

Agent 可用的工具：`memory_groups`、`memory_search`、`memory_peek`、`memory_read` 为只读；`memory_save`、`memory_update`、`memory_forget` 为写入。作用域形如 `proj:rw,study:r`，`rw` 可读写，`r` 只读；通配 `*:rw` 得到全库读写，`*:r` 全库只读，显式分组键优先于通配。

## Web 管理台

浏览器打开 `https://<你的域名>/`，粘贴**管理员令牌**登录：要么是 `capsa key create admin --scopes "*:rw"` 签发的通配 Key，要么是服务端 `CAPSA_ADMIN_TOKEN` 的值。凭据只存在 `sessionStorage`，关闭标签页即失效。

管理台是服务拥有者的全权限控制台，提供工作台、分类管理、时效复核与回收站四个视图：可浏览、检索、新建、编辑、软删除、延期复核并恢复全库所有分类下的记忆。分类管理支持新建分类与就地编辑名称、描述；分类标识（slug）创建后不可修改，以保证记忆外键始终有效。新增或编辑分类后，工作台的筛选胶囊与「新建记忆」抽屉的分组选项即时更新。

`/api` 在网关层强制核验管理员权限，普通分组 Key 无论以何种方式发起请求一律返回 403，无法绕过页面直接调用。Agent 侧的 `/mcp` 不受此限：分组 Key 仍按作用域隔离，通配 `*:rw` Key 则拥有全库读写。

```bash
# 为管理台签发通配管理员 Key
docker compose run --rm capsa capsa key create admin --scopes "*:rw"

# 或用环境变量提供管理级令牌（写入与 docker-compose.yml 同目录的 .env，重启生效）
CAPSA_ADMIN_TOKEN=<你的密钥>
```

## 备份与恢复

备份用连接级快照生成，文件名 `capsa-YYYY-MM-DD.db`，默认保留 14 天。

```bash
# 手动热备
docker compose exec -T capsa capsa backup /backup

# 从快照回灌（覆盖当前数据库，需重启服务）
docker compose exec -T capsa capsa restore /backup/capsa-2026-09-16.db
docker compose restart capsa
```

宿主机 Cron 定时热备：

```cron
0 3 * * * docker compose -f /opt/capsa/docker-compose.yml exec -T capsa capsa backup /backup
```

## 镜像构建

镜像由 GitHub Actions 手动触发构建并推送到 GHCR，`docker-compose.yml` 只拉取不构建，VPS 无需 Node 与 Python 构建链。

网页入口：仓库的 Actions 页签选择 `build-image`，点击 Run workflow，填写标签。

命令行：

```bash
gh workflow run build-image.yml -f tag=v0.1.0
gh run watch
```

标签默认 `latest`。生产建议用具体版本号，`docker-compose.yml` 侧通过 `CAPSA_TAG` 覆盖。

本机需要构建镜像时：

```bash
docker build -t ghcr.io/evan-1777/capsa:dev .
```

`Dockerfile` 为两阶段构建：第一阶段用 `node:20-alpine` 产出前端静态文件，第二阶段用 `python:3.12-slim` 打包运行时，最终镜像不含 Node。

## 运维命令速查

`capsa` 命令在容器内执行，宿主机无需安装 Python。

```bash
# 初始化：预置 proj/study/life/track 四个分组
docker compose run --rm capsa capsa init

# 分组
docker compose run --rm capsa capsa group list
docker compose run --rm capsa capsa group add work 工作 --desc "工作事项"

# Key
docker compose run --rm capsa capsa key create agent --scopes proj:rw,study:r
docker compose run --rm capsa capsa key list
docker compose run --rm capsa capsa key revoke <key_id>

# 回收站
docker compose exec -T capsa capsa memory list-deleted --group proj
docker compose exec -T capsa capsa memory restore <memory_id>

# 按检索同源顺序审阅
docker compose exec -T capsa capsa review --group proj --query 部署 --limit 20

# 热备与回灌
docker compose exec -T capsa capsa backup /backup --keep-days 14
docker compose exec -T capsa capsa restore /backup/capsa-2026-09-16.db
```

`review` 与 MCP 的 `memory_search` 共用同一条检索与排序实现，同一分组、同一关键词下两者的条目顺序逐条一致。

## 目录结构

```
capsa/                 Python 服务
  server.py            根 ASGI 应用：/healthz、/mcp、/api、静态页面
  mcp_service.py       FastMCP 实例与七个工具
  permissions.py       权限判定单一来源：permission_for 与管理级令牌
  web_api.py           REST API：统一信封、管理员网关守卫、十个端点
  dal.py               三态授权数据访问层，唯一 SQL 出口
  retrieval.py         分词、打分排序与近似查重
  formatters.py        三级披露的纯文本契约
  cli.py               init / group / key / memory / review / backup / restore
web/                   Capsa Studio：Vite + React 18 + TypeScript + Tailwind
tests/                 pytest 套件，含部署与工作流的静态校验
Dockerfile             两阶段构建
docker-compose.yml     单服务编排，只拉取镜像
.github/workflows/     手动触发的镜像构建
```

## 文档

| 文件 | 内容 |
|---|---|
| `.docs/SCOPE.md` | 项目定位与边界 |
| `.docs/Project.md` | 项目单一事实来源：架构、约定、约束与决策记录 |
| `.docs/09-13-v3/` | Phase 3 设计与交付归档 |
| `.docs/09-16-v1/` | 本次部署形态收敛的归档 |
