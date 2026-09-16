# Tasks：Capsa 部署形态收敛 —— 单服务编排、宿主 TLS 与 CI 镜像交付

**关联 Plan**：`Plan.md` —— Capsa 部署形态收敛 v1.0
**总计 Task**：8 个
**回归基线**：`.venv/bin/python -m pytest -q` → 161 passed（规划时实测）
**回归结论**：`.venv/bin/python -m pytest -q` → 166 passed，0 failed，0 skipped（交付时实测）

---

## Phase 4.1：compose 收敛为单服务

### TASK-051：改写 docker-compose.yml 为单服务并删除 Caddyfile

- **Status**：DONE
- **Priority**：P0
- **Depends on**：无
- **Description**：把 `docker-compose.yml` 收敛为只含 `capsa` 一个服务的镜像拉取式编排，并删除仓库根的 `Caddyfile`。
- **Details**：
  - 服务集合恰为 `{capsa}`，删除整个 `caddy` 服务块
  - 服务内删除 `build:` 字段，改为 `image: ghcr.io/evan-1777/capsa:${CAPSA_TAG:-latest}`
  - 端口发布写为 `ports: ["${CAPSA_BIND:-127.0.0.1}:8000:8000"]`，默认只绑回环，容器化反代可用环境变量覆盖绑定地址
  - 删除 `expose:` 字段：它原先只服务于 compose 网络内的 caddy，单服务下由 `ports` 覆盖
  - 保留 `restart: unless-stopped`、`environment: [CAPSA_DB_PATH=/data/capsa.db]`、`volumes: [capsa-data:/data, capsa-backup:/backup]`
  - 顶层 `volumes` 收敛为 `capsa-data` 与 `capsa-backup`，删除 `caddy-data` 与 `caddy-config`
  - 不在 compose 内声明 `healthcheck`：镜像 `Dockerfile` 已含 `HEALTHCHECK` 指向 `/healthz`，且单服务后不存在 `depends_on` 健康门控
  - 删除 `Caddyfile`（`git rm`），其 `max_size 1MB` 职责由应用层 `RequestBodyLimitMiddleware` 唯一承担
- **Acceptance Criteria**：
  - `docker compose config` 的等价静态断言：`yaml.safe_load` 无异常，`set(compose["services"]) == {"capsa"}`
  - `compose["services"]["capsa"]` 无 `build` 键，`image` 以 `ghcr.io/` 开头且以 `/capsa` 结尾
  - `set(compose["volumes"]) == {"capsa-data", "capsa-backup"}`
  - 仓库根 `Caddyfile` 不存在，`git status` 中该项显示为删除
  - `grep -r "caddy" docker-compose.yml` 无输出

### TASK-052：按新契约改写编排静态校验用例

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-051
- **Description**：把 `tests/test_phase3_deploy.py` 重命名为 `tests/test_deploy.py` 并按其断言对象改写，使静态校验对应 Phase 4 的单服务编排契约。
- **Details**：
  - `git mv tests/test_phase3_deploy.py tests/test_deploy.py`，文件名去掉历史阶段前缀，断言对象是当前部署契约而非某一阶段
  - 改写 `test_compose_services_volumes_and_health_dependency` → 断言单服务、无 `build`、`image` 指向 GHCR、`restart`、卷集合、`CAPSA_DB_PATH` 环境变量
  - 新增断言：`ports` 默认绑定 `127.0.0.1`，且映射串含 `${CAPSA_BIND:-127.0.0.1}` 与 `8000:8000`
  - 删除 `test_caddyfile_matches_the_request_body_contract`：被断言的文件已移除
  - 保留 `test_dockerfile_is_multi_stage_and_never_runs_as_root`、`test_frontend_build_output_path_matches_the_copy_source`、`test_cron_line_is_documented` 三条不改动
  - 断言指向具体字符串与具体集合，不使用「包含任意内容」式弱断言
- **Acceptance Criteria**：
  - `.venv/bin/python -m pytest tests/test_deploy.py -v` 退出码 0
  - 用例中不再有解析 `Caddyfile` 内容的断言
  - 断言 `set(compose["services"]) == {"capsa"}` 为集合相等而非子集判断

---

## Phase 4.2：CI 镜像构建工作流

### TASK-053：新增手动触发的 GHCR 镜像构建工作流

