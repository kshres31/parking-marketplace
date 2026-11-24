import { test, expect, Page } from "@playwright/test";
// 1x1 transparent PNG.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const password = "portfolio-browser-test-password";
async function register(page: Page, role: "customer" | "owner" = "customer") {
  const username =
    "web_" + crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  await page
    .getByRole("button", { name: "Sign in", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "New here? Create an account" })
    .click();
  await page
    .getByLabel(role === "owner" ? "List my parking spaces" : "Reserve parking")
    .check();
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
  // Sign-out finishes by returning to search; wait for it before navigating again.
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
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
  const username = await register(page, "owner");
  await expect(
    page.getByRole("button", { name: "My bookings", exact: true }),
  ).toHaveCount(0);
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

test("search filters by features and price, and shows listing details", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /The Loop courtyard/ }),
  ).toBeVisible();
  await page.getByLabel("EV charging").check();
  await page.getByRole("button", { name: "Find a space", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "1 available spaces" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /West Loop garage/ }).click();
  await expect(
    page.getByText("Attended garage with a Level 2 charger."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByLabel("EV charging").uncheck();
  await page.getByLabel("Max price").selectOption("3");
  await page.getByRole("button", { name: "Find a space", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "1 available spaces" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Printer’s Row parking/ }),
  ).toBeVisible();
});
test("owner adds photos and features, edits price, and deletes a listing", async ({
  page,
}) => {
  await page.goto("/");
  const username = await register(page, "owner");
  await page.getByRole("button", { name: "Host a space", exact: true }).click();
  await page
    .getByRole("button", { name: "+ List a space", exact: true })
    .click();
  await page.getByLabel("Space name").fill("Photo bay " + username);
  await page
    .getByLabel("Address", { exact: true })
    .fill("Fictional photo street");
  await page.getByLabel("Description").fill("Second level, bay 14.");
  await page.getByLabel("Covered").check();
  await page
    .getByLabel("Add photos")
    .setInputFiles({ name: "bay.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Publish demo listing" }).click();
  const card = page
    .getByRole("article")
    .filter({ hasText: "Photo bay " + username });
  await expect(card).toContainText("Second level, bay 14.");
  await expect(card).toContainText("Covered");
  await expect(card.locator("img.card-photo")).toHaveJSProperty(
    "naturalWidth",
    1,
  );
  await card.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Hourly price (USD)").fill("7.25");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(card).toContainText("$7.25");
  await card.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete listing" }).click();
  await expect(page.getByText("Listing deleted.")).toBeVisible();
  await expect(card).toHaveCount(0);
});
