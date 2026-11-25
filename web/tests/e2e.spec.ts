import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const keys = JSON.parse(readFileSync(join(here, "keys.json"), "utf-8")) as {
  admin: string;
  rw: string;
};

async function signIn(page: Page, key: string) {
  await page.goto("/");
  await page.getByLabel("API Key").fill(key);
  await page.getByRole("button", { name: "连接" }).click();
  await expect(page.getByRole("navigation", { name: "主视图" })).toBeVisible();
}

async function openDrawer(page: Page, group = "proj") {
  await page.getByRole("button", { name: "新建记忆" }).first().click();
  await expect(page.getByRole("heading", { name: "新建记忆" })).toBeVisible();
  await page.getByLabel("组别", { exact: true }).selectOption(group);
}

test("1. 凭据只存 sessionStorage，退出即清空", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "连接" })).toBeVisible();
  await signIn(page, keys.admin);
  expect(await page.evaluate(() => sessionStorage.getItem("capsa_key"))).toBe(keys.admin);

  await page.getByRole("button", { name: "退出" }).click();
  await expect(page.getByRole("button", { name: "连接" })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("capsa_key"))).toBeNull();
});

test("2. 失效凭据在 401 后回到锁屏", async ({ page }) => {
  await signIn(page, keys.admin);
  await page.evaluate(() => sessionStorage.setItem("capsa_key", "capsa_deadkey_000000000000000000000000000000"));
  await page.getByRole("button", { name: "回收站" }).click();
  await expect(page.getByText("凭据无效或已被吊销")).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("capsa_key"))).toBeNull();
});

test("3. 登录页不发起业务请求，无凭据时不进入主视图", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "主视图" })).toHaveCount(0);
  await expect(page.getByText("输入管理员 API Key 以继续")).toBeVisible();
});

test("4. 非管理员凭据登录被拦截", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("API Key").fill(keys.rw);
  await page.getByRole("button", { name: "连接" }).click();
  await expect(page.getByText("管理台仅支持管理员凭据登录（需 *:rw 权限）")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主视图" })).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem("capsa_key"))).toBeNull();
});

test("5. Markdown 管道拦截脚本、事件属性与伪协议", async ({ page }) => {
  await signIn(page, keys.admin);
  await page.getByLabel("检索记忆").fill("XSS 探针");
  await openDrawer(page);

  const payload = [
    "<script>window.xss_flag=true;</script>",
    '<img src=x onerror="window.xss_flag=true">',
    "[点击](javascript:window.xss_link=true)",
    "[数据](data:text/html,<script>window.xss_flag=true</script>)",
  ].join("\n\n");
  await page.getByLabel("标题").fill("XSS 探针");
  await page.getByLabel("摘要").fill("净化管道");
  await page.getByLabel("正文").fill(payload);
  await page.getByRole("button", { name: "创建" }).click();

  await page.getByRole("button", { name: /XSS 探针/ }).first().click();
  await expect(page.getByRole("article")).toBeVisible();
  expect(await page.evaluate(() => (window as never as { xss_flag?: boolean }).xss_flag)).toBeUndefined();
  expect(await page.evaluate(() => (window as never as { xss_link?: boolean }).xss_link)).toBeUndefined();
  await expect(page.locator("script", { hasText: "xss_flag" })).toHaveCount(0);
  await expect(page.locator("[onerror]")).toHaveCount(0);
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(page.locator('a[href^="data:"]')).toHaveCount(0);
});

test("6. Markdown 保留安全链接形态", async ({ page }) => {
  await signIn(page, keys.admin);
  await openDrawer(page);
  await page.getByLabel("标题").fill("链接形态探针");
  await page.getByLabel("摘要").fill("外链与邮件链接");
  await page.getByLabel("正文").fill("[站点](https://example.com)\n\n[邮件](mailto:ops@example.com)");
  await page.getByRole("button", { name: "创建" }).click();

  await page.getByRole("button", { name: /链接形态探针/ }).first().click();
  const external = page.locator('a[href="https://example.com"]');
  await expect(external).toHaveAttribute("target", "_blank");
  await expect(external).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.locator('a[href="mailto:ops@example.com"]')).toHaveCount(1);
});

test("7. 标题超限时标红并禁用提交", async ({ page }) => {
  await signIn(page, keys.admin);
  await openDrawer(page);
  await page.getByLabel("标题").fill("长".repeat(61));
  await expect(page.getByText("61/60")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("button", { name: "创建" })).toBeDisabled();
  await page.getByLabel("标题").fill("六十字标题");
  await expect(page.getByRole("button", { name: "创建" })).toBeEnabled();
});

