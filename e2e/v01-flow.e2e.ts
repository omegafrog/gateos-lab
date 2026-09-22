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

async function pointOnSvgPath(
  path: Locator,
  ratio = 0.5,
): Promise<{ x: number; y: number }> {
  return path.evaluate((element, ratioValue) => {
    const svgPath = element as SVGPathElement;
    const length = svgPath.getTotalLength();
    const local = svgPath.getPointAtLength(length * ratioValue);
    const matrix = svgPath.getScreenCTM();
    if (!matrix) throw new Error("missing SVG transform");
    const point = new DOMPoint(local.x, local.y).matrixTransform(matrix);
    return { x: point.x, y: point.y };
  }, ratio);
}

async function openCurriculum(page: Page): Promise<void> {
  const toggle = page.getByTestId("curriculum-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
}

async function selectChallenge(page: Page, id: string): Promise<void> {
  await openCurriculum(page);
  await page.getByTestId(`challenge-${id}`).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("gateos-lab:view", "lab");
  });
  await page.reload();
});

test("fresh visitors enter the interactive NAND-to-App journey", async ({ page }) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await expect(page.getByTestId("journey-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: /컴퓨터의 모든 층을/ })).toBeVisible();
  await expect(page.getByTestId("journey-scene-logic")).toBeVisible();
  await expect(page.getByTestId("journey-scene-cpu")).toBeAttached();
  await expect(page.getByTestId("journey-scene-os")).toBeAttached();

  await page.getByTestId("journey-enter-lab").click();
  await expect(page.getByTestId("palette-builtin.nand")).toBeVisible();
});

test("journey reflows on a phone viewport without page-level horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await expect(page.getByTestId("journey-page")).toBeVisible();
  await expect(page.getByTestId("journey-assembly")).toBeVisible();

  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  expect(fits).toBe(true);
});

test("curriculum is split into stage pages instead of one long list", async ({
  page,
}) => {
  await expect(page.getByTestId("curriculum-toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(page.getByTestId("curriculum-toggle")).toHaveClass(
    /curriculum-side-tab/,
  );
  await expect(page.getByTestId("palette-builtin.nand")).toBeVisible();
  await openCurriculum(page);
  await expect(page.getByTestId("stage-title")).toHaveText("Logic Foundations");
  await expect(page.getByTestId("stage-challenge-list").locator(".challenge-item")).toHaveCount(7);

  await expect(page.getByTestId("challenge-logic.not")).toBeVisible();
  await expect(page.getByTestId("challenge-arithmetic.full-adder")).toBeVisible();
  await expect(page.getByTestId("challenge-state.sr-latch")).toHaveCount(0);
  await expect(page.getByTestId("challenge-cpu.alu-datapath4")).toHaveCount(0);

  await expect(page.getByTestId("stage-state")).toBeDisabled();
  await expect(page.getByTestId("stage-memory")).toBeDisabled();
  await expect(page.getByTestId("stage-cpu")).toBeDisabled();
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

  await openCurriculum(page);
  const andChallenge = page.getByTestId("challenge-logic.and");
  await expect(andChallenge).toBeEnabled();
  await andChallenge.click();

  await expect(page.getByTestId("palette-user.not")).toBeVisible();

  await page.reload();

  await openCurriculum(page);
  await expect(page.getByTestId("challenge-logic.and")).toBeEnabled();
  await page.getByTestId("challenge-logic.and").click();
  await expect(page.getByTestId("palette-user.not")).toBeVisible();
});

test("sequence verification hides setup steps and shows only expected versus current", async ({
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
        ],
      }),
    );
  });
  await page.reload();

  await expect(page.getByRole("heading", { name: "SR Latch" })).toBeVisible();
  const checks = page.locator(".sequence-step-row");
  await expect(checks).toHaveCount(4);
  await expect(checks.first()).toContainText("EXPECTED VALUE");
  await expect(checks.first()).toContainText("CURRENT VALUE");
  await expect(checks.first()).not.toContainText("SET");
  await expect(checks.first()).not.toContainText("EDGE");
  await expect(checks.first()).not.toContainText("CLOCK");
});

