# 1Panel 编排部署 Capsa 记忆服务实战指南

> **适用对象**：个人开发者、自建服务爱好者、AI Agent 玩家。  
> **阅读目标**：通过现代化运维面板 **1Panel**，以图形化配合轻量 CLI 的方式，零死角完成 Capsa 记忆服务的 Compose 编排、数据持久化、反向代理配置、SSL 证书自动申请与客户端接入。

---

## 一、为什么选择 1Panel 部署 Capsa？

在自建 AI 服务（如个人知识库、记忆系统）时，很多爱好者常在两种极端之间纠结：
1. **纯命令行（CLI）手搓**：编辑各种 YAML、配置 Nginx 反代、写 acme.sh 申请证书、配置 crontab 定时任务……步骤繁杂且容易因缩进或端口冲突翻车。
2. **重型面板**：功能过于繁杂臃肿，后台资源占用高。

**1Panel** 是基于 Docker 的现代化开源 Linux 运维面板，它将 Docker Compose 容器编排、OpenResty（Nginx）反向代理、Let's Encrypt 免费证书续签、网页终端集成在统一的 Web 界面中，非常契合个人轻量 VPS 部署场景。

<figure>

<div style="border:1px solid #e5e7eb;border-radius:12px;padding:22px;background:#fafafa;color:#18181b;font-size:13px;line-height:1.6">

<div style="display:grid;grid-template-columns:1fr 28px 1.2fr 28px 1fr;align-items:center;gap:0">

<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:14px;text-align:center">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#71717a">客户端请求</div>
  <div style="font-size:13px;font-weight:600;margin:6px 0 4px 0">Agent / 浏览器</div>
  <div style="font-size:11px;color:#52525b">HTTPS (端口 443)</div>
</div>

<div style="display:flex;align-items:center;justify-content:center;color:#2563eb;font-weight:bold">→</div>

<div style="background:#ffffff;border:1px solid #2563eb;border-radius:8px;padding:14px">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#2563eb">1Panel 网站反代服务</div>
  <div style="font-size:13px;font-weight:600;margin:4px 0">OpenResty / Nginx</div>
  <div style="font-size:11px;color:#52525b">
    • 域名解析与 SSL 证书续期<br>
    • 关闭缓冲（Stream 流式直通）
  </div>
</div>

<div style="display:flex;align-items:center;justify-content:center;color:#2563eb;font-weight:bold">→</div>

<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:14px;text-align:center">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#71717a">编排容器</div>
  <div style="font-size:13px;font-weight:600;margin:6px 0 4px 0">Capsa 记忆服务</div>
  <div style="font-size:11px;color:#52525b">回环端口 127.0.0.1:8000</div>
</div>

</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px;padding-top:14px;border-top:1px solid #e5e7eb">
  <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:12px">
    <div style="font-size:12px;font-weight:600;margin-bottom:4px">1Panel 编排负责</div>
    <div style="font-size:11px;color:#52525b;line-height:1.8">
      • 容器生命周期管理（启动/重启/停止）<br>
      • 持久卷挂载（数据与热备隔离）<br>
      • 内置容器终端快速执行 CLI 初始化
    </div>
  </div>
  <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:12px">
    <div style="font-size:12px;font-weight:600;margin-bottom:4px">1Panel 网站模块负责</div>
    <div style="font-size:11px;color:#52525b;line-height:1.8">
      • 域名绑定与一键申请 Let's Encrypt 证书<br>
      • 精确配置反向代理规则<br>
      • 解决 MCP 协议特有的响应缓冲问题
    </div>
  </div>
</div>

</div>

</figure>

---

## 二、部署前准备清单

在开始操作前，请确保准备好以下事项：

1. **一台已安装 1Panel 的云服务器（VPS）**：
   - 系统推荐：Debian 11/12 或 Ubuntu 22.04/24.04。
   - 已安装 1Panel 面板并能正常登录。
   - 在 1Panel 的 **应用商店** 中，已安装并启动 **OpenResty**（1Panel 的网站与反代功能依赖此应用）。
2. **一个解析到 VPS 公网 IP 的域名**：
   - 例如：`memory.yourdomain.com`。
   - 在域名 DNS 解析商后台（如 Cloudflare、阿里云、DNSPod 等）添加一条 `A` 记录指向 VPS 公网 IP。