test("8. 全流程：新建、检索、编辑状态切换、软删除、恢复", async ({ page }) => {
  const title = `流程探针-${Date.now()}`;
  await signIn(page, keys.admin);
  await openDrawer(page);
  await page.getByLabel("标题").fill(title);
  await page.getByLabel("摘要").fill("流程摘要");
  await page.getByLabel("正文").fill("- 第一步\n- 第二步");
  await page.getByRole("button", { name: "创建" }).click();

  await page.getByLabel("检索记忆").fill(title);
  const row = page.getByRole("button", { name: new RegExp(title) }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByRole("article").getByRole("listitem")).toHaveCount(2);

  await page.getByRole("button", { name: "编辑记忆" }).click();
  await page.getByLabel("摘要").fill("流程摘要已更新");
  await page.getByRole("radiogroup", { name: "记忆状态" }).getByRole("radio", { name: "持久" }).click();
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("流程摘要已更新")).toBeVisible();
  await expect(page.getByRole("article").getByText("持久")).toBeVisible();

  await page.getByRole("button", { name: "编辑记忆" }).click();
  await page.getByRole("radiogroup", { name: "记忆状态" }).getByRole("radio", { name: "常规" }).click();
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("article").getByText("浅层")).toBeVisible();

  await page.getByRole("button", { name: "删除记忆" }).click();
  await page.getByLabel("删除原因").fill("流程验证");
  await page.getByRole("button", { name: "移入回收站" }).click();

  await page.getByRole("button", { name: "回收站", exact: true }).click();
  await expect(page.getByText(/流程验证/).first()).toBeVisible();
  await page.getByRole("button", { name: new RegExp("恢复 " + title) }).click();
  await expect(page.getByText("流程验证")).toHaveCount(0);

  await page.getByRole("button", { name: "记忆工作台" }).click();
  await page.getByLabel("检索记忆").fill(title);
  await expect(page.getByRole("button", { name: new RegExp(title) }).first()).toBeVisible();
});

test("9. 组别管理的新建与编辑即时联动工作台", async ({ page }) => {
  const slug = `lab${Date.now() % 100000}`;
  await signIn(page, keys.admin);
  await page.getByRole("button", { name: "组别管理" }).click();

  await page.getByRole("button", { name: "新建组别" }).first().click();
  await page.getByLabel("组别标识").fill(slug);
  await page.getByLabel("组别名称").fill("实验室");
  await page.getByLabel("组别描述").fill("实验记录");
  await page.getByRole("button", { name: "创建" }).click();

  const card = page.locator("li", { hasText: slug });
  await expect(card).toContainText("实验室");
  await card.getByRole("button", { name: /编辑组别/ }).click();
  await expect(page.getByLabel("组别标识")).toBeDisabled();
  await page.getByLabel("组别名称").fill("实验室二部");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(card).toContainText("实验室二部");

  await page.getByRole("button", { name: "记忆工作台" }).click();
  await expect(page.getByRole("button", { name: "实验室二部" })).toBeVisible();
  await openDrawer(page, slug);
  await page.getByLabel("标题").fill("实验室条目");
  await page.getByLabel("摘要").fill("联动验证");
  await page.getByLabel("正文").fill("新组别下的记忆");
  await page.getByRole("button", { name: "创建" }).click();

  await page.getByLabel("检索记忆").fill("实验室条目");
  await expect(page.getByRole("button", { name: /实验室条目/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "实验室二部" })).toBeVisible();
});

test("10. 移动端 375px 单栏与抽屉全屏", async ({ page }) => {
  const title = "移动端探针";
  await signIn(page, keys.admin);
  await openDrawer(page);
  await page.getByLabel("标题").fill(title);
  await page.getByLabel("摘要").fill("响应式验证");
  await page.getByLabel("正文").fill("单栏详情");
  await page.getByRole("button", { name: "创建" }).click();

  await page.setViewportSize({ width: 375, height: 667 });
  await page.getByRole("button", { name: "返回" }).click();
  await page.getByLabel("检索记忆").fill(title);
  await page.getByRole("button", { name: new RegExp(title) }).first().click();
  await expect(page.getByRole("button", { name: "返回" })).toBeVisible();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  await page.getByRole("button", { name: "返回" }).click();
  await openDrawer(page);
  const drawer = page.getByRole("heading", { name: "新建记忆" }).locator("..");
  const box = await drawer.boundingBox();
  expect(Math.round(box?.width ?? 0)).toBe(375);
});

