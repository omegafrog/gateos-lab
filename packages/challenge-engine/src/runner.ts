import {
  BitVector,
  type CircuitDefinition,
  type ComponentRegistry,
  type PinDefinition,
} from "@gateos/circuit-model";
import { compileCircuit } from "@gateos/circuit-compiler";
import {
  Simulator,
  type PrimitiveRegistry,
} from "@gateos/sim-core";
import type {
  ChallengeDefinition,
  ChallengePin,
  ChallengeRunResult,
  ChallengeTestResult,
  SignalLiteral,
  StructuralValidator,
  TruthTableValidator,
} from "./types.js";

function literalToVector(value: SignalLiteral, width: number): BitVector {
  if (typeof value === "number") {
    return BitVector.fromNumber(value, width);
  }

  const vector = BitVector.fromBinary(value);
  if (vector.width !== width) {
    throw new Error(
      `Literal ${value} has width ${vector.width}; expected ${width}`,
    );
  }
  return vector;
}

function pinMap(pins: readonly PinDefinition[]): Map<string, PinDefinition> {
  return new Map(pins.map((pin) => [pin.id, pin]));
}

function checkInterface(
  challenge: ChallengeDefinition,
  circuit: CircuitDefinition,
): ChallengeTestResult[] {
  const actual = pinMap(circuit.pins);
  const expected = [
    ...challenge.interface.inputs.map((pin) => ({
      ...pin,
      direction: "input" as const,
    })),
    ...challenge.interface.outputs.map((pin) => ({
      ...pin,
      direction: "output" as const,
    })),
  ];

  const results: ChallengeTestResult[] = [];

  for (const pin of expected) {
    const found = actual.get(pin.id);
    const passed =
      found !== undefined &&
      found.direction === pin.direction &&
      found.width === pin.width;

    results.push({
      validatorIndex: -1,
      type: "interface",
      visibility: "visible",
      passed,
      message: passed
        ? `Interface pin ${pin.name} is valid`
        : `Expected ${pin.direction} pin ${pin.id} with width ${pin.width}`,
    });
  }

  const expectedIds = new Set(expected.map((pin) => pin.id));
  for (const pin of circuit.pins) {
    if (!expectedIds.has(pin.id)) {
      results.push({
        validatorIndex: -1,
        type: "interface",
        visibility: "visible",
        passed: false,
        message: `Unexpected interface pin: ${pin.id}`,
      });
    }
  }

  return results;
}

function runStructuralValidator(
  validator: StructuralValidator,
  circuit: CircuitDefinition,
  validatorIndex: number,
  fallbackAllowed: readonly string[] | undefined,
): ChallengeTestResult[] {
  const visibility = validator.visibility ?? "visible";
  const allowed = validator.rules.allowed ?? fallbackAllowed;
  const results: ChallengeTestResult[] = [];

  if (allowed) {
    const allowedSet = new Set(allowed);
    const invalid = circuit.instances
      .map((instance) => instance.componentId)
      .filter((componentId) => !allowedSet.has(componentId));

    results.push({
      validatorIndex,
      type: "structural",
      visibility,
      passed: invalid.length === 0,
      message:
        invalid.length === 0
          ? "All components are allowed"
          : `Disallowed components: ${[...new Set(invalid)].join(", ")}`,
    });
  }

  if (validator.rules.maxComponents !== undefined) {
    const passed = circuit.instances.length <= validator.rules.maxComponents;
    results.push({
      validatorIndex,
      type: "structural",
      visibility,
      passed,
      message: passed
        ? `Component count ${circuit.instances.length} is within the limit`
        : `Component count ${circuit.instances.length} exceeds ${validator.rules.maxComponents}`,
    });
  }

  return results;
}

function inputWidth(challenge: ChallengeDefinition, id: string): number {
  const pin = challenge.interface.inputs.find((candidate) => candidate.id === id);
  if (!pin) throw new Error(`Unknown challenge input: ${id}`);
  return pin.width;
}

function outputWidth(challenge: ChallengeDefinition, id: string): number {
  const pin = challenge.interface.outputs.find((candidate) => candidate.id === id);
  if (!pin) throw new Error(`Unknown challenge output: ${id}`);
  return pin.width;
}

function runTruthTableValidator(
  validator: TruthTableValidator,
  challenge: ChallengeDefinition,
  circuit: CircuitDefinition,
  registry: ComponentRegistry,
  primitives: PrimitiveRegistry,
  validatorIndex: number,
): ChallengeTestResult[] {
  const netlist = compileCircuit(circuit, registry);
  const visibility = validator.visibility ?? "visible";

  return validator.cases.map((testCase, caseIndex) => {
    try {
      const simulator = new Simulator(netlist, primitives);

      for (const [pinId, literal] of Object.entries(testCase.in)) {
        simulator.setInput(
          pinId,
          literalToVector(literal, inputWidth(challenge, pinId)),
        );
      }

      simulator.settle();

      const mismatches: string[] = [];
      for (const [pinId, literal] of Object.entries(testCase.out)) {
        const expected = literalToVector(
          literal,
          outputWidth(challenge, pinId),
        );
        const actual = simulator.readOutput(pinId);

        if (!actual.equals(expected)) {
          mismatches.push(
            `${pinId}: expected ${expected.toBinary()}, got ${actual.toBinary()}`,
          );
        }
      }

      const passed = mismatches.length === 0;
      return {
        validatorIndex,
        caseIndex,
        type: "truthTable",
        visibility,
        passed,
        message:
          visibility === "hidden" && !passed
            ? "A hidden truth-table case failed"
            : passed
              ? "Truth-table case passed"
              : mismatches.join("; "),
      };
    } catch (error) {
      return {
        validatorIndex,
        caseIndex,
        type: "truthTable",
        visibility,
        passed: false,
        message:
          visibility === "hidden"
            ? "A hidden truth-table case failed"
            : error instanceof Error
              ? error.message
              : String(error),
      };
    }
  });
}

export function runChallenge(
  challenge: ChallengeDefinition,
  circuit: CircuitDefinition,
  registry: ComponentRegistry,
  primitives: PrimitiveRegistry,
): ChallengeRunResult {
  const tests: ChallengeTestResult[] = checkInterface(challenge, circuit);

  if (challenge.allowedComponents) {
    const implicitStructural: StructuralValidator = {
      type: "structural",
      rules: { allowed: challenge.allowedComponents },
    };
    tests.push(
      ...runStructuralValidator(
        implicitStructural,
        circuit,
        -1,
        challenge.allowedComponents,
      ),
    );
  }

  try {
    compileCircuit(circuit, registry);
  } catch (error) {
    tests.push({
      validatorIndex: -1,
      type: "compile",
      visibility: "visible",
      passed: false,
      message: error instanceof Error ? error.message : String(error),
    });

    return { passed: false, tests };
  }

  challenge.validators.forEach((validator, validatorIndex) => {
    if (validator.type === "structural") {
      tests.push(
        ...runStructuralValidator(
          validator,
          circuit,
          validatorIndex,
          challenge.allowedComponents,
        ),
      );
      return;
    }

    tests.push(
      ...runTruthTableValidator(
        validator,
        challenge,
        circuit,
        registry,
        primitives,
        validatorIndex,
      ),
    );
  });

  return {
    passed: tests.every((test) => test.passed),
    tests,
  };
}

export function findChallengePin(
  pins: readonly ChallengePin[],
  id: string,
): ChallengePin {
  const pin = pins.find((candidate) => candidate.id === id);
  if (!pin) throw new Error(`Unknown challenge pin: ${id}`);
  return pin;
}
