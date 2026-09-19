import { expect, test, type Locator, type Page } from "@playwright/test";

async function connect(
  page: Page,
  from: Locator,
  to: Locator,
): Promise<void> {
  await from.hover();
  await page.mouse.down();
  await to.hover();
  await page.mouse.up();
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

  await connect(page, input, nandA);
  await connect(page, input, nandB);
  await connect(page, nandOut, output);

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

test("component dragging snaps to the hidden placement grid", async ({ page }) => {
  await page.getByTestId("palette-builtin.nand").click();

  const component = page.locator('[data-testid^="component-"]').first();
  await expect(component).toBeVisible();

  const beforeX = Number(await component.getAttribute("data-position-x"));
  const beforeY = Number(await component.getAttribute("data-position-y"));
  expect(beforeX % 12).toBe(0);
  expect(beforeY % 12).toBe(0);

  const hitbox = component.locator(".component-hitbox");
  const box = await hitbox.boundingBox();
  if (!box) throw new Error("missing component hitbox");

  await hitbox.hover();
  await page.mouse.down();
  await page.waitForTimeout(20);
  await page.mouse.move(
    box.x + box.width * 0.5 + 83,
    box.y + box.height * 0.5 + 47,
    { steps: 6 },
  );
  await page.mouse.up();

  const afterX = Number(await component.getAttribute("data-position-x"));
  const afterY = Number(await component.getAttribute("data-position-y"));

  expect(afterX % 12).toBe(0);
  expect(afterY % 12).toBe(0);
  expect(afterX).not.toBe(beforeX);
  expect(afterY).not.toBe(beforeY);
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

  await connect(page, inputPort, component.locator('[data-pin-id="a"]'));
  await connect(page, inputPort, component.locator('[data-pin-id="b"]'));
  await connect(page, component.locator('[data-pin-id="out"]'), outputPort);

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

test("large component drags remain snapped to the hidden grid", async ({ page }) => {
  await page.getByTestId("palette-builtin.nand").click();

  const component = page.locator('[data-testid^="component-"]').first();
  const hitbox = component.locator(".component-hitbox");
  const beforeX = Number(await component.getAttribute("data-position-x"));
  const beforeY = Number(await component.getAttribute("data-position-y"));
  const box = await hitbox.boundingBox();
  if (!box) throw new Error("missing drag geometry");

  await page.mouse.move(
    box.x + box.width / 2,
    box.y + box.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 180,
    box.y + box.height / 2 + 120,
    { steps: 10 },
  );
  await page.mouse.up();

  const x = Number(await component.getAttribute("data-position-x"));
  const y = Number(await component.getAttribute("data-position-y"));
  expect(x).not.toBe(beforeX);
  expect(y).not.toBe(beforeY);
  expect(x % 12).toBe(0);
  expect(y % 12).toBe(0);
});

test("new chips are created in the currently panned world viewport", async ({
  page,
}) => {
  const canvas = page.locator("svg.circuit-canvas");
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("missing canvas geometry");

  const centerX = canvasBox.x + canvasBox.width / 2;
  const centerY = canvasBox.y + canvasBox.height / 2;

  const panSurface = page.getByTestId("canvas-pan-surface");
  await expect(panSurface).toBeVisible();
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.waitForTimeout(20);
  await page.mouse.move(canvasBox.x + 30, centerY, { steps: 10 });
  await page.mouse.up();

  const viewBox = (await canvas.getAttribute("viewBox")) ?? "";
  const viewportX = Number(viewBox.split(/\s+/)[0]);
  expect(viewportX).toBeGreaterThan(300);

  await page.getByTestId("palette-builtin.nand").click();

  const component = page.locator('[data-testid^="component-"]').first();
  const x = Number(await component.getAttribute("data-position-x"));
  const y = Number(await component.getAttribute("data-position-y"));
  expect(x).toBeGreaterThan(viewportX);
  expect(x % 12).toBe(0);
  expect(y % 12).toBe(0);
});

test("interface terminals can move and connected wires follow their position", async ({
  page,
}) => {
  await page.getByTestId("palette-builtin.nand").click();

  const component = page.locator('[data-testid^="component-"]').first();
  const inputPort = page.getByTestId("pin-interface-in");
  const outputPort = page.getByTestId("pin-interface-out");

  await connect(page, inputPort, component.locator('[data-pin-id="a"]'));
  await connect(page, inputPort, component.locator('[data-pin-id="b"]'));
  await connect(page, component.locator('[data-pin-id="out"]'), outputPort);

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
  expect(Number(afterX) % 12).toBe(0);
  expect(Number(afterY) % 12).toBe(0);
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

test("wire drag allows a direct diagonal segment", async ({ page }) => {
  await page.getByTestId("palette-builtin.nand").click();

  const component = page.locator('[data-testid^="component-"]').first();
  await connect(
    page,
    page.getByTestId("pin-interface-in"),
    component.locator('[data-pin-id="a"]'),
  );

  const wire = page.locator("path.wire:not(.wire-preview)").first();
  await expect(wire).toBeVisible();

  const path = (await wire.getAttribute("d")) ?? "";
  expect(path).toContain(" L ");
  expect(path).not.toContain(" H ");
  expect(path).not.toContain(" V ");
  expect(path).not.toContain(" C ");

  const numbers = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  expect(numbers).toHaveLength(4);
  expect(numbers[0]).not.toBe(numbers[2]);
  expect(numbers[1]).not.toBe(numbers[3]);

  await expect(page.locator("path.wire-preview")).toHaveCount(0);
});

test("wire routing can pause at a grid node and resume to a pin", async ({
  page,
}) => {
  await page.getByTestId("palette-builtin.nand").click();

  const component = page.locator('[data-testid^="component-"]').first();
  const from = page.getByTestId("pin-interface-in");
  const to = component.locator('[data-pin-id="a"]');

  const fromBox = await from.boundingBox();
  const toBox = await to.boundingBox();
  if (!fromBox || !toBox) throw new Error("missing wire endpoint geometry");

  const fromX = fromBox.x + fromBox.width / 2;
  const fromY = fromBox.y + fromBox.height / 2;
  const toX = toBox.x + toBox.width / 2;
  const toY = toBox.y + toBox.height / 2;

  const waypointX = fromX + (toX - fromX) * 0.45;
  const waypointY = fromY + 72;

  await from.hover();
  await page.mouse.down();
  await page.waitForTimeout(20);
  await page.mouse.move(waypointX, waypointY, { steps: 8 });
  await page.mouse.up();

  const draftEnd = page.getByTestId("draft-wire-end");
  await expect(draftEnd).toBeVisible();

  const draftX = Number(await draftEnd.getAttribute("cx"));
  const draftY = Number(await draftEnd.getAttribute("cy"));
  expect(draftX % 12).toBe(0);
  expect(draftY % 12).toBe(0);

  const endBox = await draftEnd.boundingBox();
  if (!endBox) throw new Error("missing draft wire node geometry");

  await page.mouse.move(
    endBox.x + endBox.width / 2,
    endBox.y + endBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(toX, toY, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByTestId("draft-wire-end")).toHaveCount(0);

  const routeNode = page.locator("circle.wire-node:not(.draft)").first();
  await expect(routeNode).toBeVisible();
  await expect(routeNode).toHaveAttribute("cx", String(draftX));
  await expect(routeNode).toHaveAttribute("cy", String(draftY));

  const wire = page.locator("path.wire:not(.wire-preview)").first();
  const path = (await wire.getAttribute("d")) ?? "";
  expect((path.match(/ L /g) ?? []).length).toBe(2);
});

test("clicking an existing wire adds a movable snapped anchor", async ({ page }) => {
  await page.getByTestId("palette-builtin.nand").click();

  const component = page.locator('[data-testid^="component-"]').first();
  await connect(
    page,
    page.getByTestId("pin-interface-in"),
    component.locator('[data-pin-id="a"]'),
  );

  const wire = page.locator("path.wire:not(.wire-preview)").first();
  const hitTarget = page.locator("path.wire-hit-target").first();
  await expect(wire).toBeVisible();
  await expect(hitTarget).toBeVisible();
  await hitTarget.click();

  const node = page.locator("circle.wire-node:not(.draft)").first();
  await expect(node).toBeVisible();

  const beforeX = Number(await node.getAttribute("cx"));
  const beforeY = Number(await node.getAttribute("cy"));
  expect(beforeX % 12).toBe(0);
  expect(beforeY % 12).toBe(0);

  const box = await node.boundingBox();
  if (!box) throw new Error("missing route node geometry");

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 61,
    box.y + box.height / 2 + 37,
    { steps: 8 },
  );
  await page.mouse.up();

  const afterX = Number(await node.getAttribute("cx"));
  const afterY = Number(await node.getAttribute("cy"));
  expect(afterX % 12).toBe(0);
  expect(afterY % 12).toBe(0);
  expect(afterX === beforeX && afterY === beforeY).toBe(false);
});

test("all component ports land on the same hidden 12-unit grid", async ({ page }) => {
  await page.getByTestId("palette-builtin.nand").click();

  const component = page.locator('[data-testid^="component-"]').first();
  const pins = component.locator("circle.pin");
  const count = await pins.count();
  expect(count).toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const pin = pins.nth(index);
    const x = Number(await pin.getAttribute("cx"));
    const y = Number(await pin.getAttribute("cy"));
    expect(x % 12).toBe(0);
    expect(y % 12).toBe(0);
  }

  for (const pinId of ["in", "out"]) {
    const pin = page.getByTestId(`pin-interface-${pinId}`);
    const x = Number(await pin.getAttribute("cx"));
    const y = Number(await pin.getAttribute("cy"));
    expect(x % 12).toBe(0);
    expect(y % 12).toBe(0);
  }
});

test("saved pre-grid coordinates migrate onto the current hidden grid", async ({
  page,
}) => {
  await page.getByTestId("palette-builtin.nand").click();

  const component = page.locator('[data-testid^="component-"]').first();
  await connect(
    page,
    page.getByTestId("pin-interface-in"),
    component.locator('[data-pin-id="a"]'),
  );
  await page.waitForTimeout(100);

  await page.evaluate(() => {
    const raw = localStorage.getItem("gateos-lab:v0.1");
    if (!raw) throw new Error("missing saved project");
    const project = JSON.parse(raw);
    const circuit = project.circuits["logic.not"];
    circuit.instances[0].position = { x: 365, y: 221 };
    circuit.layout = {
      ...(circuit.layout ?? {}),
      interfacePositions: {
        in: { x: 137, y: 119 },
        out: { x: 787, y: 203 },
      },
    };
    circuit.connections[0].route = [{ x: 277, y: 199 }];
    localStorage.setItem("gateos-lab:v0.1", JSON.stringify(project));
  });

  await page.reload();

  const migrated = page.locator('[data-testid^="component-"]').first();
  const componentX = Number(await migrated.getAttribute("data-position-x"));
  const componentY = Number(await migrated.getAttribute("data-position-y"));
  expect(componentX % 12).toBe(0);
  expect(componentY % 12).toBe(0);

  const input = page.getByTestId("input-in");
  const output = page.getByTestId("output-out");
  expect(Number(await input.getAttribute("data-terminal-x")) % 12).toBe(0);
  expect(Number(await input.getAttribute("data-terminal-y")) % 12).toBe(0);
  expect(Number(await output.getAttribute("data-terminal-x")) % 12).toBe(0);
  expect(Number(await output.getAttribute("data-terminal-y")) % 12).toBe(0);

  const routeNode = page.locator("circle.wire-node:not(.draft)").first();
  await expect(routeNode).toBeVisible();
  expect(Number(await routeNode.getAttribute("cx")) % 12).toBe(0);
  expect(Number(await routeNode.getAttribute("cy")) % 12).toBe(0);
});

test("challenge hints reveal progressively in exactly three stages", async ({
  page,
}) => {
  const panel = page.getByTestId("hints-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("hint-level-1")).toHaveCount(0);
  await expect(page.getByTestId("hint-level-2")).toHaveCount(0);
  await expect(page.getByTestId("hint-level-3")).toHaveCount(0);

  const reveal = page.getByTestId("reveal-hint");
  await expect(reveal).toHaveText("힌트 1단계 보기");

  await reveal.click();
  await expect(page.getByTestId("hint-level-1")).toBeVisible();
  await expect(page.getByTestId("hint-level-2")).toHaveCount(0);
  await expect(reveal).toHaveText("힌트 2단계 보기");

  await reveal.click();
  await expect(page.getByTestId("hint-level-2")).toBeVisible();
  await expect(page.getByTestId("hint-level-3")).toHaveCount(0);
  await expect(reveal).toHaveText("힌트 3단계 보기");

  await reveal.click();
  await expect(page.getByTestId("hint-level-3")).toBeVisible();
  await expect(page.getByTestId("reveal-hint")).toHaveCount(0);
  await expect(panel).toContainText("3단계까지 확인함");
  await expect(panel).toContainText("NAND");
});

test("component pin names live in the inspector instead of the canvas", async ({
  page,
}) => {
  await page.getByTestId("palette-builtin.nand").click();

  const component = page.locator('[data-testid^="component-"]').first();
  await component.click();

  await expect(component.locator(".compact-pin-name")).toHaveCount(0);

  const ioPanel = page.getByTestId("component-io-panel");
  await expect(ioPanel).toBeVisible();

  const inputs = page.getByTestId("component-io-inputs");
  const outputs = page.getByTestId("component-io-outputs");

  await expect(inputs).toContainText("입력 (Inputs)");
  await expect(inputs).toContainText("A");
  await expect(inputs).toContainText("B");
  await expect(outputs).toContainText("출력 (Outputs)");
  await expect(outputs).toContainText("OUT");

  await expect(page.getByTestId("component-io-pin-a")).toContainText("1 bit");
  await expect(page.getByTestId("component-io-pin-b")).toContainText("1 bit");
  await expect(page.getByTestId("component-io-pin-out")).toContainText("1 bit");
});


test("challenge 11 completion unlocks the multi-bit curriculum slice", async ({
  page,
}) => {
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
          "state.sr-latch",
          "state.d-latch",
          "state.dff",
          "state.enable-register",
        ],
        probes: {},
      }),
    );
  });
  await page.reload();

  const mux4 = page.getByTestId("challenge-routing.mux4");
  await expect(mux4).toBeEnabled();
  await mux4.click();

  await expect(
    page.getByRole("heading", { name: "4-bit Multiplexer" }),
  ).toBeVisible();
  await expect(page.getByTestId("palette-builtin.split4")).toBeVisible();
  await expect(page.getByTestId("palette-builtin.join4")).toBeVisible();

  await expect(
    page.getByTestId("challenge-state.program-counter4"),
  ).toBeVisible();
});