test("11. 组别管理：新建空组别成功删除，含记忆组别删除阻断", async ({ page }) => {
  const emptySlug = `empty${Date.now() % 100000}`;
  const memSlug = `memgrp${Date.now() % 100000}`;
  await signIn(page, keys.admin);
  await page.getByRole("button", { name: "组别管理" }).click();

  await page.getByRole("button", { name: "新建组别" }).first().click();
  await page.getByLabel("组别标识").fill(emptySlug);
  await page.getByLabel("组别名称").fill("待删空组别");
  await page.getByRole("button", { name: "创建" }).click();

  const emptyCard = page.locator("li", { hasText: emptySlug });
  await expect(emptyCard).toBeVisible();
  await emptyCard.getByRole("button", { name: /删除组别/ }).click();
  await expect(page.getByRole("heading", { name: "删除组别" })).toBeVisible();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(emptyCard).toHaveCount(0);

  await page.getByRole("button", { name: "新建组别" }).first().click();
  await page.getByLabel("组别标识").fill(memSlug);
  await page.getByLabel("组别名称").fill("含记忆组别");
  await page.getByRole("button", { name: "创建" }).click();

  await page.getByRole("button", { name: "记忆工作台" }).click();
  await openDrawer(page, memSlug);
  await page.getByLabel("标题").fill("不可删组别条目");
  await page.getByLabel("摘要").fill("阻断验证");
  await page.getByLabel("正文").fill("测试正文");
  await page.getByRole("button", { name: "创建" }).click();

  await page.getByRole("button", { name: "组别管理" }).click();
  const memCard = page.locator("li", { hasText: memSlug });
  await expect(memCard).toBeVisible();
  await memCard.getByRole("button", { name: /删除组别/ }).click();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByRole("alert")).toContainText("仍有记忆（含回收站），禁止删除");
  await page.getByRole("button", { name: "取消" }).click();
  await expect(memCard).toBeVisible();
});

test("12. 凭据管理：签发组别 Key、编辑权限、单次明文披露、吊销与物理删除", async ({ page }) => {
  const keyName = `AgentKey-${Date.now() % 100000}`;
  const renamedKey = keyName + "-Edit";
  await signIn(page, keys.admin);
  await page.getByRole("button", { name: "凭据管理" }).click();
  await expect(page.getByRole("heading", { name: "凭据管理" })).toBeVisible();

  await page.getByRole("button", { name: "签发 Key" }).first().click();
  await expect(page.getByRole("heading", { name: "签发新 Key" })).toBeVisible();

  await page.getByRole("radiogroup", { name: "权限模式" }).getByRole("radio", { name: "按组别配置" }).click();
  await expect(page.getByText("请至少为一个组别授予权限")).toBeVisible();
  await expect(page.getByRole("button", { name: "签发", exact: true })).toBeDisabled();

  await page.getByLabel("Key 名称").fill(keyName);
  await page.getByRole("radiogroup", { name: /权限$/ }).first().getByRole("radio", { name: "只读" }).click();
  await expect(page.getByText("请至少为一个组别授予权限")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "签发", exact: true })).toBeEnabled();

  await page.getByRole("button", { name: "签发", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Key 签发成功" })).toBeVisible();
  await expect(page.getByText("明文令牌仅展示一次")).toBeVisible();
  await expect(page.getByRole("button", { name: "复制令牌" })).toBeVisible();

  await page.getByRole("button", { name: "我已保存并关闭" }).click();
  await expect(page.getByRole("heading", { name: "Key 签发成功" })).toHaveCount(0);

  const keyCard = page.locator("li", { hasText: keyName });
  await expect(keyCard).toBeVisible();
  await expect(keyCard.getByText("有效")).toBeVisible();

  // 在线编辑名称与权限
  await keyCard.getByRole("button", { name: /编辑凭据/ }).click();
  await expect(page.getByRole("heading", { name: "编辑 Key" })).toBeVisible();
  await page.getByLabel("Key 名称").fill(renamedKey);
  await page.getByRole("radiogroup", { name: /权限$/ }).first().getByRole("radio", { name: "读写" }).click();
  await page.getByRole("button", { name: "保存" }).click();

  const updatedCard = page.locator("li", { hasText: renamedKey });
  await expect(updatedCard).toBeVisible();
  await expect(updatedCard).toContainText("RW");

  // 吊销
  await updatedCard.getByRole("button", { name: /吊销凭据/ }).click();
  await expect(page.getByRole("heading", { name: "吊销 Key" })).toBeVisible();
  await page.getByRole("button", { name: "确认吊销" }).click();
  await expect(updatedCard.getByText("已吊销")).toBeVisible();

  // 物理删除
  await updatedCard.getByRole("button", { name: /删除凭据/ }).click();
  await expect(page.getByRole("heading", { name: "删除 Key" })).toBeVisible();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(updatedCard).toHaveCount(0);
});