test("chip state reset control is available beside verification actions", async ({ page }) => {
  const reset = page.getByTestId("reset-chip-state");
  await expect(reset).toBeVisible();
  await expect(reset).toBeEnabled();
});

test("4-bit register clock control applies staged D and LOAD and produces a real rising edge", async ({
  page,
}) => {
  await page.evaluate(() => {
    const publishedEnableRegister = {
      schema: "gateos.circuit/v1",
      id: "artifact.state.enable-register",
      name: "1-bit Enable Register",
      pins: [
        { id: "d", name: "D", direction: "input", width: 1 },
        { id: "load", name: "LOAD", direction: "input", width: 1 },
        { id: "clk", name: "CLK", direction: "input", width: 1 },
        { id: "q", name: "Q", direction: "output", width: 1 },
      ],
      instances: [],
      connections: [],
    };

    const register4 = {
      schema: "gateos.circuit/v1",
      id: "submission.state.register4",
      name: "4-bit Enable Register",
      pins: [
        { id: "d", name: "D", direction: "input", width: 4 },
        { id: "load", name: "LOAD", direction: "input", width: 1 },
        { id: "clk", name: "CLK", direction: "input", width: 1 },
        { id: "q", name: "Q", direction: "output", width: 4 },
      ],
      instances: [
        { id: "split", componentId: "builtin.split4" },
        { id: "join", componentId: "builtin.join4" },
        { id: "r0", componentId: "user.enable-register" },
        { id: "r1", componentId: "user.enable-register" },
        { id: "r2", componentId: "user.enable-register" },
        { id: "r3", componentId: "user.enable-register" },
      ],
      connections: [
        { id: "d-split", from: { kind: "interface", pinId: "d" }, to: { kind: "instance", instanceId: "split", pinId: "in" } },
        { id: "b0-d", from: { kind: "instance", instanceId: "split", pinId: "b0" }, to: { kind: "instance", instanceId: "r0", pinId: "d" } },
        { id: "b1-d", from: { kind: "instance", instanceId: "split", pinId: "b1" }, to: { kind: "instance", instanceId: "r1", pinId: "d" } },
        { id: "b2-d", from: { kind: "instance", instanceId: "split", pinId: "b2" }, to: { kind: "instance", instanceId: "r2", pinId: "d" } },
        { id: "b3-d", from: { kind: "instance", instanceId: "split", pinId: "b3" }, to: { kind: "instance", instanceId: "r3", pinId: "d" } },
        { id: "load0", from: { kind: "interface", pinId: "load" }, to: { kind: "instance", instanceId: "r0", pinId: "load" } },
        { id: "load1", from: { kind: "interface", pinId: "load" }, to: { kind: "instance", instanceId: "r1", pinId: "load" } },
        { id: "load2", from: { kind: "interface", pinId: "load" }, to: { kind: "instance", instanceId: "r2", pinId: "load" } },
        { id: "load3", from: { kind: "interface", pinId: "load" }, to: { kind: "instance", instanceId: "r3", pinId: "load" } },
        { id: "clk0", from: { kind: "interface", pinId: "clk" }, to: { kind: "instance", instanceId: "r0", pinId: "clk" } },
        { id: "clk1", from: { kind: "interface", pinId: "clk" }, to: { kind: "instance", instanceId: "r1", pinId: "clk" } },
        { id: "clk2", from: { kind: "interface", pinId: "clk" }, to: { kind: "instance", instanceId: "r2", pinId: "clk" } },
        { id: "clk3", from: { kind: "interface", pinId: "clk" }, to: { kind: "instance", instanceId: "r3", pinId: "clk" } },
        { id: "q0", from: { kind: "instance", instanceId: "r0", pinId: "q" }, to: { kind: "instance", instanceId: "join", pinId: "b0" } },
        { id: "q1", from: { kind: "instance", instanceId: "r1", pinId: "q" }, to: { kind: "instance", instanceId: "join", pinId: "b1" } },
        { id: "q2", from: { kind: "instance", instanceId: "r2", pinId: "q" }, to: { kind: "instance", instanceId: "join", pinId: "b2" } },
        { id: "q3", from: { kind: "instance", instanceId: "r3", pinId: "q" }, to: { kind: "instance", instanceId: "join", pinId: "b3" } },
        { id: "join-q", from: { kind: "instance", instanceId: "join", pinId: "out" }, to: { kind: "interface", pinId: "q" } },
      ],
    };

    localStorage.setItem(
      "gateos-lab:v0.1",
      JSON.stringify({
        schema: "gateos.project/v1",
        circuits: { "state.register4": register4 },
        published: { "user.enable-register": publishedEnableRegister },
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
          "routing.mux4",
          "arithmetic.adder4",
          "arithmetic.incrementer4",
        ],
      }),
    );
  });
  await page.reload();

  await expect(page.getByRole("heading", { name: "4-bit Enable Register" })).toBeVisible();
  await expect(page.getByTestId("output-q")).toHaveAttribute("data-value", "XXXX");

  page.once("dialog", (dialog) => dialog.accept("10"));
  await page.getByTestId("input-d").locator("rect.interface-terminal-body").click();
  await page.getByTestId("input-load").locator("rect.interface-terminal-body").click();

  await expect(page.getByTestId("input-d")).toHaveAttribute("data-draft-value", "1010");
  await expect(page.getByTestId("input-load")).toHaveAttribute("data-draft-value", "1");

  await page.getByTestId("clock-rising").click();

  await expect(page.getByTestId("output-q")).toHaveAttribute("data-value", "1010");
  await expect(page.getByTestId("input-clk")).toHaveAttribute("data-applied-value", "1");
  await expect(page.getByTestId("input-d")).toHaveAttribute("data-applied-value", "1010");
  await expect(page.getByTestId("input-load")).toHaveAttribute("data-applied-value", "1");
});

