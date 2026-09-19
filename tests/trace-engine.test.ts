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
import { TraceRecorder } from "@gateos/trace-engine";

const circuit: CircuitDefinition = {
  schema: "gateos.circuit/v1",
  id: "test.trace-dff",
  name: "Trace DFF",
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

function runtime() {
  const netlist = compileCircuit(circuit, createBuiltinComponentRegistry());
  const simulator = new Simulator(
    netlist,
    createBuiltinPrimitiveRegistry(),
  );
  return { netlist, simulator };
}

describe("TraceRecorder", () => {
  it("records delta frames and rewinds simulator state", () => {
    const { netlist, simulator } = runtime();
    const trace = new TraceRecorder(simulator);
    const qNet = netlist.rootOutputs.q;
    if (!qNet) throw new Error("missing Q net");

    trace.watch(qNet);

    simulator.setInput("d", BitVector.fromBinary("1"));
    simulator.stepClock();
    const first = trace.capture("clock 1");

    expect(first.cycleBefore).toBe(0);
    expect(first.cycleAfter).toBe(1);
    expect(first.inputChanges).toEqual([
      { pinId: "d", before: "X", after: "1" },
    ]);
    expect(first.stateChanges).toHaveLength(1);
    expect(first.signalSamples[qNet]).toBe("1");

    simulator.setInput("d", BitVector.fromBinary("0"));
    simulator.stepClock();
    const second = trace.capture("clock 2");

    expect(second.inputChanges).toEqual([
      { pinId: "d", before: "1", after: "0" },
    ]);
    expect(second.signalSamples[qNet]).toBe("0");
    expect(simulator.cycle).toBe(2);

    const rewound = trace.rewind();
    expect(rewound?.label).toBe("clock 2");
    expect(simulator.cycle).toBe(1);
    expect(simulator.readOutput("q").toBinary()).toBe("1");
    expect(simulator.snapshot().inputs.d).toBe("1");
    expect(trace.frames).toHaveLength(1);
  });

  it("retains only the configured number of delta frames", () => {
    const { simulator } = runtime();
    const trace = new TraceRecorder(simulator, { maxFrames: 2 });

    simulator.setInput("d", BitVector.fromBinary("0"));
    simulator.stepClock();
    trace.capture();

    simulator.setInput("d", BitVector.fromBinary("1"));
    simulator.stepClock();
    trace.capture();

    simulator.setInput("d", BitVector.fromBinary("0"));
    simulator.stepClock();
    trace.capture();

    expect(trace.frames).toHaveLength(2);
    expect(trace.frames[0]?.cycleBefore).toBe(1);
    expect(trace.frames[1]?.cycleAfter).toBe(3);
  });
});
