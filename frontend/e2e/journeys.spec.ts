import { test, expect, Page } from "@playwright/test";
const password = "portfolio-browser-test-password";
async function register(page: Page) {
  const username =
    "web_" + crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  await page
    .getByRole("button", { name: "Sign in", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "New here? Create an account" })
    .click();
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  return username;
}
test("find, register, reserve, persist session, and cancel through the real API", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /available spaces/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /The Loop courtyard/ }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("search.png"),
    fullPage: true,
  });
  await register(page);
  await page.getByRole("button", { name: /The Loop courtyard/ }).click();
  await page.getByRole("button", { name: "Reserve demo space" }).click();
  await expect(
    page.getByRole("heading", { name: "My bookings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("article").filter({ hasText: "The Loop courtyard" }),
  ).toContainText("confirmed");
  const cookie = (await page.context().cookies()).find(
    (c) => c.name === "parking_session",
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    "parking_session",
  );
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    password,
  );
  await page.reload();
  await page.getByRole("button", { name: "My bookings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Cancel booking", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cancel booking", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm cancellation" }).click();
  await expect(
    page.getByRole("article").filter({ hasText: "The Loop courtyard" }),
  ).toContainText("cancelled");
  await page.screenshot({
    path: info.outputPath("bookings.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "My bookings", exact: true }).click();
  await expect(
    page.getByText("Sign in to manage your bookings and parking listings."),
  ).toBeVisible();
});
test("host creates and pauses a listing; search updates and layout fits", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /available spaces/ }),
  ).toBeVisible();
  const username = await register(page);
  await page.getByRole("button", { name: "Host a space", exact: true }).click();
  await page
    .getByRole("button", { name: "+ List a space", exact: true })
    .click();
  await page.getByLabel("Space name").fill("Courtyard " + username);
  await page
    .getByLabel("Address", { exact: true })
    .fill("Fictional Chicago courtyard");
  await page.getByRole("button", { name: "Publish demo listing" }).click();
  await expect(
    page.getByRole("heading", { name: "Courtyard " + username }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Pause listing", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume listing", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("host.png"), fullPage: true });
  await page.getByRole("button", { name: "Find parking", exact: true }).click();
  await page.getByRole("button", { name: "Find a space", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Courtyard web_/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /available spaces/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