test("right-click context menu deletes wires and components", async ({ page }) => {
  await page.getByTestId("palette-builtin.nand").click();

  const component = page.locator('[data-testid^="component-"]').first();
  const source = page.getByTestId("pin-interface-in");
  const inputA = component.locator('[data-pin-id="a"]');

  await connect(page, source, inputA);
  const wire = page.locator("path.wire-hit-target").first();
  await expect(wire).toBeVisible();

  await wire.click({ button: "right", position: { x: 4, y: 4 } });
  await expect(page.getByTestId("canvas-context-menu")).toBeVisible();
  await expect(page.getByTestId("context-delete-wire")).toBeVisible();
  await page.getByTestId("context-delete-wire").click();
  await expect(page.locator("path.wire-hit-target")).toHaveCount(0);

  await component.click({ button: "right", position: { x: 24, y: 24 } });
  await expect(page.getByTestId("canvas-context-menu")).toBeVisible();
  await expect(page.getByTestId("context-delete-component")).toBeVisible();
  await page.getByTestId("context-delete-component").click();
  await expect(page.locator('[data-testid^="component-"]')).toHaveCount(0);
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

  await selectChallenge(page, "state.sr-latch");

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
  await selectChallenge(page, "arithmetic.half-adder");

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

test("wire routing keeps long runs orthogonal and limits diagonals to one hidden cell", async ({
  page,
}) => {
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
  const points = Array.from(
    path.matchAll(/[ML]\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g),
    (match) => ({ x: Number(match[1]), y: Number(match[2]) }),
  );

  expect(points.length).toBeGreaterThan(2);
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);
    const orthogonal = dx === 0 || dy === 0;
    const oneCellDiagonal = dx === 12 && dy === 12;
    expect(
      orthogonal || oneCellDiagonal,
      `segment ${JSON.stringify(start)} -> ${JSON.stringify(end)} must stay on-grid`,
    ).toBe(true);
  }

  await expect(page.locator("path.wire-preview")).toHaveCount(0);
});