- **Status**：DONE
- **Priority**：P0
- **Depends on**：无（`Dockerfile` 已自包含）
- **Description**：新增 `.github/workflows/build-image.yml`，以手动触发方式构建镜像并推送到 GitHub Container Registry。
- **Details**：
  - 触发器仅 `on: workflow_dispatch`，输入 `tag`（`type: string`、`required: false`、`default: latest`、描述为中文）
  - 权限最小化：`permissions: contents: read` 与 `packages: write`
  - 单 job，`runs-on: ubuntu-latest`，步骤顺序：`actions/checkout@v4` → `docker/setup-buildx-action@v3` → 计算小写镜像名 → `docker/login-action@v3` → `docker/build-push-action@v6`
  - 镜像名在一个独立 step 内派生：`echo "image=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_OUTPUT"`，用 bash 的小写展开，不引入 `docker/metadata-action`
  - 登录用 `registry: ghcr.io`、`username: ${{ github.actor }}`、`password: ${{ secrets.GITHUB_TOKEN }}`，不新增任何自定义 Secrets
  - 构建参数：`context: .`、`file: ./Dockerfile`、`push: true`、`tags: ${{ steps.meta.outputs.image }}:${{ inputs.tag }}`、`cache-from: type=gha`、`cache-to: type=gha,mode=max`
  - 工作流顶部注释写明：手动触发的原因、镜像去向 GHCR、私有仓库用户拉取镜像需先 `docker login ghcr.io`
  - 不运行测试套件，不上传任何 artifact，不配置 push/tag 自动触发
- **Acceptance Criteria**：
  - `.venv/bin/python -c "import yaml;yaml.safe_load(open('.github/workflows/build-image.yml'))"` 退出码 0
  - 工作流文件中仅存在 `workflow_dispatch` 一个触发器
  - 工作流文件中不出现 `secrets.` 以外的自定义密钥名（只允许 `secrets.GITHUB_TOKEN`）
  - `push:` 为 `true`，`context:` 为 `.`

### TASK-054：新增工作流静态校验用例

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-053
- **Description**：新增 `tests/test_ci_workflow.py`，对工作流的触发器、权限、登录与构建参数做逐字段静态断言。
- **Details**：
  - 解析用 `yaml.safe_load`；PyYAML 按 YAML 1.1 规则会把未加引号的键 `on` 解析为布尔 `True`，断言须兼容两种取值（`workflow.get("on") or workflow.get(True)`），不得因该解析行为写出必失败的用例
  - 断言触发器集合恰为 `{"workflow_dispatch"}`，且输入 `tag` 的 `default` 为 `latest`
  - 断言 `permissions` 中 `packages` 为 `write`、`contents` 为 `read`
  - 断言存在使用 `docker/login-action` 的步骤，其 `with.registry` 为 `ghcr.io`、`with.password` 含 `secrets.GITHUB_TOKEN`
  - 断言存在使用 `docker/build-push-action` 的步骤，其 `with.push` 为 `True`、`with.context` 为 `.`、`with.tags` 含 `inputs.tag`
  - 断言 `on` 段的键集合恰为 `{"workflow_dispatch"}`（`on` 解析结果的键，而非文件全文匹配）；`push` 与 `pull_request` 因此自然被排除，`push:` 作为步骤参数出现不影响该断言
- **Acceptance Criteria**：
  - `.venv/bin/python -m pytest tests/test_ci_workflow.py -v` 退出码 0
  - 用例不依赖 GitHub Actions 运行时，纯静态解析文件即可通过
  - 断言指向具体键与具体值

---

## Phase 4.3：README 与文档同步

