import { expect, test, type Locator, type Page } from "@playwright/test";

async function connect(from: Locator, to: Locator): Promise<void> {
  await from.click();
  await to.click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("builds NOT, verifies it, publishes it, and persists progression", async ({
  page,
}) => {
  await expect(page.getByRole("heading", { name: "NOT" })).toBeVisible();

  await page.getByTestId("palette-builtin.nand").click();

  const component = page.locator('[data-testid^="component-"]').first();
  await expect(component).toBeVisible();

  const input = page.getByTestId("pin-interface-in");
  const output = page.getByTestId("pin-interface-out");
  const nandA = component.locator('[data-pin-id="a"]');
  const nandB = component.locator('[data-pin-id="b"]');
  const nandOut = component.locator('[data-pin-id="out"]');

  await connect(input, nandA);
  await connect(input, nandB);
  await connect(nandOut, output);

  await page.getByTestId("run-tests").click();
  await expect(page.getByTestId("test-overall-result")).toHaveText(
    "ALL TESTS PASSED",
  );

  await expect(page.getByTestId("publish-chip")).toBeEnabled();
  await page.getByTestId("publish-chip").click();

  const andChallenge = page.getByTestId("challenge-logic.and");
  await expect(andChallenge).toBeEnabled();
  await andChallenge.click();

  await expect(page.getByTestId("palette-user.not")).toBeVisible();

  await page.reload();

  await expect(page.getByTestId("challenge-logic.and")).toBeEnabled();
  await page.getByTestId("challenge-logic.and").click();
  await expect(page.getByTestId("palette-user.not")).toBeVisible();
});

test("selected component can be deleted without dragging", async ({ page }) => {
  await page.getByTestId("palette-builtin.nand").click();

  const component = page.locator('[data-testid^="component-"]').first();
  await component.click();

  await page.keyboard.press("Delete");
  await expect(component).toHaveCount(0);
});

test("dragging stays under the cursor after zoom", async ({ page }) => {
  await page.getByTestId("palette-builtin.nand").click();

  const canvas = page.locator("svg.circuit-canvas");
  const component = page.locator('[data-testid^="component-"]').first();

  await expect(component).toBeVisible();
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("missing canvas bounding box");

  await page.getByRole("button", { name: "+", exact: true }).click();

  const before = await component.boundingBox();
  if (!before) throw new Error("missing component bounding box");

  const startX = before.x + before.width * 0.55;
  const startY = before.y + before.height * 0.35;
  const dx = 90;
  const dy = 55;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 6 });
  await page.mouse.up();

  const after = await component.boundingBox();
  if (!after) throw new Error("missing component bounding box after drag");

  expect(after.x - before.x).toBeCloseTo(dx, -1);
  expect(after.y - before.y).toBeCloseTo(dy, -1);
});

test("mouse wheel does not zoom the circuit canvas", async ({ page }) => {
  const canvas = page.locator("svg.circuit-canvas");
  await expect(canvas).toBeVisible();

  const before = await canvas.getAttribute("viewBox");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("missing canvas bounding box");

  await page.mouse.move(
    box.x + box.width / 2,
    box.y + box.height / 2,
  );
  await page.mouse.wheel(0, -600);

  await expect(canvas).toHaveAttribute("viewBox", before ?? "");
});

test("target truth table is visible and rows can drive circuit inputs", async ({
  page,
}) => {
  const table = page.getByTestId("target-truth-table");
  await expect(table).toBeVisible();

  await expect(page.getByTestId("truth-row-0")).toBeVisible();
  await expect(page.getByTestId("truth-row-1")).toBeVisible();

  await page.getByTestId("truth-row-1").click();
  await expect(page.getByTestId("input-in")).toContainText("IN: 1");

  await page.getByTestId("truth-row-0").click();
  await expect(page.getByTestId("input-in")).toContainText("IN: 0");
});