3. **GitHub Container Registry (GHCR) 访问凭据（若镜像为私有）**：
   - Capsa 镜像托管于 GitHub GHCR（`ghcr.io`）。
   - 若镜像设为私有，需要生成一个具备 `read:packages` 权限的 Personal Access Token (Classic)，用于服务器拉取镜像；若已设为 Public 公开镜像，则无需登录直接拉取。

---

## 三、步骤 1：配置镜像拉取凭据（仅私有包需要）

如果你的 Capsa 仓库及镜像为私有：

1. 登录 1Panel 面板，点击左侧菜单栏的 **容器** -> **镜像** -> **镜像仓库**。
2. 点击右上角 **创建镜像仓库**：
   - **名称**：`ghcr`（可自定义）
   - **仓库地址**：`ghcr.io`
   - **用户名**：你的 GitHub 用户名（小写）
   - **密码/Token**：具备 `read:packages` 权限的 GitHub PAT
3. 点击 **确认** 保存。1Panel 将自动同步 Docker 凭据，后续编排便能直接拉取 GHCR 镜像。

> 💡 **小贴士**：如果使用的是公开发布的镜像，可直接跳过此步骤。

---

## 四、步骤 2：创建 1Panel 编排并拉起服务

1Panel 的“编排”功能本质上是图形化的 `docker-compose.yml` 管理器，既能保留 Compose 规范的灵活性，又提供了面板一键启停和日志查看的便利。

### 1. 新建编排模版/项目
1. 登录 1Panel，点击左侧导航的 **容器** -> **编排**。
2. 点击 **创建编排**：
   - **名称**：`capsa`
   - **创建方式**：选择 **编辑**
3. 将以下经过优化的 `docker-compose.yml` 内容粘贴到配置框中：

```yaml
services:
  capsa:
    image: ghcr.io/evan-1777/capsa:latest
    container_name: capsa
    restart: unless-stopped
    environment:
      # 指定 SQLite 数据库在容器内的绝对路径
      - CAPSA_DB_PATH=/data/capsa.db
    volumes:
      # 数据卷：持久化存储核心数据库
      - capsa-data:/data
      # 备份卷：用于保存定期的数据库快照
      - capsa-backup:/backup
    ports:
      # 关键点：仅监听本地回环 127.0.0.1，避免未授权端口暴露给公网
      - "127.0.0.1:8000:8000"

volumes:
  capsa-data:
    name: capsa-data
  capsa-backup:
    name: capsa-backup
```

> 🔍 **关键配置批注**：
> - `127.0.0.1:8000:8000`：将容器端口绑定到本机回环地址。这样外界无法通过 `http://VPS-IP:8000` 直接访问，必须通过我们稍后配置的安全 HTTPS 反向代理进入。
> - `capsa-data` 与 `capsa-backup`：由 Docker 管理的命名数据卷，即使容器重启或升级销毁，数据与备份快照也不会丢失。

4. 点击 **确认**。1Panel 会自动拉取镜像并启动容器。

---

## 五、步骤 3：数据初始化与密钥签发（关键步骤）

Capsa 服务遵循严谨的安全设计：**首次启动时不会私自创建业务数据表**。如果未初始化直接访问，`/healthz` 端点会返回 503 状态码。我们需要使用内置的 CLI 工具进行一次性初始化并签发访问令牌。

1Panel 提供了非常便捷的网页终端（Web Terminal），无需打开本地 SSH 软件即可操作：

### 1. 进入容器终端
1. 点击 1Panel 菜单栏的 **容器** -> **容器列表**。
2. 找到名为 `capsa` 的容器，在右侧操作列点击 **终端** 图标（或通过下拉菜单选择 **终端**）。
3. 命令选择 `/bin/bash`，点击 **连接** 进入容器内部命令行。

### 2. 执行数据库初始化
在容器终端内输入以下命令并回车：

```bash
capsa init
```

**预期输出**：
```text
Initialized database at /data/capsa.db with groups: proj, study, life, track
```
此命令会在 `/data/capsa.db` 创建 SQLite 数据表，并预置 4 个标准记忆分组（`proj` 项目、`study` 学习、`life` 生活、`track` 轨迹）。

### 3. 签发访问令牌（Key）
Capsa 采用最小权限原则，通过细粒度 Scopes（作用域）控制读写权限：
- `rw`：读写权限（可检索、查看、新增、编辑、软删除记忆）
- `r`：只读权限（仅可检索、查看记忆，禁止任何改动）