test("13. MD3 主题亮暗切换与窄屏模态抽屉导航", async ({ page }) => {
  await signIn(page, keys.admin);

  // 1. 首帧即挂载明确的亮暗属性，切换后 localStorage 同步
  const before = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  expect(before === "light" || before === "dark").toBeTruthy();
  await page
    .getByRole("button", { name: before === "dark" ? "切换至浅色模式" : "切换至深色模式" })
    .click();
  const after = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  expect(after).not.toBe(before);
  expect(await page.evaluate(() => localStorage.getItem("capsa_theme"))).toBe(after);
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--md-sys-color-surface").trim(),
    ),
  ).not.toBe("");

  // 2. 窄屏唤起模态导航抽屉、关闭后还原焦点并完成跳转
  await page.setViewportSize({ width: 375, height: 667 });
  const navTrigger = page.getByRole("button", { name: "打开导航菜单" });
  await navTrigger.click();
  await expect(page.getByRole("button", { name: "关闭导航菜单" })).toBeVisible();
  await page.getByRole("button", { name: "关闭导航菜单" }).click();
  await expect(page.getByRole("button", { name: "关闭导航菜单" })).toHaveCount(0);
  await expect(navTrigger).toBeFocused();

  await navTrigger.click();
  await expect(page.getByRole("button", { name: "关闭导航菜单" })).toBeVisible();
  await page.getByRole("button", { name: "组别管理" }).click();
  await expect(page.getByRole("heading", { name: "组别管理" })).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭导航菜单" })).toHaveCount(0);

  // 3. 抽屉打开时跨入桌面断点须自动关闭且不遗留 inert 锁定
  await page.getByRole("button", { name: "打开导航菜单" }).click();
  await expect(page.getByRole("button", { name: "关闭导航菜单" })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByRole("button", { name: "关闭导航菜单" })).toHaveCount(0);
  await page.getByRole("button", { name: "凭据管理" }).click();
  await expect(page.getByRole("heading", { name: "凭据管理" })).toBeVisible();
});

async function openWorkspaceSettings(page: Page) {
  await page.getByRole("button", { name: "工作区设置" }).click();
  await expect(page.getByRole("heading", { name: "工作区设置" })).toBeVisible();
}

async function createWorkspace(page: Page, name: string, mode: "memory" | "docs") {
  await page.getByRole("button", { name: "新建工作区" }).first().click();
  await expect(page.getByRole("heading", { name: "新建工作区" })).toBeVisible();
  await page.getByLabel("工作区名称").fill(name);
  await page.getByLabel("工作区模式").selectOption(mode);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator("li", { hasText: name })).toBeVisible();
}

function noHorizontalOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
}

test("14. 全局工作区设置：创建记忆与文档工作区、编辑信息、非空删除阻断、空工作区删除与窄屏/焦点校验", async ({ page }) => {
  const stamp = String(Date.now() % 1000000);
  const memoryName = "记忆区-" + stamp;
  const docsName = "文档区-" + stamp;
  const emptyName = "空区-" + stamp;
  await signIn(page, keys.admin);

  await openWorkspaceSettings(page);

  // 新建弹窗：焦点落入弹窗内，Escape 可关闭
  await page.getByRole("button", { name: "新建工作区" }).first().click();
  await expect(page.getByRole("heading", { name: "新建工作区" })).toBeVisible();
  expect(
    await page.evaluate(() => {
      const dialog = document.querySelector("dialog[open]");
      return Boolean(dialog && document.activeElement && dialog.contains(document.activeElement));
    }),
  ).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "新建工作区" })).toHaveCount(0);

  await createWorkspace(page, memoryName, "memory");
  await createWorkspace(page, docsName, "docs");

  // 切换至新记忆工作区后，组别与默认记忆工作区严格隔离
  await page
    .locator("li", { hasText: memoryName })
    .getByRole("button", { name: "切换" })
    .click();
  await expect(page.getByRole("navigation", { name: "主视图" })).toBeVisible();
  await expect(page.getByRole("button", { name: "项目", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("切换工作区").locator("option:checked")).toHaveText(
    new RegExp(memoryName),
  );

  // 编辑工作区名称，模式锁定不可改
  await openWorkspaceSettings(page);
  await page.locator("li", { hasText: memoryName }).getByRole("button", { name: /编辑工作区/ }).click();
  await expect(page.getByRole("heading", { name: "编辑工作区" })).toBeVisible();
  await expect(page.getByLabel("工作区模式")).toBeDisabled();
  const renamed = memoryName + "-改";
  await page.getByLabel("工作区名称").fill(renamed);
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.locator("li", { hasText: renamed })).toBeVisible();

  // 当前激活工作区在设置视图内以「当前工作区」呈现，经返回按钮回到主视图
  await page.getByRole("button", { name: "返回当前工作区" }).click();
  await expect(page.getByRole("navigation", { name: "主视图" })).toBeVisible();

  // 新工作区内建组别后，删除工作区被原子阻断
  await page.getByRole("button", { name: "组别管理" }).click();
  await page.getByRole("button", { name: "新建组别" }).first().click();
  await page.getByLabel("组别标识").fill("lab" + stamp);
  await page.getByLabel("组别名称").fill("实验室");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator("li", { hasText: "lab" + stamp })).toBeVisible();

  await openWorkspaceSettings(page);
  await page.locator("li", { hasText: renamed }).getByRole("button", { name: /删除工作区/ }).click();
  await expect(page.getByRole("heading", { name: "删除工作区" })).toBeVisible();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByRole("alert")).toContainText("工作区下仍有内容，禁止删除");
  await page.getByRole("button", { name: "取消" }).click();

  // 空工作区删除成功
  await createWorkspace(page, emptyName, "memory");
  await page.locator("li", { hasText: emptyName }).getByRole("button", { name: /删除工作区/ }).click();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page.locator("li", { hasText: emptyName })).toHaveCount(0);

  // 窄屏无横向溢出
  await page.setViewportSize({ width: 375, height: 667 });
  expect(await noHorizontalOverflow(page)).toBeTruthy();
});