test("an explicit wire segment may cross exactly one hidden cell diagonally", async ({
  page,
}) => {
  await page.getByTestId("palette-builtin.nand").click();

  const component = page.locator('[data-testid^="component-"]').first();
  const source = page.getByTestId("pin-interface-in");
  await connect(page, source, component.locator('[data-pin-id="a"]'));

  const sourceX = Number(await source.getAttribute("cx"));
  const sourceY = Number(await source.getAttribute("cy"));

  await page.evaluate(
    ({ sourceX, sourceY }) => {
      const raw = localStorage.getItem("gateos-lab:v0.1");
      if (!raw) throw new Error("missing saved project");
      const project = JSON.parse(raw);
      const connection = project.circuits["logic.not"]?.connections?.[0];
      if (!connection) throw new Error("missing saved connection");
      connection.route = [{ x: sourceX + 12, y: sourceY + 12 }];
      localStorage.setItem("gateos-lab:v0.1", JSON.stringify(project));
    },
    { sourceX, sourceY },
  );
  await page.reload();

  const wire = page.locator("path.wire:not(.wire-preview)").first();
  const path = (await wire.getAttribute("d")) ?? "";
  const points = Array.from(
    path.matchAll(/[ML]\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g),
    (match) => ({ x: Number(match[1]), y: Number(match[2]) }),
  );

  expect(points[0]).toEqual({ x: sourceX, y: sourceY });
  expect(points[1]).toEqual({ x: sourceX + 12, y: sourceY + 12 });
});

test("wire routing can pause at a grid node and resume to a pin", async ({
  page,
}) => {
  await page.getByTestId("palette-builtin.nand").click();

  const component = page.locator('[data-testid^="component-"]').first();
  const from = page.getByTestId("pin-interface-in");
  const to = component.locator('[data-pin-id="a"]');

  // Educational content above the canvas can place it below the initial
  // viewport. Bring the canvas endpoints on-screen before converting their
  // browser coordinates into pointer coordinates.
  await from.scrollIntoViewIfNeeded();
  await to.scrollIntoViewIfNeeded();

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

  await draftEnd.hover();
  await page.mouse.down();
  await to.hover();
  await page.mouse.up();

  await expect(page.getByTestId("draft-wire-end")).toHaveCount(0);

  const routeNode = page.locator("circle.wire-node:not(.draft)").first();
  await expect(routeNode).toBeVisible();
  await expect(routeNode).toHaveAttribute("cx", String(draftX));
  await expect(routeNode).toHaveAttribute("cy", String(draftY));

  const wire = page.locator("path.wire:not(.wire-preview)").first();
  const path = (await wire.getAttribute("d")) ?? "";
  expect(path).toContain(`${draftX} ${draftY}`);

  const points = Array.from(
    path.matchAll(/[ML]\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g),
    (match) => ({ x: Number(match[1]), y: Number(match[2]) }),
  );
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);
    expect(dx === 0 || dy === 0 || (dx === 12 && dy === 12)).toBe(true);
  }
});

test("clicking a wire does not create a branch or joint", async ({ page }) => {
  await page.getByTestId("palette-builtin.nand").click();

  const component = page.locator('[data-testid^="component-"]').first();
  const source = page.getByTestId("pin-interface-in");
  const inputA = component.locator('[data-pin-id="a"]');

  await connect(page, source, inputA);

  const hitTarget = page.locator("path.wire-hit-target").first();
  await expect(hitTarget).toBeVisible();
  const { x, y } = await pointOnSvgPath(hitTarget);

  await page.mouse.click(x, y);
  await expect(page.locator("circle.wire-junction")).toHaveCount(0);
  await expect(page.getByTestId("draft-wire-end")).toHaveCount(0);

  await page.keyboard.down("Alt");
  await page.mouse.click(x, y);
  await page.keyboard.up("Alt");

  await expect(page.locator("circle.wire-junction")).toHaveCount(0);
  await expect(page.getByTestId("draft-wire-end")).toHaveCount(0);

  const routeLength = await page.evaluate(() => {
    const raw = localStorage.getItem("gateos-lab:v0.1");
    if (!raw) return -1;
    const project = JSON.parse(raw);
    return project.circuits["logic.not"]?.connections?.[0]?.route?.length ?? 0;
  });
  expect(routeLength).toBe(0);
});