### TASK-055：撰写 README.md

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-051、TASK-053
- **Description**：在仓库根新增 `README.md`，覆盖定位、架构、部署、宿主 TLS 接入、运维、CLI 与文档索引。
- **Details**：
  - 章节顺序：项目定位 → 能力与边界 → 架构（含自包含 HTML 可视化）→ 部署到 VPS → 宿主反向代理与 TLS → 初始化与凭据 → 接入 MCP → Web 管理台 → 备份与恢复 → 镜像构建 → 运维命令速查 → 目录结构 → 文档索引
  - 架构可视化用单个自包含 HTML 片段呈现「公网 → 宿主反代（TLS 终止）→ 容器 `127.0.0.1:8000` → 数据卷」的链路与职责分界，纯内联样式，不引入图片与外链
  - 部署章节的步骤可逐条执行：`docker login ghcr.io`（PAT 需 `read:packages`）→ 拉取镜像 → 准备 compose 与数据目录 → `capsa init` → 签发 Key → `docker compose up -d` → `curl /healthz` 验证
  - 宿主 TLS 接入写两种形态：宿主进程反向代理指向 `127.0.0.1:8000`，以及容器化反代加入同一网络时用 `CAPSA_BIND` 覆盖绑定地址；两种都给出请求体上限只在应用层配置的说明
  - 宿主反代关闭响应缓冲：原 `Caddyfile` 的 `flush_interval -1` 承担 MCP 流式下发职责，移除后该要求随边缘层转移；README 须给出 Nginx 的 `proxy_buffering off`、`proxy_http_version 1.1`、`proxy_read_timeout 300s` 三条指令，并写明「连接成功但工具结果迟迟不返回」这一症状
  - CLI 速查列出 `init` / `group` / `key` / `memory` / `review` / `backup` / `restore` 的实际用法，命令从 `capsa/cli.py` 读取，不凭记忆编写
  - MCP 接入给出端点 `/mcp`、Bearer 鉴权方式与一条可复制的客户端配置片段
  - 镜像构建写清：手动触发 CI（命令行 `gh workflow run` 与网页入口两种）、标签含义、本地 `docker build` 的等价命令
  - 备份章节保留既有 Cron 一行配置，并说明 `CAPSA_TAG` / `CAPSA_BIND` 两个可选环境变量
  - 不写开发过程、不写未实现能力、不复制设计文档推演；不出现 TODO 与占位文案
- **Acceptance Criteria**：
  - README 中出现的每个仓库内路径都实际存在（`docker-compose.yml`、`Dockerfile`、`capsa/`、`web/`、`.docs/Project.md`、`.docs/SCOPE.md`）
  - README 中出现的每条 `capsa` 子命令与 `docker compose` 命令与 `capsa/cli.py`、`docker-compose.yml` 的实际定义一致
  - README 中不出现 `Caddyfile` 或把 Caddy 作为当前组件
  - README 的宿主反代章节含 `proxy_buffering off`，且不把请求体上限写成宿主侧必需配置
  - 架构可视化片段为自包含 HTML，不含 `<!DOCTYPE>`、`<html>`、`<body>` 或装饰性插图

### TASK-056：同步 .docs/Project.md 至单服务部署形态

- **Status**：DONE
- **Priority**：P1
- **Depends on**：TASK-051、TASK-053、TASK-055
- **Description**：按 Phase 4 实际产出校正 `.docs/Project.md` 的编排、目录结构、运行方式与决策记录。
- **Details**：
  - §1 当前阶段改为 Phase 4（单服务编排、宿主 TLS、CI 镜像交付）完成
  - §2「运行平台」补镜像来源与部署方式；「定时热备」保留原 Cron 行（命令未变）；新增「如何构建镜像」小节写清 CI 手动触发与本地 `docker build`
  - §3 目录结构：删除 `Caddyfile`，新增 `README.md`、`.github/workflows/build-image.yml`、`tests/test_deploy.py`、`tests/test_ci_workflow.py`，删除 `tests/test_phase3_deploy.py`
  - §4 架构与数据流新增「部署形态」一条：宿主反代终止 TLS → 容器 `8000` → 数据卷；说明请求体上限只在应用层
  - §6 约束与已知坑新增：私有 GHCR 包需先 `docker login ghcr.io`；compose 端口默认绑回环，容器化反代须覆盖 `CAPSA_BIND`
  - §8 决策记录新增本阶段条目：TLS 归宿主、compose 只拉不构建、端口默认回环、健康检查只留 Dockerfile、CI 仅手动触发、归档文档不回溯改写
  - 逐条按 §0 维护速查表落位，不改写与本次变更无关的章节
- **Acceptance Criteria**：
  - Project.md 的定位、运行方式、目录结构与架构各节不含 Caddy；仅 §6 与 §8 作为已移除项的历史记录出现
  - Project.md 中出现的每个文件路径在仓库中实际存在或已删除项不再出现
  - §8 新增条目与 `Plan.md` §4 的决策表逐条对应，无相互矛盾

---

## Phase 4.4：建仓、推送与镜像验收

