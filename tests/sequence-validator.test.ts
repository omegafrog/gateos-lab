import { describe, expect, it } from "vitest";
import {
  createBuiltinComponentRegistry,
  type CircuitDefinition,
} from "@gateos/circuit-model";
import { createBuiltinPrimitiveRegistry } from "@gateos/sim-core";
import {
  runChallenge,
  type ChallengeDefinition,
} from "@gateos/challenge-engine";

describe("sequence validator", () => {
  it("validates state across multiple clock cycles", () => {
    const challenge: ChallengeDefinition = {
      schema: "gateos.challenge/v1",
      id: "state.dff",
      title: "D Flip-Flop",
      description: "Capture D on a clock edge.",
      interface: {
        inputs: [{ id: "d", name: "D", width: 1 }],
        outputs: [{ id: "q", name: "Q", width: 1 }],
      },
      allowedComponents: ["builtin.dff"],
      validators: [
        {
          type: "sequence",
          steps: [
            { set: { d: 1 } },
            { expect: { q: "X" } },
            { clock: 1 },
            { expect: { q: 1 } },
            { set: { d: 0 } },
            { expect: { q: 1 } },
            { clock: 1 },
            { expect: { q: 0 } },
          ],
        },
      ],
    };

    const circuit: CircuitDefinition = {
      schema: "gateos.circuit/v1",
      id: "submission.dff",
      name: "DFF",
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

    const result = runChallenge(
      challenge,
      circuit,
      createBuiltinComponentRegistry(),
      createBuiltinPrimitiveRegistry(),
    );

    expect(result.passed).toBe(true);
    expect(result.tests.some((test) => test.type === "sequence")).toBe(true);
  });
});
