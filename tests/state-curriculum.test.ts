import { describe, expect, it } from "vitest";
import {
  BitVector,
  createBuiltinComponentRegistry,
  type CircuitDefinition,
  type ComponentRegistry,
} from "@gateos/circuit-model";
import { compileCircuit } from "@gateos/circuit-compiler";
import {
  createBuiltinPrimitiveRegistry,
  Simulator,
} from "@gateos/sim-core";

function notCircuit(): CircuitDefinition {
  return {
    schema: "gateos.circuit/v1",
    id: "artifact.logic.not",
    name: "NOT",
    pins: [
      { id: "in", name: "IN", direction: "input", width: 1 },
      { id: "out", name: "OUT", direction: "output", width: 1 },
    ],
    instances: [{ id: "nand", componentId: "builtin.nand" }],
    connections: [
      {
        id: "a",
        from: { kind: "interface", pinId: "in" },
        to: { kind: "instance", instanceId: "nand", pinId: "a" },
      },
      {
        id: "b",
        from: { kind: "interface", pinId: "in" },
        to: { kind: "instance", instanceId: "nand", pinId: "b" },
      },
      {
        id: "out",
        from: { kind: "instance", instanceId: "nand", pinId: "out" },
        to: { kind: "interface", pinId: "out" },
      },
    ],
  };
}

function srLatchCircuit(): CircuitDefinition {
  return {
    schema: "gateos.circuit/v1",
    id: "artifact.state.sr-latch",
    name: "SR Latch",
    pins: [
      { id: "sbar", name: "S̅", direction: "input", width: 1 },
      { id: "rbar", name: "R̅", direction: "input", width: 1 },
      { id: "q", name: "Q", direction: "output", width: 1 },
      { id: "nq", name: "Q̅", direction: "output", width: 1 },
    ],
    instances: [
      { id: "qGate", componentId: "builtin.nand" },
      { id: "nqGate", componentId: "builtin.nand" },
    ],
    connections: [
      {
        id: "s",
        from: { kind: "interface", pinId: "sbar" },
        to: { kind: "instance", instanceId: "qGate", pinId: "a" },
      },
      {
        id: "r",
        from: { kind: "interface", pinId: "rbar" },
        to: { kind: "instance", instanceId: "nqGate", pinId: "a" },
      },
      {
        id: "feedback-q",
        from: { kind: "instance", instanceId: "qGate", pinId: "out" },
        to: { kind: "instance", instanceId: "nqGate", pinId: "b" },
      },
      {
        id: "feedback-nq",
        from: { kind: "instance", instanceId: "nqGate", pinId: "out" },
        to: { kind: "instance", instanceId: "qGate", pinId: "b" },
      },
      {
        id: "q",
        from: { kind: "instance", instanceId: "qGate", pinId: "out" },
        to: { kind: "interface", pinId: "q" },
      },
      {
        id: "nq",
        from: { kind: "instance", instanceId: "nqGate", pinId: "out" },
        to: { kind: "interface", pinId: "nq" },
      },
    ],
  };
}

function dLatchCircuit(): CircuitDefinition {
  return {
    schema: "gateos.circuit/v1",
    id: "artifact.state.d-latch",
    name: "D Latch",
    pins: [
      { id: "d", name: "D", direction: "input", width: 1 },
      { id: "enable", name: "ENABLE", direction: "input", width: 1 },
      { id: "q", name: "Q", direction: "output", width: 1 },
    ],
    instances: [
      { id: "notD", componentId: "user.not" },
      { id: "setGate", componentId: "builtin.nand" },
      { id: "resetGate", componentId: "builtin.nand" },
      { id: "latch", componentId: "user.sr-latch" },
    ],
    connections: [
      {
        id: "d-not",
        from: { kind: "interface", pinId: "d" },
        to: { kind: "instance", instanceId: "notD", pinId: "in" },
      },
      {
        id: "d-set",
        from: { kind: "interface", pinId: "d" },
        to: { kind: "instance", instanceId: "setGate", pinId: "a" },
      },
      {
        id: "en-set",
        from: { kind: "interface", pinId: "enable" },
        to: { kind: "instance", instanceId: "setGate", pinId: "b" },
      },
      {
        id: "notd-reset",
        from: { kind: "instance", instanceId: "notD", pinId: "out" },
        to: { kind: "instance", instanceId: "resetGate", pinId: "a" },
      },
      {
        id: "en-reset",
        from: { kind: "interface", pinId: "enable" },
        to: { kind: "instance", instanceId: "resetGate", pinId: "b" },
      },
      {
        id: "set-latch",
        from: { kind: "instance", instanceId: "setGate", pinId: "out" },
        to: { kind: "instance", instanceId: "latch", pinId: "sbar" },
      },
      {
        id: "reset-latch",
        from: { kind: "instance", instanceId: "resetGate", pinId: "out" },
        to: { kind: "instance", instanceId: "latch", pinId: "rbar" },
      },
      {
        id: "q",
        from: { kind: "instance", instanceId: "latch", pinId: "q" },
        to: { kind: "interface", pinId: "q" },
      },
    ],
  };
}

