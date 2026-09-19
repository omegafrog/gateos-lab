import { expect, test, type Locator, type Page } from "@playwright/test";

async function connect(from: Locator, to: Locator): Promise<void> {
  const fromBox = await from.boundingBox();
  const toBox = await to.boundingBox();
  if (!fromBox || !toBox) {
    throw new Error("missing pin geometry for wire drag");
  }

  await from.page().mouse.move(
    fromBox.x + fromBox.width / 2,
    fromBox.y + fromBox.height / 2,
  );
  await from.page().mouse.down();
  await from.page().mouse.move(
    toBox.x + toBox.width / 2,
    toBox.y + toBox.height / 2,
    { steps: 8 },
  );
  await from.page().mouse.up();
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
  await expect(page.getByTestId("input-in")).toHaveAttribute(
    "data-applied-value",
    "1",
  );

  await page.getByTestId("truth-row-0").click();
  await expect(page.getByTestId("input-in")).toHaveAttribute(
    "data-applied-value",
    "0",
  );
});

test("state-circuit inputs are staged until Apply inputs", async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem(
      "gateos-lab:v0.1",
      JSON.stringify({
        schema: "gateos.project/v1",
        circuits: {},
        published: {},
        completed: [
          "logic.not",
          "logic.and",
          "logic.or",
          "logic.xor",
          "routing.mux2",
          "arithmetic.half-adder",
          "arithmetic.full-adder",
        ],
        probes: {},
      }),
    );
  });
  await page.reload();

  await page.getByTestId("challenge-state.sr-latch").click();

  const summary = page.getByTestId("applied-input-summary");
  await expect(summary).toContainText("S̅=1");
  await expect(summary).toContainText("R̅=1");

  await page.getByTestId("input-sbar").click();
  await page.getByTestId("input-rbar").click();

  await expect(page.getByTestId("input-sbar")).toHaveAttribute(
    "data-draft-value",
    "0",
  );
  await expect(page.getByTestId("input-rbar")).toHaveAttribute(
    "data-draft-value",
    "0",
  );
  await expect(page.getByTestId("input-sbar")).toHaveAttribute(
    "data-applied-value",
    "1",
  );
  await expect(page.getByTestId("input-rbar")).toHaveAttribute(
    "data-applied-value",
    "1",
  );

  // Draft edits must not reach the simulator yet.
  await expect(summary).toContainText("S̅=1");
  await expect(summary).toContainText("R̅=1");

  await page.getByTestId("apply-inputs").click();

  await expect(summary).toContainText("S̅=0");
  await expect(summary).toContainText("R̅=0");
});

test("canvas input and output terminals keep wiring ports and show values", async ({
  page,
}) => {
  await page.getByTestId("palette-builtin.nand").click();

  const component = page.locator('[data-testid^="component-"]').first();
  const inputTerminal = page.getByTestId("input-in");
  const inputPort = page.getByTestId("pin-interface-in");
  const outputTerminal = page.getByTestId("output-out");
  const outputPort = page.getByTestId("pin-interface-out");

  await expect(inputTerminal).toHaveAttribute("data-applied-value", "0");
  await expect(outputTerminal).toHaveAttribute("data-value", "X");

  await connect(inputPort, component.locator('[data-pin-id="a"]'));
  await connect(inputPort, component.locator('[data-pin-id="b"]'));
  await connect(component.locator('[data-pin-id="out"]'), outputPort);

  await expect(outputTerminal).toHaveAttribute("data-value", "1");

  await inputTerminal.click();
  await expect(inputTerminal).toHaveAttribute("data-applied-value", "1");
  await expect(outputTerminal).toHaveAttribute("data-value", "0");
});

test("placed components render as compact circuit symbols", async ({ page }) => {
  await page.getByTestId("palette-builtin.nand").click();

  const component = page.locator('[data-testid^="component-"]').first();
  await expect(component).toBeVisible();

  const box = await component.boundingBox();
  if (!box) throw new Error("missing compact component bounding box");

  expect(box.width).toBeLessThan(120);
  expect(box.height).toBeLessThan(90);

  await expect(component.locator('[data-pin-id="a"]')).toBeVisible();
  await expect(component.locator('[data-pin-id="b"]')).toBeVisible();
  await expect(component.locator('[data-pin-id="out"]')).toBeVisible();
});