test("15. 文档工作区全流程：公共文档与子项目导航、访问 ID 弹层复制轮换、在线编辑与 375px 窄屏无溢出", async ({
  page,
  context,
}) => {
  const stamp = String(Date.now() % 1000000);
  const docsName = "文档全流程-" + stamp;
  const subprojectName = "规范-" + stamp;
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, keys.admin);

  await openWorkspaceSettings(page);
  await createWorkspace(page, docsName, "docs");
  await page
    .locator("li", { hasText: docsName })
    .getByRole("button", { name: "切换" })
    .click();

  // 传统记忆视图在文档工作区下完全不出现
  for (const label of ["记忆工作台", "组别管理", "凭据管理", "回收站"]) {
    await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole("button", { name: /公共文档/ }).first()).toBeVisible();

  // 公共文档：新建、面包屑与安全渲染
  await page.getByRole("button", { name: "新建文档" }).first().click();
  await expect(page.getByRole("heading", { name: "新建文档" })).toBeVisible();
  await page.getByLabel("文档路径").fill("guides/overview.md");
  await page
    .getByLabel("初始正文")
    .fill("[站点](https://example.com)\n\n<script>window.doc_xss=true</script>");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.getByRole("heading", { name: "overview.md" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "文档面包屑" }).getByRole("button", { name: "guides" }),
  ).toBeVisible();
  await expect(page.locator('a[href="https://example.com"]')).toHaveAttribute("target", "_blank");
  expect(await page.evaluate(() => (window as never as { doc_xss?: boolean }).doc_xss)).toBeUndefined();
  await expect(page.locator("script", { hasText: "doc_xss" })).toHaveCount(0);

  // 在线编辑保存
  await page.getByRole("button", { name: "编辑" }).click();
  await page.getByLabel("文档正文").fill("# 公共规范\n\n- 条目一\n- 条目二");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("article").getByRole("listitem")).toHaveCount(2);

  // 新建子项目并在接入与设置弹层中完成访问 ID 复制与轮换
  await page.getByRole("button", { name: "新建子项目" }).first().click();
  await expect(page.getByRole("heading", { name: "新建子项目" })).toBeVisible();
  await page.getByLabel("子项目名称").fill(subprojectName);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.getByRole("button", { name: new RegExp("^" + subprojectName) }).first().click();

  await page.getByRole("button", { name: new RegExp("子项目设置 " + subprojectName) }).first().click();
  await expect(page.getByText("子项目访问 ID")).toBeVisible();
  await expect(page.locator("code", { hasText: "/mcp/docs?token=" })).toBeVisible();

  const accessCode = page.locator("code", { hasText: "capsa_doc_" }).first();
  const beforeAccess = ((await accessCode.textContent()) ?? "").trim();
  expect(beforeAccess.startsWith("capsa_doc_")).toBeTruthy();

  // 复制访问 ID
  await page.getByRole("button", { name: "复制访问 ID" }).click();
  await expect(page.getByRole("button", { name: "已复制" })).toBeVisible();

  // 重置轮换：旧访问 ID 立即 401，新访问 ID 立即可用
  await page.getByRole("button", { name: "重置轮换" }).click();
  await expect(page.getByRole("heading", { name: "重置子项目访问 ID" })).toBeVisible();
  await page.getByRole("button", { name: "确认轮换" }).click();
  await expect(page.getByRole("heading", { name: "重置子项目访问 ID" })).toHaveCount(0);
  const afterAccess = (((await page.locator("code", { hasText: "capsa_doc_" }).first().textContent()) ?? "")).trim();
  expect(afterAccess).not.toBe(beforeAccess);
  const statuses = await page.evaluate(
    async (tokens: string[]) => {
      const handshake = async (token: string) => {
        const response = await fetch("/mcp/docs?token=" + token, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: { name: "e2e", version: "1" },
            },
          }),
        });
        return response.status;
      };
      return [await handshake(tokens[0]), await handshake(tokens[1])];
    },
    [beforeAccess, afterAccess],
  );
  expect(statuses[1]).toBe(200);
  expect(statuses[0]).toBe(401);
  await page.getByRole("button", { name: "关闭" }).click();
  await expect(page.getByText("子项目访问 ID")).toHaveCount(0);

  // 子项目下文档新建、筛选、长文本在线编辑、重命名、删除
  await page.getByRole("button", { name: "新建文档" }).first().click();
  await page.getByLabel("文档路径").fill("notes.md");
  await page.getByLabel("初始正文").fill("initial body");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.getByRole("heading", { name: "notes.md" })).toBeVisible();

  await page.getByLabel("筛选文档").fill("notes");
  await expect(page.getByRole("button", { name: /notes\.md/ }).first()).toBeVisible();

  await page.getByRole("button", { name: "编辑" }).click();
  const longText = Array.from({ length: 400 }, (_, index) => "第 " + index + " 行长文本内容").join("\n");
  await page.getByLabel("文档正文").fill(longText);
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("article")).toContainText("第 399 行长文本内容");

  // 375px 窄屏：单栏切换且无横向溢出
  await page.setViewportSize({ width: 375, height: 667 });
  expect(await noHorizontalOverflow(page)).toBeTruthy();
  await page.getByRole("button", { name: "返回文件树" }).click();
  await expect(page.getByLabel("筛选文档")).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBeTruthy();
  await page.getByRole("button", { name: /notes\.md/ }).first().click();
  await expect(page.getByRole("button", { name: "返回文件树" })).toBeVisible();

  // 宽屏下重命名与删除
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "重命名", exact: true }).click();
  await expect(page.getByRole("heading", { name: "重命名文档" })).toBeVisible();
  await page.getByLabel("文档路径").fill("notes-v2.md");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("heading", { name: "notes-v2.md" })).toBeVisible();

  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByRole("heading", { name: "删除文档" })).toBeVisible();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByText("当前目录暂无文档")).toBeVisible();

  // 空子项目经接入与设置弹层删除成功
  await page.getByRole("button", { name: new RegExp("子项目设置 " + subprojectName) }).first().click();
  await page.getByRole("button", { name: "删除子项目" }).click();
  await expect(page.getByRole("heading", { name: "删除子项目" })).toBeVisible();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByRole("button", { name: new RegExp(subprojectName) })).toHaveCount(0);
});