function registry(): ComponentRegistry {
  const registry = createBuiltinComponentRegistry();
  registry.register({
    kind: "composite",
    id: "user.not",
    name: "NOT",
    circuit: notCircuit(),
  });
  registry.register({
    kind: "composite",
    id: "user.sr-latch",
    name: "SR Latch",
    circuit: srLatchCircuit(),
  });
  registry.register({
    kind: "composite",
    id: "user.d-latch",
    name: "D Latch",
    circuit: dLatchCircuit(),
  });
  return registry;
}

function simulator(circuit: CircuitDefinition): Simulator {
  return new Simulator(
    compileCircuit(circuit, registry()),
    createBuiltinPrimitiveRegistry(),
  );
}

describe("state curriculum reference circuits", () => {
  it("SR Latch sets, resets, and holds state", () => {
    const sim = simulator(srLatchCircuit());

    sim.setInput("sbar", BitVector.fromBinary("0"));
    sim.setInput("rbar", BitVector.fromBinary("1"));
    sim.settle();
    expect(sim.readOutput("q").toBinary()).toBe("1");

    sim.setInput("sbar", BitVector.fromBinary("1"));
    sim.settle();
    expect(sim.readOutput("q").toBinary()).toBe("1");

    sim.setInput("rbar", BitVector.fromBinary("0"));
    sim.settle();
    expect(sim.readOutput("q").toBinary()).toBe("0");

    sim.setInput("rbar", BitVector.fromBinary("1"));
    sim.settle();
    expect(sim.readOutput("q").toBinary()).toBe("0");
  });

  it("D Latch follows D while enabled and holds while disabled", () => {
    const sim = simulator(dLatchCircuit());

    sim.setInput("d", BitVector.fromBinary("0"));
    sim.setInput("enable", BitVector.fromBinary("1"));
    sim.settle();
    expect(sim.readOutput("q").toBinary()).toBe("0");

    sim.setInput("enable", BitVector.fromBinary("0"));
    sim.setInput("d", BitVector.fromBinary("1"));
    sim.settle();
    expect(sim.readOutput("q").toBinary()).toBe("0");

    sim.setInput("enable", BitVector.fromBinary("1"));
    sim.settle();
    expect(sim.readOutput("q").toBinary()).toBe("1");

    sim.setInput("enable", BitVector.fromBinary("0"));
    sim.setInput("d", BitVector.fromBinary("0"));
    sim.settle();
    expect(sim.readOutput("q").toBinary()).toBe("1");
  });

  it("master/slave D Latches form a rising-edge DFF in the zero-delay model", () => {
    const dff: CircuitDefinition = {
      schema: "gateos.circuit/v1",
      id: "reference.state.dff",
      name: "D Flip-Flop",
      pins: [
        { id: "d", name: "D", direction: "input", width: 1 },
        { id: "clk", name: "CLK", direction: "input", width: 1 },
        { id: "q", name: "Q", direction: "output", width: 1 },
      ],
      instances: [
        { id: "notClk", componentId: "user.not" },
        { id: "master", componentId: "user.d-latch" },
        { id: "slave", componentId: "user.d-latch" },
      ],
      connections: [
        {
          id: "d",
          from: { kind: "interface", pinId: "d" },
          to: { kind: "instance", instanceId: "master", pinId: "d" },
        },
        {
          id: "clk-not",
          from: { kind: "interface", pinId: "clk" },
          to: { kind: "instance", instanceId: "notClk", pinId: "in" },
        },
        {
          id: "master-enable",
          from: { kind: "instance", instanceId: "notClk", pinId: "out" },
          to: { kind: "instance", instanceId: "master", pinId: "enable" },
        },
        {
          id: "master-slave",
          from: { kind: "instance", instanceId: "master", pinId: "q" },
          to: { kind: "instance", instanceId: "slave", pinId: "d" },
        },
        {
          id: "slave-enable",
          from: { kind: "interface", pinId: "clk" },
          to: { kind: "instance", instanceId: "slave", pinId: "enable" },
        },
        {
          id: "q",
          from: { kind: "instance", instanceId: "slave", pinId: "q" },
          to: { kind: "interface", pinId: "q" },
        },
      ],
    };

    const sim = simulator(dff);

    sim.setInput("d", BitVector.fromBinary("0"));
    sim.setInput("clk", BitVector.fromBinary("0"));
    sim.settle();

    sim.setInput("clk", BitVector.fromBinary("1"));
    sim.settle();
    expect(sim.readOutput("q").toBinary()).toBe("0");

    sim.setInput("d", BitVector.fromBinary("1"));
    sim.settle();
    expect(sim.readOutput("q").toBinary()).toBe("0");

    sim.setInput("clk", BitVector.fromBinary("0"));
    sim.settle();
    expect(sim.readOutput("q").toBinary()).toBe("0");

    sim.setInput("clk", BitVector.fromBinary("1"));
    sim.settle();
    expect(sim.readOutput("q").toBinary()).toBe("1");
  });
});
