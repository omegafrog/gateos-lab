import { describe, expect, it } from "vitest";
import {
  createBuiltinComponentRegistry,
  type CircuitDefinition,
} from "@gateos/circuit-model";
import {
  createBuiltinPrimitiveRegistry,
} from "@gateos/sim-core";
import {
  runChallenge,
  type ChallengeDefinition,
} from "@gateos/challenge-engine";

const challenge: ChallengeDefinition = {
  schema: "gateos.challenge/v1",
  id: "logic.not",
  title: "NOT",
  description: "Invert the input using NAND.",
  interface: {
    inputs: [{ id: "in", name: "IN", width: 1 }],
    outputs: [{ id: "out", name: "OUT", width: 1 }],
  },
  allowedComponents: ["builtin.nand"],
  validators: [
    {
      type: "truthTable",
      visibility: "visible",
      cases: [{ in: { in: 0 }, out: { out: 1 } }],
    },
    {
      type: "truthTable",
      visibility: "hidden",
      cases: [{ in: { in: 1 }, out: { out: 0 } }],
    },
  ],
};

const correctNot: CircuitDefinition = {
  schema: "gateos.circuit/v1",
  id: "submission.not",
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

describe("challenge engine", () => {
  it("accepts a correct NAND-built NOT", () => {
    const result = runChallenge(
      challenge,
      correctNot,
      createBuiltinComponentRegistry(),
      createBuiltinPrimitiveRegistry(),
    );

    expect(result.passed).toBe(true);
  });

  it("does not reveal hidden failure details", () => {
    const wrong: CircuitDefinition = {
      ...correctNot,
      instances: [],
      connections: [
        {
          id: "wire",
          from: { kind: "interface", pinId: "in" },
          to: { kind: "interface", pinId: "out" },
        },
      ],
    };

    const result = runChallenge(
      challenge,
      wrong,
      createBuiltinComponentRegistry(),
      createBuiltinPrimitiveRegistry(),
    );

    expect(result.passed).toBe(false);
    const hidden = result.tests.find((test) => test.visibility === "hidden");
    expect(hidden?.message).toBe("A hidden truth-table case failed");
  });
});