test("OR XOR and MUX use dedicated compact symbols", async ({ page }) => {
  await page.evaluate(() => {
    const makeChip = (
      id: string,
      name: string,
      inputs: string[],
      outputs: string[],
    ) => ({
      schema: "gateos.circuit/v1",
      id: `artifact.${id}`,
      name,
      pins: [
        ...inputs.map((pin) => ({
          id: pin,
          name: pin.toUpperCase(),
          direction: "input",
          width: 1,
        })),
        ...outputs.map((pin) => ({
          id: pin,
          name: pin.toUpperCase(),
          direction: "output",
          width: 1,
        })),
      ],
      instances: [],
      connections: [],
    });

    localStorage.setItem(
      "gateos-lab:v0.1",
      JSON.stringify({
        schema: "gateos.project/v1",
        completed: [
          "logic.not",
          "logic.and",
          "logic.or",
          "logic.xor",
          "routing.mux2",
        ],
        probes: {},
        published: {
          "user.or": makeChip("or", "OR", ["a", "b"], ["out"]),
          "user.xor": makeChip("xor", "XOR", ["a", "b"], ["out"]),
          "user.mux2": makeChip("mux2", "MUX2", ["a", "b", "sel"], ["out"]),
        },
        circuits: {
          "arithmetic.half-adder": {
            schema: "gateos.circuit/v1",
            id: "submission.arithmetic.half-adder",
            name: "Half Adder",
            pins: [
              { id: "a", name: "A", direction: "input", width: 1 },
              { id: "b", name: "B", direction: "input", width: 1 },
              { id: "sum", name: "SUM", direction: "output", width: 1 },
              { id: "carry", name: "CARRY", direction: "output", width: 1 },
            ],
            instances: [
              {
                id: "or-chip",
                componentId: "user.or",
                position: { x: 260, y: 120 },
              },
              {
                id: "xor-chip",
                componentId: "user.xor",
                position: { x: 410, y: 120 },
              },
              {
                id: "mux-chip",
                componentId: "user.mux2",
                position: { x: 560, y: 120 },
              },
            ],
            connections: [],
          },
        },
      }),
    );
  });

  await page.reload();
  await page.getByTestId("challenge-arithmetic.half-adder").click();

  await expect(page.locator('[data-component-id="user.or"]')).toHaveAttribute(
    "data-symbol-kind",
    "or",
  );
  await expect(page.locator('[data-component-id="user.xor"]')).toHaveAttribute(
    "data-symbol-kind",
    "xor",
  );
  await expect(page.locator('[data-component-id="user.mux2"]')).toHaveAttribute(
    "data-symbol-kind",
    "mux",
  );
});

test("chips can be dragged past the old placement boundary", async ({ page }) => {
  await page.getByTestId("palette-builtin.nand").click();

  const component = page.locator('[data-testid^="component-"]').first();
  const canvas = page.locator("svg.circuit-canvas");
  const componentBox = await component.boundingBox();
  const canvasBox = await canvas.boundingBox();
  if (!componentBox || !canvasBox) {
    throw new Error("missing drag geometry");
  }

  await page.mouse.move(
    componentBox.x + componentBox.width / 2,
    componentBox.y + componentBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    componentBox.x + componentBox.width / 2,
    canvasBox.y + 8,
    { steps: 8 },
  );
  await page.mouse.up();

  const y = Number(await component.getAttribute("data-position-y"));
  expect(y).toBeLessThan(84);
});