在终端中执行以下命令（示例：签发一个对 `proj` 读写、对 `study` 只读的 Agent 令牌）：

```bash
capsa key create agent --scopes proj:rw,study:r
```

**预期输出**：
```text
Created key agent (ID: a1b2c3d4)
Scopes: proj:rw, study:r
Token: capsa_a1b2c3d4_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

> ⚠️ **新手必读警示**：
> 输出中的 `capsa_a1b2c3d4_...` 是用于登录 Web 页面和配置 Agent 的**明文令牌（Secret Token）**。  
> 出于安全考虑，数据库中仅存储该 Token 的 SHA256 哈希散列值。**此明文只会在控制台显示这一次，遗失无法找回**，请立即复制并妥善保存在密码管理器中！

---

## 六、步骤 4：配置 1Panel 反向代理与 SSL 证书

我们需要通过 1Panel 的 **网站** 模块，把域名解析、HTTPS 证书与回环端口 `127.0.0.1:8000` 串接起来。

### 1. 创建反向代理网站
1. 点击 1Panel 左侧菜单栏的 **网站** -> **网站**。
2. 点击 **创建网站**，选择 **反向代理**：
   - **主域名**：填写你的解析域名，例如 `memory.yourdomain.com`
   - **代理地址**：填写 `http://127.0.0.1:8000`
3. 点击 **确认** 完成基础网站创建。

### 2. 申请并配置 SSL 证书（HTTPS）
为了保护 Agent 令牌和数据传输安全，HTTPS 是必选条件。
1. 在刚刚创建的网站操作列点击 **配置**。
2. 切换到 **HTTPS** 页签，勾选 **启用 HTTPS**。
3. 选择 **自动签发**（通过 ACME 协议向 Let's Encrypt 免费申请）：
   - 如果已在 1Panel 证书管理配置过 DNS 凭据（如 Cloudflare API Key），优先选择 DNS 验证；
   - 否则选择 **HTTP 验证**（请确保 80 端口对公网放通且域名解析已生效）。
4. 勾选 **HTTP 跳转 HTTPS**，点击 **保存**。申请成功后，证书到期前 1Panel 会自动续签。

### 3. 配置流式响应直通（最核心的“防坑点”！）

Capsa 底层依托 **Model Context Protocol (MCP)** 协议与 Agent 通信，采用 Streamable HTTP（SSE / 分块流式下发）。
如果反向代理（Nginx/OpenResty）开启了“响应缓冲”，Nginx 会尝试攒齐一定大小的数据包再发送给客户端。这会导致一个典型故障：**客户端连接看起来成功了，但发起记忆查询时一直无响应、超时转圈圈**。

因此，必须在 1Panel 中关闭该站点的代理缓冲：

1. 在当前网站的配置页面，切换到 **反向代理** 页签。
2. 找到默认的代理规则（目标地址为 `http://127.0.0.1:8000`），点击 **编辑**。
3. 切换到 **高级** 设置或点击直接编辑代理配置代码（Nginx 规则块）：
4. 确认或追加以下两行关键配置：
   ```nginx
   proxy_buffering off;
   proxy_read_timeout 300s;
   ```
   - `proxy_buffering off;`：关闭响应缓冲，让 MCP 工具的输出实时逐块推送给客户端。
   - `proxy_read_timeout 300s;`：延长长轮询与流式调用的超时时间，避免复杂查询被提前掐断。
5. **关于请求体大小限制的说明**：
   请勿在 Nginx 中额外设置 `client_max_body_size`。Capsa 应用内部已严格内置了 1MB 请求体限制拦截器，超出自动返回标准 413 状态码。保持反向代理层职责单一即可。
6. 点击 **保存**，OpenResty 会自动重载配置生效。

---

## 七、步骤 5：连通性验证与体验

完成以上配置后，我们来逐一验证服务的各个维度是否正常。

### 1. 基础健康检查
在浏览器或本机终端访问健康检查端点：
```bash
curl -fsS https://memory.yourdomain.com/healthz
```
**正常响应**：
```json
{"status":"ok"}
```
如果返回 200 且状态为 `ok`，表明反向代理链路通畅、Capsa 服务运转正常且数据库已正确连接。

