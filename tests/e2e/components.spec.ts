import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/get-session*", (route) =>
    route.fulfill({ json: null }),
  );
  await page.route("**/rpc/system", (route) =>
    route.fulfill({ json: { json: { market: true, playground: true } } }),
  );
});

test("入口与邀请制登录页面", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "我的能力", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "能力市场", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "登录平台" }).click();
  await expect(
    page.getByRole("heading", { name: "登录你的工作空间" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "注册" })).toHaveCount(0);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByText("请输入密码")).toBeVisible();
  expect(errors).toEqual([]);
});

test("RJSF 嵌套表单提交与 JSON 校验", async ({ page }) => {
  await page.goto("/lab");
  await page.getByLabel("待处理文本", { exact: false }).fill("用于验证的文本");
  await page.getByRole("button", { name: "提交参数" }).click();
  await expect(page.getByTestId("parameter-result")).toContainText(
    "用于验证的文本",
  );
  await expect(page.getByTestId("parameter-result")).toContainText(
    '"maxItems": 3',
  );
  await page.getByRole("button", { name: "JSON 输入" }).click();
  await page.getByLabel("JSON 参数").fill('{"text":42}');
  await page.getByRole("button", { name: "提交参数" }).click();
  await expect(page.getByRole("alert")).toHaveText("参数不符合工具要求。");
});

test("assistant-ui 显示 AI SDK 流式文本与工具结果", async ({ page }) => {
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      headers: { "x-vercel-ai-ui-message-stream": "v1" },
      body:
        [
          { type: "start", messageId: "assistant-1" },
          { type: "start-step" },
          {
            type: "tool-input-available",
            toolCallId: "call-1",
            toolName: "text_tool",
            input: { text: "hello" },
          },
          {
            type: "tool-output-available",
            toolCallId: "call-1",
            output: {
              executionId: "exec-1",
              status: "succeeded",
              summary: "HELLO",
            },
          },
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: "处理完成。" },
          { type: "text-end", id: "text-1" },
          { type: "finish-step" },
          { type: "finish", finishReason: "stop" },
        ]
          .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
          .join("") + "data: [DONE]\n\n",
    }),
  );
  await page.goto("/lab");
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("请处理 hello");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByText("处理完成。", { exact: true })).toBeVisible();
  await expect(page.locator(".execution-card")).toContainText("exec-1");
});

test("窄屏登录页面无横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