test("new chips are created in the currently panned world viewport", async ({
  page,
}) => {
  const canvas = page.locator("svg.circuit-canvas");
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("missing canvas geometry");

  const centerX = canvasBox.x + canvasBox.width / 2;
  const centerY = canvasBox.y + canvasBox.height / 2;

  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 30, centerY, { steps: 10 });
  await page.mouse.up();

  const viewBox = (await canvas.getAttribute("viewBox")) ?? "";
  const viewportX = Number(viewBox.split(/\s+/)[0]);
  expect(viewportX).toBeGreaterThan(300);

  await page.getByTestId("palette-builtin.nand").click();

  const component = page.locator('[data-testid^="component-"]').first();
  const x = Number(await component.getAttribute("data-position-x"));
  expect(x).toBeGreaterThan(viewportX);
});

test("interface terminals can move and connected wires follow their position", async ({
  page,
}) => {
  await page.getByTestId("palette-builtin.nand").click();

  const component = page.locator('[data-testid^="component-"]').first();
  const inputPort = page.getByTestId("pin-interface-in");
  const outputPort = page.getByTestId("pin-interface-out");

  await connect(inputPort, component.locator('[data-pin-id="a"]'));
  await connect(inputPort, component.locator('[data-pin-id="b"]'));
  await connect(component.locator('[data-pin-id="out"]'), outputPort);

  const firstWire = page.locator("path.wire").first();
  const beforeWire = await firstWire.getAttribute("d");
  const inputTerminal = page.getByTestId("input-in");
  const beforeX = await inputTerminal.getAttribute("data-terminal-x");
  const beforeY = await inputTerminal.getAttribute("data-terminal-y");

  const inputHandle = page.getByTestId("drag-interface-in");
  const handleBox = await inputHandle.boundingBox();
  if (!handleBox) throw new Error("missing input terminal drag handle");

  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBox.x + handleBox.width / 2 + 75,
    handleBox.y + handleBox.height / 2 + 70,
    { steps: 8 },
  );
  await page.mouse.up();

  const afterX = await inputTerminal.getAttribute("data-terminal-x");
  const afterY = await inputTerminal.getAttribute("data-terminal-y");
  expect(afterX).not.toBe(beforeX);
  expect(afterY).not.toBe(beforeY);
  expect(await firstWire.getAttribute("d")).not.toBe(beforeWire);

  const outputTerminal = page.getByTestId("output-out");
  const outputBeforeY = await outputTerminal.getAttribute("data-terminal-y");
  const outputHandle = page.getByTestId("drag-interface-out");
  const outputHandleBox = await outputHandle.boundingBox();
  if (!outputHandleBox) throw new Error("missing output terminal drag handle");

  await page.mouse.move(
    outputHandleBox.x + outputHandleBox.width / 2,
    outputHandleBox.y + outputHandleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    outputHandleBox.x + outputHandleBox.width / 2,
    outputHandleBox.y + outputHandleBox.height / 2 + 85,
    { steps: 8 },
  );
  await page.mouse.up();

  expect(await outputTerminal.getAttribute("data-terminal-y")).not.toBe(
    outputBeforeY,
  );

  const persistedX = await inputTerminal.getAttribute("data-terminal-x");
  const persistedY = await inputTerminal.getAttribute("data-terminal-y");
  await page.waitForTimeout(100);
  await page.reload();

  await expect(page.getByTestId("input-in")).toHaveAttribute(
    "data-terminal-x",
    persistedX ?? "",
  );
  await expect(page.getByTestId("input-in")).toHaveAttribute(
    "data-terminal-y",
    persistedY ?? "",
  );
});

test("wire drag creates an orthogonal path", async ({ page }) => {
  await page.getByTestId("palette-builtin.nand").click();

  const component = page.locator('[data-testid^="component-"]').first();
  await connect(
    page.getByTestId("pin-interface-in"),
    component.locator('[data-pin-id="a"]'),
  );

  const wire = page.locator("path.wire:not(.wire-preview)").first();
  await expect(wire).toBeVisible();

  const path = (await wire.getAttribute("d")) ?? "";
  expect(path).toContain(" H ");
  expect(path).toContain(" V ");
  expect(path).not.toContain(" C ");

  await expect(page.locator("path.wire-preview")).toHaveCount(0);
});
