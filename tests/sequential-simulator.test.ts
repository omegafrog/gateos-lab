import { describe, expect, it } from "vitest";
import {
  BitVector,
  ComponentRegistry,
  createBuiltinComponentRegistry,
  type CircuitDefinition,
} from "@gateos/circuit-model";
import { compileCircuit } from "@gateos/circuit-compiler";
import {
  createBuiltinPrimitiveRegistry,
  Simulator,
} from "@gateos/sim-core";

function dffCircuit(): CircuitDefinition {
  return {
    schema: "gateos.circuit/v1",
    id: "test.dff",
    name: "DFF test",
    pins: [
      { id: "d", name: "D", direction: "input", width: 1 },
      { id: "q", name: "Q", direction: "output", width: 1 },
    ],
    instances: [{ id: "ff", componentId: "builtin.dff" }],
    connections: [
      {
        id: "d",
        from: { kind: "interface", pinId: "d" },
        to: { kind: "instance", instanceId: "ff", pinId: "d" },
      },
      {
        id: "q",
        from: { kind: "instance", instanceId: "ff", pinId: "q" },
        to: { kind: "interface", pinId: "q" },
      },
    ],
  };
}

function registryWithPublishedUserDff(): ComponentRegistry {
  const registry = createBuiltinComponentRegistry();
  registry.register({
    kind: "composite",
    id: "user.dff",
    name: "Published learner DFF",
    circuit: {
      schema: "gateos.circuit/v1",
      id: "artifact.state.dff",
      name: "D Flip-Flop",
      pins: [
        { id: "d", name: "D", direction: "input", width: 1 },
        { id: "clk", name: "CLK", direction: "input", width: 1 },
        { id: "q", name: "Q", direction: "output", width: 1 },
      ],
      // The compiler intentionally treats a published user.dff as an atomic
      // state boundary when it is reused by a parent circuit.
      instances: [],
      connections: [],
    },
  });
  return registry;
}

function registryWithPublishedRegister4(): ComponentRegistry {
  const registry = createBuiltinComponentRegistry();
  registry.register({
    kind: "composite",
    id: "user.register4",
    name: "4-bit Enable Register",
    circuit: {
      schema: "gateos.circuit/v1",
      id: "artifact.state.register4",
      name: "4-bit Enable Register",
      pins: [
        { id: "d", name: "D", direction: "input", width: 4 },
        { id: "load", name: "LOAD", direction: "input", width: 1 },
        { id: "clk", name: "CLK", direction: "input", width: 1 },
        { id: "q", name: "Q", direction: "output", width: 4 },
      ],
      instances: [],
      connections: [],
    },
  });
  registry.register({
    kind: "primitive",
    id: "test.incrementer4",
    name: "Incrementer4",
    primitiveId: "test.incrementer4",
    pins: [
      { id: "in", name: "IN", direction: "input", width: 4 },
      { id: "out", name: "OUT", direction: "output", width: 4 },
    ],
  });
  registry.register({
    kind: "primitive",
    id: "test.mux4",
    name: "Mux4",
    primitiveId: "test.mux4",
    pins: [
      { id: "a", name: "A", direction: "input", width: 4 },
      { id: "b", name: "B", direction: "input", width: 4 },
      { id: "sel", name: "SEL", direction: "input", width: 1 },
      { id: "out", name: "OUT", direction: "output", width: 4 },
    ],
  });
  return registry;
}

