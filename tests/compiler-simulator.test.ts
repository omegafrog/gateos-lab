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

  it("treats visual wire branches as the same electrical source net", () => {
    const circuit: CircuitDefinition = {
      schema: "gateos.circuit/v1",
      id: "test.visual-branch",
      name: "Visual Branch",
      pins: [
        { id: "in", name: "IN", direction: "input", width: 1 },
        { id: "out", name: "OUT", direction: "output", width: 1 },
      ],
      instances: [{ id: "nand", componentId: "builtin.nand" }],
      connections: [
        {
          id: "trunk",
          from: { kind: "interface", pinId: "in" },
          to: { kind: "instance", instanceId: "nand", pinId: "a" },
          route: [{ x: 240, y: 120 }],
        },
        {
          id: "branch",
          from: { kind: "interface", pinId: "in" },
          to: { kind: "instance", instanceId: "nand", pinId: "b" },
          branchStart: { x: 240, y: 120 },
        },
        {
          id: "out",
          from: { kind: "instance", instanceId: "nand", pinId: "out" },
          to: { kind: "interface", pinId: "out" },
        },
      ],
    };

    const simulator = new Simulator(
      compileCircuit(circuit, createBuiltinComponentRegistry()),
      createBuiltinPrimitiveRegistry(),
    );

    simulator.setInput("in", BitVector.fromBinary("0"));
    simulator.settle();
    expect(simulator.readOutput("out").toBinary()).toBe("1");

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


describe("bus primitives", () => {
  it("splits and rejoins a 2-bit address bus without changing bit order", () => {
    const circuit: CircuitDefinition = {
      schema: "gateos.circuit/v1",
      id: "test.address-bus-roundtrip",
      name: "Address Bus Roundtrip",
      pins: [
        { id: "in", name: "IN", direction: "input", width: 2 },
        { id: "out", name: "OUT", direction: "output", width: 2 },
      ],
      instances: [
        { id: "split", componentId: "builtin.split2" },
        { id: "join", componentId: "builtin.join2" },
      ],
      connections: [
        {
          id: "in-split",
          from: { kind: "interface", pinId: "in" },
          to: { kind: "instance", instanceId: "split", pinId: "in" },
        },
        {
          id: "b0",
          from: { kind: "instance", instanceId: "split", pinId: "b0" },
          to: { kind: "instance", instanceId: "join", pinId: "b0" },
        },
        {
          id: "b1",
          from: { kind: "instance", instanceId: "split", pinId: "b1" },
          to: { kind: "instance", instanceId: "join", pinId: "b1" },
        },
        {
          id: "out",
          from: { kind: "instance", instanceId: "join", pinId: "out" },
          to: { kind: "interface", pinId: "out" },
        },
      ],
    };

    const simulator = new Simulator(
      compileCircuit(circuit, createBuiltinComponentRegistry()),
      createBuiltinPrimitiveRegistry(),
    );

    for (const value of ["00", "01", "10", "11"]) {
      simulator.setInput("in", BitVector.fromBinary(value));
      simulator.settle();
      expect(simulator.readOutput("out").toBinary()).toBe(value);
    }
  });

  it("splits a 6-bit address bus with B0 as LSB", () => {
    const circuit: CircuitDefinition = {
      schema: "gateos.circuit/v1",
      id: "test.split6",
      name: "Split6",
      pins: [
        { id: "in", name: "IN", direction: "input", width: 6 },
        { id: "b0", name: "B0", direction: "output", width: 1 },
        { id: "b1", name: "B1", direction: "output", width: 1 },
        { id: "b2", name: "B2", direction: "output", width: 1 },
        { id: "b3", name: "B3", direction: "output", width: 1 },
        { id: "b4", name: "B4", direction: "output", width: 1 },
        { id: "b5", name: "B5", direction: "output", width: 1 },
      ],
      instances: [{ id: "split", componentId: "builtin.split6" }],
      connections: [
        {
          id: "in",
          from: { kind: "interface", pinId: "in" },
          to: { kind: "instance", instanceId: "split", pinId: "in" },
        },
        ...["b0", "b1", "b2", "b3", "b4", "b5"].map((pinId) => ({
          id: pinId,
          from: {
            kind: "instance" as const,
            instanceId: "split",
            pinId,
          },
          to: { kind: "interface" as const, pinId },
        })),
      ],
    };

    const simulator = new Simulator(
      compileCircuit(circuit, createBuiltinComponentRegistry()),
      createBuiltinPrimitiveRegistry(),
    );

    simulator.setInput("in", BitVector.fromBinary("101101"));
    simulator.settle();

    expect(simulator.readOutput("b0").toBinary()).toBe("1");
    expect(simulator.readOutput("b1").toBinary()).toBe("0");
    expect(simulator.readOutput("b2").toBinary()).toBe("1");
    expect(simulator.readOutput("b3").toBinary()).toBe("1");
    expect(simulator.readOutput("b4").toBinary()).toBe("0");
    expect(simulator.readOutput("b5").toBinary()).toBe("1");
  });

  it("splits and rejoins a 4-bit bus without changing bit order", () => {
    const circuit: CircuitDefinition = {
      schema: "gateos.circuit/v1",
      id: "test.bus-roundtrip",
      name: "Bus Roundtrip",
      pins: [
        { id: "in", name: "IN", direction: "input", width: 4 },
        { id: "out", name: "OUT", direction: "output", width: 4 },
      ],
      instances: [
        { id: "split", componentId: "builtin.split4" },
        { id: "join", componentId: "builtin.join4" },
      ],
      connections: [
        {
          id: "in-split",
          from: { kind: "interface", pinId: "in" },
          to: { kind: "instance", instanceId: "split", pinId: "in" },
        },
        ...["b0", "b1", "b2", "b3"].map((pinId) => ({
          id: `bit-${pinId}`,
          from: { kind: "instance" as const, instanceId: "split", pinId },
          to: { kind: "instance" as const, instanceId: "join", pinId },
        })),
        {
          id: "join-out",
          from: { kind: "instance", instanceId: "join", pinId: "out" },
          to: { kind: "interface", pinId: "out" },
        },
      ],
    };

    const simulator = new Simulator(
      compileCircuit(circuit, createBuiltinComponentRegistry()),
      createBuiltinPrimitiveRegistry(),
    );
    simulator.setInput("in", BitVector.fromBinary("1010"));
    simulator.settle();
    expect(simulator.readOutput("out").toBinary()).toBe("1010");
  });

  it("provides 4-bit AND OR and XOR as word-level primitives", () => {
    const circuit: CircuitDefinition = {
      schema: "gateos.circuit/v1",
      id: "test.bitwise4-builtins",
      name: "Bitwise4 Builtins",
      pins: [
        { id: "a", name: "A", direction: "input", width: 4 },
        { id: "b", name: "B", direction: "input", width: 4 },
        { id: "and", name: "AND", direction: "output", width: 4 },
        { id: "or", name: "OR", direction: "output", width: 4 },
        { id: "xor", name: "XOR", direction: "output", width: 4 },
      ],
      instances: [
        { id: "and4", componentId: "builtin.and4" },
        { id: "or4", componentId: "builtin.or4" },
        { id: "xor4", componentId: "builtin.xor4" },
      ],
      connections: [
        ...["and4", "or4", "xor4"].flatMap((instanceId) => [
          {
            id: `a-${instanceId}`,
            from: { kind: "interface" as const, pinId: "a" },
            to: { kind: "instance" as const, instanceId, pinId: "a" },
          },
          {
            id: `b-${instanceId}`,
            from: { kind: "interface" as const, pinId: "b" },
            to: { kind: "instance" as const, instanceId, pinId: "b" },
          },
        ]),
        {
          id: "and-out",
          from: { kind: "instance", instanceId: "and4", pinId: "out" },
          to: { kind: "interface", pinId: "and" },
        },
        {
          id: "or-out",
          from: { kind: "instance", instanceId: "or4", pinId: "out" },
          to: { kind: "interface", pinId: "or" },
        },
        {
          id: "xor-out",
          from: { kind: "instance", instanceId: "xor4", pinId: "out" },
          to: { kind: "interface", pinId: "xor" },
        },
      ],
    };

    const simulator = new Simulator(
      compileCircuit(circuit, createBuiltinComponentRegistry()),
      createBuiltinPrimitiveRegistry(),
    );
    simulator.setInput("a", BitVector.fromBinary("1010"));
    simulator.setInput("b", BitVector.fromBinary("1100"));
    simulator.settle();

    expect(simulator.readOutput("and").toBinary()).toBe("1000");
    expect(simulator.readOutput("or").toBinary()).toBe("1110");
    expect(simulator.readOutput("xor").toBinary()).toBe("0110");
  });

  it("exposes fixed 1-bit and 4-bit constants", () => {
    const circuit: CircuitDefinition = {
      schema: "gateos.circuit/v1",
      id: "test.constants",
      name: "Constants",
      pins: [
        { id: "z1", name: "Z1", direction: "output", width: 1 },
        { id: "o1", name: "O1", direction: "output", width: 1 },
        { id: "z4", name: "Z4", direction: "output", width: 4 },
        { id: "o4", name: "O4", direction: "output", width: 4 },
      ],
      instances: [
        { id: "z1", componentId: "builtin.const1.zero" },
        { id: "o1", componentId: "builtin.const1.one" },
        { id: "z4", componentId: "builtin.const4.zero" },
        { id: "o4", componentId: "builtin.const4.one" },
      ],
      connections: [
        ...[
          ["z1", "z1"],
          ["o1", "o1"],
          ["z4", "z4"],
          ["o4", "o4"],
        ].map(([instanceId, pinId]) => ({
          id: `wire-${instanceId}`,
          from: {
            kind: "instance" as const,
            instanceId: instanceId!,
            pinId: "out",
          },
          to: { kind: "interface" as const, pinId: pinId! },
        })),
      ],
    };

    const simulator = new Simulator(
      compileCircuit(circuit, createBuiltinComponentRegistry()),
      createBuiltinPrimitiveRegistry(),
    );
    simulator.settle();

    expect(simulator.readOutput("z1").toBinary()).toBe("0");
    expect(simulator.readOutput("o1").toBinary()).toBe("1");
    expect(simulator.readOutput("z4").toBinary()).toBe("0000");
    expect(simulator.readOutput("o4").toBinary()).toBe("0001");

    simulator.reset();

    expect(simulator.readOutput("z1").toBinary()).toBe("0");
    expect(simulator.readOutput("o1").toBinary()).toBe("1");
    expect(simulator.readOutput("z4").toBinary()).toBe("0000");
    expect(simulator.readOutput("o4").toBinary()).toBe("0001");
  });
});