test("16. 文档工作区 GFM 渲染、代码块解耦、层级文件树、目录钻取与分栏卸载拦截", async ({
  page,
  context,
}) => {
  const stamp = String(Date.now() % 1000000);
  const docsName = "文档浏览器-" + stamp;
  const subprojectName = "研发-" + stamp;
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, keys.admin);

  await openWorkspaceSettings(page);
  await createWorkspace(page, docsName, "docs");
  await page
    .locator("li", { hasText: docsName })
    .getByRole("button", { name: "切换" })
    .click();

  // GFM 表格、任务清单、删除线、代码块独占与行内代码隔离
  const gfmBody = [
    "# GFM 规范",
    "",
    "| 左对齐 | 居中对齐 | 右对齐 |",
    "| :--- | :---: | ---: |",
    "| left | center | right |",
    "",
    "- [x] 已完成任务",
    "- [ ] 待办任务",
    "",
    "~~已删除文本~~",
    "",
    "```ts",
    "const answer = 42;",
    "```",
    "",
    "```",
    "plain block",
    "```",
    "",
    "行内 `inline_code` 片段",
    "",
    "[页内锚点](#anchor) 与 [外链](https://example.com)",
    "",
    "<script>window.gfm_xss=true;</script>",
  ].join("\n");

  await page.getByRole("button", { name: "新建文档" }).first().click();
  await page.getByLabel("文档路径").fill("gfm.md");
  await page.getByLabel("初始正文").fill(gfmBody);
  await page.getByRole("button", { name: "创建", exact: true }).click();

  const article = page.getByRole("article");
  await expect(article).toBeVisible();
  await expect(article.locator("table")).toBeVisible();
  const headers = article.locator("th");
  await expect(headers).toHaveCount(3);
  await expect(headers.nth(0)).toHaveCSS("text-align", "left");
  await expect(headers.nth(1)).toHaveCSS("text-align", "center");
  await expect(headers.nth(2)).toHaveCSS("text-align", "right");
  await expect(article.locator("td")).toHaveCount(3);

  const checkboxes = article.locator('input[type="checkbox"]');
  await expect(checkboxes).toHaveCount(2);
  await expect(checkboxes.nth(0)).toBeDisabled();
  await expect(checkboxes.nth(0)).toBeChecked();
  await expect(checkboxes.nth(1)).toBeDisabled();
  await expect(checkboxes.nth(1)).not.toBeChecked();

  await expect(article.locator("del")).toContainText("已删除文本");
  await expect(article.locator("pre code")).toHaveCount(0);
  await expect(article.locator("p code")).toHaveCount(1);
  await expect(article.locator('a[href="#anchor"]')).not.toHaveAttribute("target", "_blank");
  await expect(article.locator('a[href="https://example.com"]')).toHaveAttribute("target", "_blank");

  await article.getByRole("button", { name: "复制代码" }).first().click();
  await expect(article.getByText("已复制")).toBeVisible();
  expect(await page.evaluate(() => (window as never as { gfm_xss?: boolean }).gfm_xss)).toBeUndefined();
  await expect(page.locator("script", { hasText: "gfm_xss" })).toHaveCount(0);

  // 多级文件树、面包屑目录钻取与目录前缀预填
  await page.getByRole("button", { name: "新建子项目" }).first().click();
  await page.getByLabel("子项目名称").fill(subprojectName);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.getByRole("button", { name: new RegExp("^" + subprojectName) }).first().click();

  await page.getByRole("button", { name: "新建文档" }).first().click();
  await page.getByLabel("文档路径").fill("guides/api/spec.md");
  await page.getByLabel("初始正文").fill("# 初始规范");
  await page.getByRole("button", { name: "创建", exact: true }).click();

  const explorer = page.locator('aside[aria-label="文件资源管理器"]');
  await expect(explorer.getByRole("button", { name: /^guides\b/ })).toBeVisible();
  await expect(explorer.getByRole("button", { name: /^api\b/ })).toBeVisible();
  await expect(explorer.getByRole("button", { name: "spec.md", exact: true })).toBeVisible();

  await page
    .getByRole("navigation", { name: "文档面包屑" })
    .getByRole("button", { name: "guides", exact: true })
    .click();
  const canvas = page.locator('section[aria-label="文档主画布"]');
  await expect(canvas.getByRole("button", { name: /api/ })).toBeVisible();

  await canvas.getByRole("button", { name: "新建文档" }).click();
  await expect(page.getByLabel("文档路径")).toHaveValue("guides/");
  await page.getByRole("button", { name: "取消" }).click();

  // 分栏实时预览、Control+s 保存与 beforeunload 脏态拦截
  await explorer.getByRole("button", { name: "spec.md", exact: true }).click();
  await page.getByRole("button", { name: "编辑" }).click();
  await expect(page.getByRole("button", { name: "分栏" })).toHaveAttribute("aria-pressed", "true");

  const editor = page.getByLabel("文档正文");
  await editor.fill("# 更新后规范\n\n- [x] 分栏同步");
  await expect(article.getByRole("heading", { name: "更新后规范" })).toBeVisible();

  const blocked = await page.evaluate(() =>
    window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
  );
  expect(blocked).toBe(false);

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("未保存");
    await dialog.dismiss();
  });
  await explorer.getByRole("button", { name: "新建文档" }).click();
  await expect(page.getByRole("heading", { name: "新建文档" })).toHaveCount(0);
  await expect(editor).toHaveValue("# 更新后规范\n\n- [x] 分栏同步");

  await editor.press("Control+s");
  await expect(page.getByLabel("文档正文")).toHaveCount(0);
  await expect(article.getByRole("heading", { name: "更新后规范" })).toBeVisible();

  const allowed = await page.evaluate(() =>
    window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
  );
  expect(allowed).toBe(true);

  // 375px 窄屏编辑态收敛为 编辑/预览 且无横向溢出
  await page.setViewportSize({ width: 375, height: 667 });
  expect(await noHorizontalOverflow(page)).toBeTruthy();
  await page.getByRole("button", { name: "编辑" }).click();
  await expect(page.getByRole("button", { name: "分栏" })).toBeHidden();
  await expect(page.getByRole("button", { name: "预览" })).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBeTruthy();
});