test("dragging from an existing wire creates a branch immediately", async ({
  page,
}) => {
  await page.getByTestId("palette-builtin.nand").click();

  const component = page.locator('[data-testid^="component-"]').first();
  const source = page.getByTestId("pin-interface-in");
  const inputA = component.locator('[data-pin-id="a"]');
  const inputB = component.locator('[data-pin-id="b"]');

  await connect(page, source, inputA);

  const hitTarget = page.locator("path.wire-hit-target").first();
  await expect(hitTarget).toBeVisible();
  const branchPoint = await pointOnSvgPath(hitTarget);

  await page.mouse.move(branchPoint.x, branchPoint.y);
  await page.mouse.down();
  await inputB.hover();
  await page.mouse.up();

  await expect(page.getByTestId("draft-wire-end")).toHaveCount(0);
  await expect(page.locator("path.wire:not(.wire-preview)")).toHaveCount(2);

  const junction = page.locator("circle.wire-junction").first();
  await expect(junction).toBeVisible();
  expect(Number(await junction.getAttribute("cx")) % 12).toBe(0);
  expect(Number(await junction.getAttribute("cy")) % 12).toBe(0);

  const savedBranchCount = await page.evaluate(() => {
    const raw = localStorage.getItem("gateos-lab:v0.1");
    if (!raw) return 0;
    const project = JSON.parse(raw);
    const connections = project.circuits["logic.not"]?.connections ?? [];
    return connections.filter(
      (connection: { branchStart?: { x: number; y: number } }) =>
        connection.branchStart,
    ).length;
  });
  expect(savedBranchCount).toBe(1);
});

test("alt-dragging a wire segment inserts and moves a joint", async ({
  page,
}) => {
  await page.getByTestId("palette-builtin.nand").click();

  const component = page.locator('[data-testid^="component-"]').first();
  const source = page.getByTestId("pin-interface-in");
  const inputA = component.locator('[data-pin-id="a"]');

  await connect(page, source, inputA);

  const hitTarget = page.locator("path.wire-hit-target").first();
  const { x: startX, y: startY } = await pointOnSvgPath(hitTarget);

  await page.keyboard.down("Alt");
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 72, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Alt");

  const joint = page.locator("circle.wire-junction").first();
  await expect(joint).toBeVisible();

  const jointX = Number(await joint.getAttribute("cx"));
  const jointY = Number(await joint.getAttribute("cy"));
  expect(jointX % 12).toBe(0);
  expect(jointY % 12).toBe(0);

  const savedRoute = await page.evaluate(() => {
    const raw = localStorage.getItem("gateos-lab:v0.1");
    if (!raw) return [];
    const project = JSON.parse(raw);
    return project.circuits["logic.not"]?.connections?.[0]?.route ?? [];
  });
  expect(savedRoute).toHaveLength(1);
  expect(savedRoute[0]).toEqual({ x: jointX, y: jointY });

  const wire = page.locator("path.wire:not(.wire-preview)").first();
  const path = (await wire.getAttribute("d")) ?? "";
  expect((path.match(/ L /g) ?? []).length).toBe(2);
});

test("dragging a connected wire endpoint moves that wire to another pin", async ({
  page,
}) => {
  await page.getByTestId("palette-builtin.nand").click();

  const component = page.locator('[data-testid^="component-"]').first();
  const source = page.getByTestId("pin-interface-in");
  const inputA = component.locator('[data-pin-id="a"]');
  const inputB = component.locator('[data-pin-id="b"]');

  await connect(page, source, inputA);
  await expect(page.locator("path.wire:not(.wire-preview)")).toHaveCount(1);

  await inputA.hover();
  await page.mouse.down();
  await inputB.hover();
  await page.mouse.up();

  await expect(page.locator("path.wire:not(.wire-preview)")).toHaveCount(1);

  const path = (await page
    .locator("path.wire:not(.wire-preview)")
    .first()
    .getAttribute("d")) ?? "";
  const numbers = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const targetX = Number(await inputB.getAttribute("cx"));
  const targetY = Number(await inputB.getAttribute("cy"));
  expect(numbers.at(-2)).toBe(targetX);
  expect(numbers.at(-1)).toBe(targetY);
});