### TASK-057：创建 GitHub 私有仓库并推送

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-052、TASK-054、TASK-056
- **Description**：把本地 `master` 的全部历史推送到新建的 GitHub 私有仓库。
- **Details**：
  - 推送前扫描：`git status --porcelain` 为空；`git ls-files` 不含 `.venv/`、`.devtools/`、`node_modules/`、`capsa/static/`、`*.db`、`.env`、`web/tests/keys.json`
  - 历史扫描：`git log --all --diff-filter=A --name-only --pretty=format:` 的输出中不含上述敏感路径；对 tracked 文本文件按正则 `capsa_[a-z0-9]{8}_[A-Za-z0-9_-]{32}` 与 `BEGIN .*PRIVATE KEY` 扫描，命中即中止。该正则要求完整令牌形态，测试中的 `capsa_invalid` / `capsa_nope` 等字面量不匹配（规划时实测全库 0 命中）
  - 建仓：`gh repo create Capsa --private --source=. --remote=origin --push`，仓库名与项目名一致，owner 为当前登录账号
  - 若仓库已存在则改为 `git remote add origin` 加 `git push -u origin master`，不重复建仓
  - 推送后校验：`gh repo view --json name,visibility,defaultBranchRef` 的 `visibility` 为 `PRIVATE`，`defaultBranchRef.name` 为 `master`
  - 校验远端与本地一致：`git rev-parse HEAD` 与 `git rev-parse origin/master` 相等
  - 不推送 tag，不创建 Release，不改动 git 配置
- **Acceptance Criteria**：
  - `gh repo view --json visibility -q .visibility` 输出 `PRIVATE`
  - `git rev-parse HEAD` 与 `git rev-parse origin/master` 输出相同
  - `gh api repos/{owner}/Capsa --jq .private` 输出 `true`
  - 推送后 `git status --porcelain` 为空

### TASK-058：手动触发 CI 构建并确认 GHCR 镜像版本

- **Status**：DONE
- **Priority**：P0
- **Depends on**：TASK-057
- **Description**：在远端仓库手动触发镜像构建工作流，确认构建成功且 GHCR 上出现对应标签的镜像版本。
- **Details**：
  - 触发：`gh workflow run build-image.yml -f tag=v0.1.0`（标签与 `pyproject.toml` 的版本对齐）
  - 等待并观察：`gh run watch` 直至运行结束，退出码 0
  - 从运行日志确认推送发生：`gh run view --log` 中 `build-push-action` 步骤含 `digest: sha256:` 与推送目标镜像名
  - 最好再经包接口核对版本：`gh api /user/packages/container/capsa/versions`；当前 gh 令牌未包含 `read:packages` 时该接口返回 403，此时以上一条的推送日志作为验收证据并在交付报告中注明
  - 确认镜像名与 compose 中的 `image` 完全一致（含小写 owner 名）
  - 不修改工作流以适配本次运行；若运行失败，修复工作流后重新触发，不重跑同一失败的 sha
- **Acceptance Criteria**：
  - `gh run list --workflow=build-image.yml --limit 1` 的最新运行 `conclusion` 为 `success`
  - 运行日志中存在 `digest: sha256:` 与 `ghcr.io/evan-1777/capsa:v0.1.0` 字样
  - GHCR 上可见该标签的版本（或已在交付报告中注明接口权限受限，以推送日志为证）

---

## 交付链附加约定

以下为 Execute 之后各阶段的执行口径，不属于 Task 清单。

| 阶段 | 约定 |
|------|------|
| Test | 以 `.venv/bin/python -m pytest -q` 为准，用例数不少于 161 且全绿；本次不涉及前端改动，不跑 Playwright |
| 本机不可验证项 | `docker compose pull`、`docker compose up -d`、宿主反代与 TLS 接入、GHCR 私有包的实际拉取；前三项由用户在 VPS 验收，第四项由 TASK-058 的推送日志间接验证 |
| Document Maintenance | 完成 TASK-056；清理 `.pytest_cache/`、`__pycache__/` 等一次性产物 |
| Archive | 归档目录 `.docs/09-16-v1/`；须先确认 Plan.md 与 Tasks.md 已标注 `状态：DONE`、完成日期与回归测试结论 |
| Git Commit | Conventional Commits 英文类型前缀加中文正文；不提交 `*.db`、`node_modules/`、`capsa/static/`、任何令牌文件 |
