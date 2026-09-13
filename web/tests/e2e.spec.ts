import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const keys = JSON.parse(readFileSync(join(here, "keys.json"), "utf-8")) as {
  rw: string;
  readonly: string;
};

async function signIn(page: Page, key: string) {
  await page.goto("/");
  await page.getByLabel("API Key").fill(key);
  await page.getByRole("button", { name: "连接" }).click();
  await expect(page.getByRole("navigation", { name: "主视图" })).toBeVisible();
}

async function openDrawer(page: Page) {
  await page.getByRole("button", { name: "新建记忆" }).first().click();
  await expect(page.getByRole("heading", { name: "新建记忆" })).toBeVisible();
  // 分组默认取第一个可写分组（按 slug 排序即 life）；用例统一落在 proj，
  // 这样只读 Key（proj/study）也能看到探针条目。
  await page.getByLabel("分组").selectOption("proj");
}

test("1. 凭据只存 sessionStorage，退出即清空", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "连接" })).toBeVisible();
  await signIn(page, keys.rw);
  expect(await page.evaluate(() => sessionStorage.getItem("capsa_key"))).toBe(keys.rw);

  await page.getByRole("button", { name: "退出" }).click();
  await expect(page.getByRole("button", { name: "连接" })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("capsa_key"))).toBeNull();
});

test("2. 失效凭据在 401 后回到锁屏", async ({ page }) => {
  await signIn(page, keys.rw);
  await page.evaluate(() => sessionStorage.setItem("capsa_key", "capsa_deadkey_000000000000000000000000000000"));
  await page.getByRole("button", { name: "时效复核" }).click();
  await expect(page.getByText("凭据无效或已被吊销")).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("capsa_key"))).toBeNull();
});

test("3. 登录页不发起业务请求，无凭据时不进入三视图", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "主视图" })).toHaveCount(0);
  await expect(page.getByText("输入服务端签发的 API Key 以继续")).toBeVisible();
});

test("4. Markdown 管道拦截脚本、事件属性与伪协议", async ({ page }) => {
  await signIn(page, keys.rw);
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

test("5. Markdown 保留安全链接形态", async ({ page }) => {
  await signIn(page, keys.rw);
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

test("6. 只读 Key 下写操作不可用", async ({ page }) => {
  const title = "只读探针";
  await signIn(page, keys.rw);
  await openDrawer(page);
  await page.getByLabel("标题").fill(title);
  await page.getByLabel("摘要").fill("权限验证");
  await page.getByLabel("正文").fill("只读 Key 不应能修改这条");
  await page.getByRole("button", { name: "创建" }).click();
  await page.getByRole("button", { name: "退出" }).click();

  await signIn(page, keys.readonly);
  await expect(page.getByRole("button", { name: "新建记忆" })).toHaveCount(0);
  // 分组胶囊的可见名也叫「项目」，这里必须锚定条目标题，否则点中的是筛选胶囊。
  await page.getByLabel("检索记忆").fill(title);
  await page.getByRole("button", { name: new RegExp(title) }).first().click();
  await expect(page.getByRole("button", { name: "编辑" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "删除" })).toBeDisabled();
  await page.getByRole("button", { name: "回收站", exact: true }).click();
  await expect(page.getByText("回收站暂无条目")).toBeVisible();
});

test("7. 标题超限时标红并禁用提交", async ({ page }) => {
  await signIn(page, keys.rw);
  await openDrawer(page);
  await page.getByLabel("标题").fill("长".repeat(61));
  await expect(page.getByText("61/60")).toHaveClass(/text-red-600/);
  await expect(page.getByRole("button", { name: "创建" })).toBeDisabled();
  await page.getByLabel("标题").fill("六十字标题");
  await expect(page.getByRole("button", { name: "创建" })).toBeEnabled();
});

test("8. 全流程：新建、检索、编辑清空复核、软删除、恢复", async ({ page }) => {
  const title = `流程探针-${Date.now()}`;
  await signIn(page, keys.rw);
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

  await page.getByRole("button", { name: "编辑" }).click();
  await page.getByLabel("摘要").fill("流程摘要已更新");
  await page.getByLabel("复核时间").fill("2020-01-01");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("流程摘要已更新")).toBeVisible();
  await expect(page.getByText(/2020-01-01 · 已过期/)).toBeVisible();

  await page.getByRole("button", { name: "编辑" }).click();
  await page.getByRole("button", { name: "清除" }).click();
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("未设置")).toBeVisible();

  await page.getByRole("button", { name: "删除" }).click();
  await page.getByLabel("删除原因").fill("流程验证");
  await page.getByRole("button", { name: "移入回收站" }).click();

  await page.getByRole("button", { name: "回收站", exact: true }).click();
  await expect(page.getByText(/流程验证/).first()).toBeVisible();
  await page.getByRole("button", { name: "恢复" }).first().click();
  await expect(page.getByText("回收站暂无条目")).toBeVisible();

  await page.getByRole("button", { name: "记忆工作台" }).click();
  await page.getByLabel("检索记忆").fill(title);
  await expect(page.getByRole("button", { name: new RegExp(title) }).first()).toBeVisible();
});

test("9. 移动端 375px 单栏与抽屉全屏", async ({ page }) => {
  const title = "移动端探针";
  await signIn(page, keys.rw);
  await openDrawer(page);
  await page.getByLabel("标题").fill(title);
  await page.getByLabel("摘要").fill("响应式验证");
  await page.getByLabel("正文").fill("单栏详情");
  await page.getByRole("button", { name: "创建" }).click();

  await page.setViewportSize({ width: 375, height: 667 });
  // 创建后界面停在详情，单栏布局下先返回列表再检索。
  await page.getByRole("button", { name: "返回列表" }).click();
  await page.getByLabel("检索记忆").fill(title);
  await page.getByRole("button", { name: new RegExp(title) }).first().click();
  await expect(page.getByRole("button", { name: "返回列表" })).toBeVisible();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  await page.getByRole("button", { name: "返回列表" }).click();
  await openDrawer(page);
  const drawer = page.getByRole("heading", { name: "新建记忆" }).locator("..");
  const box = await drawer.boundingBox();
  expect(Math.round(box?.width ?? 0)).toBe(375);
});