### 2. 访问 Web 管理台（Capsa Studio）
1. 使用电脑浏览器打开：`https://memory.yourdomain.com/`。
2. 页面会弹出登录输入框，在其中粘贴在 **步骤 3** 中保存的明文令牌：  
   `capsa_a1b2c3d4_...`
3. 点击登录后即可进入管理控制台：
   - **工作台**：按分组查看记忆列表、正文详情。
   - **时效复核中心**：查看临期需要复核的记忆条目。
   - **回收站**：检索和恢复软删除的记忆。

> 🔒 **隐私提示**：Capsa Web 台的身份凭据仅存放在浏览器的 `sessionStorage` 中，关闭网页标签页即刻清除退出，绝不会将凭据持久化在本地硬盘中。

### 3. 将 Capsa 接入 AI Agent（如 Claude / Cherry Studio / Cursor）

在任何支持 HTTP MCP 协议的客户端中，只需在配置文件中填入以下内容：

```json
{
  "mcpServers": {
    "capsa": {
      "type": "http",
      "url": "https://memory.yourdomain.com/mcp",
      "headers": {
        "Authorization": "Bearer capsa_a1b2c3d4_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

配置完成后，Agent 便可自动发现并调用 Capsa 的 7 个标准化工具（检索 `memory_search`、阅读正文 `memory_read`、保存记忆 `memory_save` 等）。

---

## 八、日常运维与自动化备份

数据安全是个人记忆系统的重中之重。Capsa 内置了 SQLite 在线安全快照功能。

### 1. 使用 1Panel 计划任务实现每日自动备份
1Panel 自带优秀的定时任务调度器，我们借此实现自动化冷热双备：

1. 点击 1Panel 左侧菜单栏的 **计划任务** -> **创建计划任务**。
2. 填写任务参数：
   - **任务名称**：`Capsa 每日热备`
   - **执行周期**：选择 **每天**，例如凌晨 `03:00`
   - **任务类型**：选择 **Shell 脚本**
3. 脚本内容填写：
   ```bash
   # 调用容器内的 capsa backup 命令，默认保留 14 天滚动快照
   docker exec capsa capsa backup /backup --keep-days 14
   ```
4. 保存后，可手动点击 **执行** 一次，查看执行日志确认备份文件生成正常。

### 2. 数据恢复（灾备演练）
如果因误操作或迁移需要恢复数据，只需在 1Panel 终端中执行：
```bash
# 1. 查看已有的备份文件
docker exec capsa ls -lh /backup

# 2. 从指定快照恢复（会覆盖当前数据库）
docker exec capsa capsa restore /backup/capsa-2026-03-30.db

# 3. 在 1Panel 容器列表重启 capsa 容器使恢复生效
```

---

## 九、常见问题与排错手册（FAQ）

| 故障现象 | 根因分析 | 解决方案 |
|---|---|---|
| **访问 `/healthz` 返回 503 错误** | 容器已启动，但未执行数据库初始化。 | 进入容器终端执行 `capsa init` 完成建表。 |
| **Agent 调用工具时持续超时无响应** | 反向代理开启了 `proxy_buffering`，缓冲了 SSE 流。 | 参考步骤 4，在 1Panel 网站反代配置中加入 `proxy_buffering off;`。 |
| **登录 Web 管理台提示 401 Unauthorized** | 令牌输入错误、格式有缺失，或该 Key 已被撤销。 | 确认复制的是完整的 `capsa_...` 47位串，或重新签发新 Key。 |
| **点击新建记忆提示无权限或按钮置灰** | 当前令牌的作用域中该分组仅有 `r`（只读）权限。 | 使用 `capsa key create` 重新签发含该分组 `:rw` 读写权限的令牌。 |
| **VPS 重启后数据是否会丢失？** | 不会。编排中使用了命名数据卷持久化存储。 | 只要不执行 `docker volume rm capsa-data`，数据永久保留。 |

---

## 十、总结

通过 1Panel 的可视化编排与反代管理，我们无需在黑漆漆的命令行里反复调试复杂的配置文件，只需以下清晰的五步节拍：
1. **拉取与编排**（Compose 绑定本地端口）
2. **终端初始化**（`init` 建表并签发明文 Key）
3. **网站反代**（绑定域名并一键开通 SSL）
4. **流式配置**（一键关闭 `proxy_buffering` 保证 MCP 响应）
5. **计划任务**（每日自动热备）

享受兼具私密性、安全感与现代可视化体验的个人专属 AI 记忆系统吧！