test("wire probes are removed from the inspector", async ({ page }) => {
  await page.getByTestId("palette-builtin.nand").click();
  const component = page.locator('[data-testid^="component-"]').first();

  await connect(
    page,
    page.getByTestId("pin-interface-in"),
    component.locator('[data-pin-id="a"]'),
  );

  await page.locator("path.wire-hit-target").first().click();

  await expect(page.getByRole("heading", { name: "Probes" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add probe" })).toHaveCount(0);
});

test("4-bit zero constant is known immediately and stays known after selecting the mux", async ({
  page,
}) => {
  await page.evaluate(() => {
    localStorage.setItem(
      "gateos-lab:v0.1",
      JSON.stringify({
        schema: "gateos.project/v1",
        circuits: {},
        published: {
          "user.mux4": {
            schema: "gateos.circuit/v1",
            id: "user.mux4",
            name: "4-bit Multiplexer",
            pins: [
              { id: "a", name: "A", direction: "input", width: 4 },
              { id: "b", name: "B", direction: "input", width: 4 },
              { id: "sel", name: "SEL", direction: "input", width: 1 },
              { id: "out", name: "OUT", direction: "output", width: 4 },
            ],
            instances: [],
            connections: [],
          },
        },
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
          "routing.mux4",
          "arithmetic.adder4",
          "arithmetic.incrementer4",
          "state.register4",
        ],
      }),
    );
  });
  await page.reload();

  await expect(
    page.getByRole("heading", { name: "4-bit Counter" }),
  ).toBeVisible();

  await page.getByTestId("palette-builtin.const4.zero").click();
  await page.getByTestId("palette-user.mux4").click();

  const zero = page.locator('[data-component-id="builtin.const4.zero"]').first();
  const mux = page.locator('[data-component-id="user.mux4"]').first();
  await connect(
    page,
    zero.locator('[data-pin-id="out"]'),
    mux.locator('[data-pin-id="b"]'),
  );

  const wire = page.locator("path.wire:not(.wire-preview)").first();
  await expect(wire).toHaveAttribute("data-signal-value", "0000");
  await expect(wire).toHaveClass(/value-zero/);
  await expect(wire).not.toHaveClass(/value-x/);

  await mux.click();

  await expect(wire).toHaveAttribute("data-signal-value", "0000");
  await expect(wire).toHaveClass(/value-zero/);
  await expect(page.getByTestId("component-io-pin-b")).toContainText("0000");
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

  await openCurriculum(page);
  await expect(page.getByTestId("stage-title")).toHaveText(
    "Multi-bit Building Blocks",
  );

  const mux4 = page.getByTestId("challenge-routing.mux4");
  await expect(mux4).toBeEnabled();
  await mux4.click();

  await expect(
    page.getByRole("heading", { name: "4-bit Multiplexer" }),
  ).toBeVisible();
  await expect(page.getByTestId("palette-builtin.split4")).toBeVisible();
  await expect(page.getByTestId("palette-builtin.join4")).toBeVisible();

  await openCurriculum(page);
  await expect(
    page.getByTestId("challenge-state.program-counter4"),
  ).toBeVisible();
  await expect(page.getByTestId("challenge-logic.not")).toHaveCount(0);

  await page.getByTestId("stage-state").click();
  await expect(page.getByTestId("stage-title")).toHaveText("State & Sequential");
  await expect(page.getByTestId("challenge-state.sr-latch")).toBeVisible();
  await expect(page.getByTestId("challenge-routing.mux4")).toHaveCount(0);

  await page.getByTestId("stage-multibit").click();
  await expect(page.getByTestId("stage-title")).toHaveText(
    "Multi-bit Building Blocks",
  );
});