test("17. 四类记忆状态筛选（持久/临时）与工作区浅层周期实时配置", async ({ page }) => {
  const stamp = Date.now() % 100000;
  const pinTitle = `持久探针-${stamp}`;
  const tmpTitle = `临时探针-${stamp}`;
  await signIn(page, keys.admin);

  // 新建持久记忆
  await openDrawer(page);
  await page.getByRole("radiogroup", { name: "记忆状态" }).getByRole("radio", { name: "持久" }).click();
  await page.getByLabel("标题").fill(pinTitle);
  await page.getByLabel("摘要").fill("持久摘要");
  await page.getByLabel("正文").fill("持久正文");
  await page.getByRole("button", { name: "创建" }).click();

  // 新建临时记忆（默认 +7天）
  await openDrawer(page);
  await page.getByRole("radiogroup", { name: "记忆状态" }).getByRole("radio", { name: "临时" }).click();
  await page.getByLabel("标题").fill(tmpTitle);
  await page.getByLabel("摘要").fill("临时摘要");
  await page.getByLabel("正文").fill("临时正文");
  await page.getByRole("button", { name: "创建" }).click();

  // 按状态筛选：持久
  const tierGroup = page.getByRole("group", { name: "状态筛选" });
  await tierGroup.getByRole("button", { name: "持久" }).click();
  await expect(page.getByRole("button", { name: new RegExp(pinTitle) })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(tmpTitle) })).toHaveCount(0);

  // 按状态筛选：临时
  await tierGroup.getByRole("button", { name: "临时" }).click();
  await expect(page.getByRole("button", { name: new RegExp(tmpTitle) })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(pinTitle) })).toHaveCount(0);

  // 工作区设置调整默认记忆工作区 shallow_months
  await openWorkspaceSettings(page);
  await page.locator("li", { hasText: "默认" }).first().getByRole("button", { name: /编辑工作区/ }).click();
  await page.getByLabel("浅层记忆周期（月）").fill("6");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.locator("li", { hasText: "浅层 6 个月" }).first()).toBeVisible();
  await page.locator("li", { hasText: "默认" }).first().getByRole("button", { name: /编辑工作区/ }).click();
  await page.getByLabel("浅层记忆周期（月）").fill("3");
  await page.getByRole("button", { name: "保存" }).click();
});

