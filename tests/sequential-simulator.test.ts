import { describe, expect, it } from "vitest";
import {
  BitVector,
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