function counterFeedbackCircuit(): CircuitDefinition {
  return {
    schema: "gateos.circuit/v1",
    id: "test.counter-feedback",
    name: "Counter feedback",
    pins: [
      { id: "enable", name: "ENABLE", direction: "input", width: 1 },
      { id: "reset", name: "RESET", direction: "input", width: 1 },
      { id: "clk", name: "CLK", direction: "input", width: 1 },
      { id: "q", name: "Q", direction: "output", width: 4 },
    ],
    instances: [
      { id: "reg", componentId: "user.register4" },
      { id: "inc", componentId: "test.incrementer4" },
      { id: "enableMux", componentId: "test.mux4" },
      { id: "resetMux", componentId: "test.mux4" },
      { id: "zero", componentId: "builtin.const4.zero" },
      { id: "one", componentId: "builtin.const1.one" },
    ],
    connections: [
      {
        id: "q-inc",
        from: { kind: "instance", instanceId: "reg", pinId: "q" },
        to: { kind: "instance", instanceId: "inc", pinId: "in" },
      },
      {
        id: "q-enable-a",
        from: { kind: "instance", instanceId: "reg", pinId: "q" },
        to: { kind: "instance", instanceId: "enableMux", pinId: "a" },
      },
      {
        id: "inc-enable-b",
        from: { kind: "instance", instanceId: "inc", pinId: "out" },
        to: { kind: "instance", instanceId: "enableMux", pinId: "b" },
      },
      {
        id: "enable-sel",
        from: { kind: "interface", pinId: "enable" },
        to: { kind: "instance", instanceId: "enableMux", pinId: "sel" },
      },
      {
        id: "enable-reset-a",
        from: { kind: "instance", instanceId: "enableMux", pinId: "out" },
        to: { kind: "instance", instanceId: "resetMux", pinId: "a" },
      },
      {
        id: "zero-reset-b",
        from: { kind: "instance", instanceId: "zero", pinId: "out" },
        to: { kind: "instance", instanceId: "resetMux", pinId: "b" },
      },
      {
        id: "reset-sel",
        from: { kind: "interface", pinId: "reset" },
        to: { kind: "instance", instanceId: "resetMux", pinId: "sel" },
      },
      {
        id: "next-d",
        from: { kind: "instance", instanceId: "resetMux", pinId: "out" },
        to: { kind: "instance", instanceId: "reg", pinId: "d" },
      },
      {
        id: "load-one",
        from: { kind: "instance", instanceId: "one", pinId: "out" },
        to: { kind: "instance", instanceId: "reg", pinId: "load" },
      },
      {
        id: "clk",
        from: { kind: "interface", pinId: "clk" },
        to: { kind: "instance", instanceId: "reg", pinId: "clk" },
      },
      {
        id: "q",
        from: { kind: "instance", instanceId: "reg", pinId: "q" },
        to: { kind: "interface", pinId: "q" },
      },
    ],
  };
}

function explicitClockDffCircuit(chained = false): CircuitDefinition {
  return {
    schema: "gateos.circuit/v1",
    id: chained ? "test.user-dff-chain" : "test.user-dff",
    name: chained ? "User DFF chain" : "User DFF",
    pins: [
      { id: "d", name: "D", direction: "input", width: 1 },
      { id: "clk", name: "CLK", direction: "input", width: 1 },
      { id: "q1", name: "Q1", direction: "output", width: 1 },
      ...(chained
        ? [{ id: "q2", name: "Q2", direction: "output" as const, width: 1 }]
        : []),
    ],
    instances: [
      { id: "ff1", componentId: "user.dff" },
      ...(chained ? [{ id: "ff2", componentId: "user.dff" }] : []),
    ],
    connections: [
      {
        id: "d-ff1",
        from: { kind: "interface", pinId: "d" },
        to: { kind: "instance", instanceId: "ff1", pinId: "d" },
      },
      {
        id: "clk-ff1",
        from: { kind: "interface", pinId: "clk" },
        to: { kind: "instance", instanceId: "ff1", pinId: "clk" },
      },
      {
        id: "q1-out",
        from: { kind: "instance", instanceId: "ff1", pinId: "q" },
        to: { kind: "interface", pinId: "q1" },
      },
      ...(chained
        ? [
            {
              id: "q1-ff2",
              from: {
                kind: "instance" as const,
                instanceId: "ff1",
                pinId: "q",
              },
              to: {
                kind: "instance" as const,
                instanceId: "ff2",
                pinId: "d",
              },
            },
            {
              id: "clk-ff2",
              from: { kind: "interface" as const, pinId: "clk" },
              to: {
                kind: "instance" as const,
                instanceId: "ff2",
                pinId: "clk",
              },
            },
            {
              id: "q2-out",
              from: {
                kind: "instance" as const,
                instanceId: "ff2",
                pinId: "q",
              },
              to: { kind: "interface" as const, pinId: "q2" },
            },
          ]
        : []),
    ],
  };
}