test("18. 回收站单条永久删除与一键清空回收站", async ({ page }) => {
  const stamp = Date.now() % 100000;
  const t1 = `永久删一-${stamp}`;
  const t2 = `永久删二-${stamp}`;
  await signIn(page, keys.admin);

  for (const title of [t1, t2]) {
    await openDrawer(page);
    await page.getByLabel("标题").fill(title);
    await page.getByLabel("摘要").fill("回收站测试");
    await page.getByLabel("正文").fill("回收站正文");
    await page.getByRole("button", { name: "创建" }).click();
    await page.getByRole("button", { name: "删除记忆" }).click();
    await page.getByLabel("删除原因").fill("测试清理");
    await page.getByRole("button", { name: "移入回收站" }).click();
  }

  await page.getByRole("button", { name: "回收站", exact: true }).click();
  await expect(page.getByText(t1)).toBeVisible();
  await expect(page.getByText(t2)).toBeVisible();

  // 单条永久删除 t1
  await page.getByRole("button", { name: new RegExp("永久删除 " + t1) }).click();
  await expect(page.getByRole("heading", { name: "永久删除记忆" })).toBeVisible();
  await page.getByRole("button", { name: "永久删除", exact: true }).click();
  await expect(page.getByText(t1)).toHaveCount(0);
  await expect(page.getByText(t2)).toBeVisible();

  // 一键清空回收站
  await page.getByRole("button", { name: "清空回收站" }).click();
  await expect(page.getByRole("heading", { name: "清空回收站" })).toBeVisible();
  await page.getByRole("button", { name: "确认清空" }).click();
  await expect(page.getByText("回收站暂无条目")).toBeVisible();
});

test("19. 文档工作区桌面端三栏子项目排序持久化与 375px 窄屏抽屉切换", async ({ page }) => {
  const stamp = String(Date.now() % 1000000);
  const docsName = "排序验证-" + stamp;
  await signIn(page, keys.admin);

  await openWorkspaceSettings(page);
  await createWorkspace(page, docsName, "docs");
  await page.locator("li", { hasText: docsName }).getByRole("button", { name: "切换" }).click();

  // 创建 3 个子项目
  for (const name of ["甲项目", "乙项目", "丙项目"]) {
    await page.getByRole("button", { name: "新建子项目" }).first().click();
    await page.getByLabel("子项目名称").fill(name);
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.locator('aside[aria-label="子项目导航"]').getByText(name)).toBeVisible();
  }

  // 使用键盘 Alt+ArrowUp 将「丙项目」上移两位到首位，并刷新验证持久化
  const rail = page.locator('aside[aria-label="子项目导航"]');
  const thirdHandle = rail.getByRole("button", { name: "拖拽排序 丙项目" });
  await thirdHandle.focus();
  await page.keyboard.press("Alt+ArrowUp");
  await page.keyboard.press("Alt+ArrowUp");

  await expect(rail.locator("li[data-category-row]").first()).toContainText("丙项目");

  // 刷新页面后顺序保持持久化
  await page.reload();
  await expect(page.locator('aside[aria-label="子项目导航"]').locator("li[data-category-row]").first()).toContainText("丙项目");

  // 桌面端折叠/展开子项目栏
  await page.getByRole("button", { name: "折叠子项目栏" }).click();
  await expect(page.locator('aside[aria-label="子项目导航"]')).toHaveCount(0);
  await page.getByRole("button", { name: "展开子项目栏" }).click();
  await expect(page.locator('aside[aria-label="子项目导航"]')).toBeVisible();

  // 375px 移动端通过顶部容器切换条打开抽屉并切换子项目，无横向溢出
  await page.setViewportSize({ width: 375, height: 667 });
  expect(await noHorizontalOverflow(page)).toBeTruthy();
  await page.getByRole("button", { name: "切换文档容器" }).click();
  await expect(page.getByRole("dialog", { name: "切换子项目" })).toBeVisible();
  await page.getByRole("dialog", { name: "切换子项目" }).getByRole("button", { name: /^甲项目/ }).click();
  await expect(page.getByRole("dialog", { name: "切换子项目" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "切换文档容器" })).toContainText("甲项目");
  expect(await noHorizontalOverflow(page)).toBeTruthy();
});




