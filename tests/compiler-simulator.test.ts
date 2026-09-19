import { describe, expect, it } from "vitest";
import {
  BitVector,
  ComponentRegistry,
  createBuiltinComponentRegistry,
  type CircuitDefinition,
} from "../packages/circuit-model/src/index.js";
import { compileCircuit } from "../packages/circuit-compiler/src/index.js";
import {
  createBuiltinPrimitiveRegistry,
  Simulator,
} from "../packages/sim-core/src/index.js";

const notCircuit: CircuitDefinition = {
  schema: "gateos.circuit/v1",
  id: "user.not",
  name: "NOT",
  pins: [
    { id: "in", name: "IN", direction: "input", width: 1 },
    { id: "out", name: "OUT", direction: "output", width: 1 },
  ],
  instances: [{ id: "nand", componentId: "builtin.nand" }],
  connections: [
    {
      id: "c1",
      from: { kind: "interface", pinId: "in" },
      to: { kind: "instance", instanceId: "nand", pinId: "a" },
    },
    {
      id: "c2",
      from: { kind: "interface", pinId: "in" },
      to: { kind: "instance", instanceId: "nand", pinId: "b" },
    },
    {
      id: "c3",
      from: { kind: "instance", instanceId: "nand", pinId: "out" },
      to: { kind: "interface", pinId: "out" },
    },
  ],
};

function registryWithNot(): ComponentRegistry {
  const registry = createBuiltinComponentRegistry();
  registry.register({
    kind: "composite",
    id: "user.not",
    name: "NOT",
    circuit: notCircuit,
  });
  return registry;
}

describe("compiler + simulator", () => {
  it("runs a NAND-built NOT circuit", () => {
    const netlist = compileCircuit(notCircuit, createBuiltinComponentRegistry());
    const simulator = new Simulator(netlist, createBuiltinPrimitiveRegistry());

    simulator.setInput("in", BitVector.fromBinary("0"));
    simulator.settle();
    expect(simulator.readOutput("out").toBinary()).toBe("1");

    simulator.setInput("in", BitVector.fromBinary("1"));
    simulator.settle();
    expect(simulator.readOutput("out").toBinary()).toBe("0");
  });

  it("flattens a nested composite while retaining source paths", () => {
    const root: CircuitDefinition = {
      schema: "gateos.circuit/v1",
      id: "test.nested-not",
      name: "Nested NOT",
      pins: [
        { id: "in", name: "IN", direction: "input", width: 1 },
        { id: "out", name: "OUT", direction: "output", width: 1 },
      ],
      instances: [{ id: "not1", componentId: "user.not" }],
      connections: [
        {
          id: "a",
          from: { kind: "interface", pinId: "in" },
          to: { kind: "instance", instanceId: "not1", pinId: "in" },
        },
        {
          id: "b",
          from: { kind: "instance", instanceId: "not1", pinId: "out" },
          to: { kind: "interface", pinId: "out" },
        },
      ],
    };

    const netlist = compileCircuit(root, registryWithNot());
    expect(netlist.nodes).toHaveLength(1);
    expect(netlist.nodes[0]?.sourcePath).toBe("root/not1/nand");

    const simulator = new Simulator(netlist, createBuiltinPrimitiveRegistry());
    simulator.setInput("in", BitVector.fromBinary("1"));
    simulator.settle();
    expect(simulator.readOutput("out").toBinary()).toBe("0");
  });

  it("rejects width mismatches during compilation", () => {
    const bad: CircuitDefinition = {
      schema: "gateos.circuit/v1",
      id: "bad.width",
      name: "Bad width",
      pins: [{ id: "wide", name: "WIDE", direction: "input", width: 2 }],
      instances: [{ id: "nand", componentId: "builtin.nand" }],
      connections: [
        {
          id: "bad",
          from: { kind: "interface", pinId: "wide" },
          to: { kind: "instance", instanceId: "nand", pinId: "a" },
        },
      ],
    };

    expect(() =>
      compileCircuit(bad, createBuiltinComponentRegistry()),
    ).toThrow(/Cannot connect 2-bit/);
  });
});