describe("sequential simulation", () => {
  it("samples D only on the rising edge", () => {
    const simulator = new Simulator(
      compileCircuit(dffCircuit(), createBuiltinComponentRegistry()),
      createBuiltinPrimitiveRegistry(),
    );

    simulator.setInput("d", BitVector.fromBinary("1"));
    simulator.settle();

    expect(simulator.readOutput("q").toBinary()).toBe("X");

    simulator.stepEdge("rising");
    expect(simulator.readOutput("q").toBinary()).toBe("1");

    simulator.setInput("d", BitVector.fromBinary("0"));
    simulator.settle();
    expect(simulator.readOutput("q").toBinary()).toBe("1");

    simulator.stepEdge("falling");
    expect(simulator.readOutput("q").toBinary()).toBe("1");

    simulator.stepEdge("rising");
    expect(simulator.readOutput("q").toBinary()).toBe("0");
  });

  it("uses sample-then-commit semantics across chained flip-flops", () => {
    const circuit: CircuitDefinition = {
      schema: "gateos.circuit/v1",
      id: "test.dff-chain",
      name: "DFF chain",
      pins: [
        { id: "d", name: "D", direction: "input", width: 1 },
        { id: "q1", name: "Q1", direction: "output", width: 1 },
        { id: "q2", name: "Q2", direction: "output", width: 1 },
      ],
      instances: [
        { id: "ff1", componentId: "builtin.dff" },
        { id: "ff2", componentId: "builtin.dff" },
      ],
      connections: [
        {
          id: "in",
          from: { kind: "interface", pinId: "d" },
          to: { kind: "instance", instanceId: "ff1", pinId: "d" },
        },
        {
          id: "chain",
          from: { kind: "instance", instanceId: "ff1", pinId: "q" },
          to: { kind: "instance", instanceId: "ff2", pinId: "d" },
        },
        {
          id: "q1",
          from: { kind: "instance", instanceId: "ff1", pinId: "q" },
          to: { kind: "interface", pinId: "q1" },
        },
        {
          id: "q2",
          from: { kind: "instance", instanceId: "ff2", pinId: "q" },
          to: { kind: "interface", pinId: "q2" },
        },
      ],
    };

    const simulator = new Simulator(
      compileCircuit(circuit, createBuiltinComponentRegistry()),
      createBuiltinPrimitiveRegistry(),
    );

    simulator.setInput("d", BitVector.fromBinary("1"));
    simulator.stepClock();

    expect(simulator.readOutput("q1").toBinary()).toBe("1");
    expect(simulator.readOutput("q2").toBinary()).toBe("X");

    simulator.stepClock();

    expect(simulator.readOutput("q1").toBinary()).toBe("1");
    expect(simulator.readOutput("q2").toBinary()).toBe("1");
    expect(simulator.cycle).toBe(2);
  });

  it("resets inputs, cycle, and sequential state deterministically", () => {
    const simulator = new Simulator(
      compileCircuit(dffCircuit(), createBuiltinComponentRegistry()),
      createBuiltinPrimitiveRegistry(),
    );

    simulator.setInput("d", BitVector.fromBinary("1"));
    simulator.stepClock();
    expect(simulator.readOutput("q").toBinary()).toBe("1");
    expect(simulator.cycle).toBe(1);

    simulator.reset();

    expect(simulator.readOutput("q").toBinary()).toBe("X");
    expect(simulator.cycle).toBe(0);
    expect(simulator.snapshot().inputs.d).toBe("X");
  });

  it("serializes and restores sequential state", () => {
    const netlist = compileCircuit(
      dffCircuit(),
      createBuiltinComponentRegistry(),
    );
    const primitives = createBuiltinPrimitiveRegistry();

    const original = new Simulator(netlist, primitives);
    original.setInput("d", BitVector.fromBinary("1"));
    original.stepClock();

    const snapshot = JSON.parse(
      JSON.stringify(original.snapshot()),
    ) as ReturnType<Simulator["snapshot"]>;

    const restored = new Simulator(
      netlist,
      createBuiltinPrimitiveRegistry(),
    );
    restored.restore(snapshot);

    expect(restored.readOutput("q").toBinary()).toBe("1");
    expect(restored.cycle).toBe(1);

    restored.setInput("d", BitVector.fromBinary("0"));
    restored.stepClock();
    expect(restored.readOutput("q").toBinary()).toBe("0");
    expect(restored.cycle).toBe(2);
  });

  it("treats a published user.dff as an explicit-clock state boundary", () => {
    const netlist = compileCircuit(
      explicitClockDffCircuit(),
      registryWithPublishedUserDff(),
    );
    expect(netlist.nodes).toHaveLength(1);
    expect(netlist.nodes[0]?.primitiveId).toBe("builtin.user-dff");

    const simulator = new Simulator(
      netlist,
      createBuiltinPrimitiveRegistry(),
    );

    simulator.setInput("d", BitVector.fromBinary("1"));
    simulator.setInput("clk", BitVector.fromBinary("0"));
    simulator.settle();
    expect(simulator.readOutput("q1").toBinary()).toBe("X");

    simulator.setInput("clk", BitVector.fromBinary("1"));
    simulator.settle();
    expect(simulator.readOutput("q1").toBinary()).toBe("1");

    simulator.setInput("d", BitVector.fromBinary("0"));
    simulator.settle();
    expect(simulator.readOutput("q1").toBinary()).toBe("1");

    simulator.setInput("clk", BitVector.fromBinary("0"));
    simulator.settle();
    expect(simulator.readOutput("q1").toBinary()).toBe("1");

    simulator.setInput("clk", BitVector.fromBinary("1"));
    simulator.settle();
    expect(simulator.readOutput("q1").toBinary()).toBe("0");
  });

  it("samples chained published user.dff instances before committing the edge", () => {
    const simulator = new Simulator(
      compileCircuit(
        explicitClockDffCircuit(true),
        registryWithPublishedUserDff(),
      ),
      createBuiltinPrimitiveRegistry(),
    );

    simulator.setInput("d", BitVector.fromBinary("1"));
    simulator.setInput("clk", BitVector.fromBinary("0"));
    simulator.settle();

    simulator.setInput("clk", BitVector.fromBinary("1"));
    simulator.settle();
    expect(simulator.readOutput("q1").toBinary()).toBe("1");
    expect(simulator.readOutput("q2").toBinary()).toBe("X");

    simulator.setInput("clk", BitVector.fromBinary("0"));
    simulator.settle();
    simulator.setInput("clk", BitVector.fromBinary("1"));
    simulator.settle();

    expect(simulator.readOutput("q1").toBinary()).toBe("1");
    expect(simulator.readOutput("q2").toBinary()).toBe("1");
  });

  it("keeps a published Register4 stable in a counter feedback loop", () => {
    const registry = registryWithPublishedRegister4();
    const primitives = createBuiltinPrimitiveRegistry();

    primitives.register("test.incrementer4", (inputs) => {
      const input = inputs.in?.toNumber();
      if (input === null || input === undefined) {
        return { out: BitVector.unknown(4) };
      }
      return { out: BitVector.fromNumber((input + 1) & 0xf, 4) };
    });
    primitives.register("test.mux4", (inputs) => {
      const sel = inputs.sel?.get(0);
      if (sel === 0) return { out: inputs.a ?? BitVector.unknown(4) };
      if (sel === 1) return { out: inputs.b ?? BitVector.unknown(4) };
      return { out: BitVector.unknown(4) };
    });

    const netlist = compileCircuit(counterFeedbackCircuit(), registry);
    expect(
      netlist.nodes.filter(
        (node) => node.primitiveId === "builtin.user-register",
      ),
    ).toHaveLength(1);

    const simulator = new Simulator(netlist, primitives);

    simulator.setInput("enable", BitVector.fromBinary("0"));
    simulator.setInput("reset", BitVector.fromBinary("1"));
    simulator.setInput("clk", BitVector.fromBinary("0"));
    simulator.settle();

    simulator.setInput("clk", BitVector.fromBinary("1"));
    simulator.settle();
    expect(simulator.readOutput("q").toBinary()).toBe("0000");

    simulator.setInput("clk", BitVector.fromBinary("0"));
    simulator.settle();

    // This is the exact transition that used to trigger the user's
    // 10,000-evaluation oscillation: enable feedback while CLK remains low.
    simulator.setInput("reset", BitVector.fromBinary("0"));
    simulator.setInput("enable", BitVector.fromBinary("1"));
    expect(() => simulator.settle()).not.toThrow();
    expect(simulator.readOutput("q").toBinary()).toBe("0000");

    simulator.setInput("clk", BitVector.fromBinary("1"));
    simulator.settle();
    expect(simulator.readOutput("q").toBinary()).toBe("0001");

    simulator.setInput("clk", BitVector.fromBinary("0"));
    simulator.settle();
    simulator.setInput("clk", BitVector.fromBinary("1"));
    simulator.settle();
    expect(simulator.readOutput("q").toBinary()).toBe("0010");
  });

  it("drives the Clock primitive high on rising and low on falling edges", () => {
    const circuit: CircuitDefinition = {
      schema: "gateos.circuit/v1",
      id: "test.clock",
      name: "Clock test",
      pins: [{ id: "clk", name: "CLK", direction: "output", width: 1 }],
      instances: [{ id: "clock", componentId: "builtin.clock" }],
      connections: [
        {
          id: "clk",
          from: { kind: "instance", instanceId: "clock", pinId: "out" },
          to: { kind: "interface", pinId: "clk" },
        },
      ],
    };

    const simulator = new Simulator(
      compileCircuit(circuit, createBuiltinComponentRegistry()),
      createBuiltinPrimitiveRegistry(),
    );

    expect(simulator.readOutput("clk").toBinary()).toBe("0");
    simulator.stepEdge("rising");
    expect(simulator.readOutput("clk").toBinary()).toBe("1");
    simulator.stepEdge("falling");
    expect(simulator.readOutput("clk").toBinary()).toBe("0");
  });
});
