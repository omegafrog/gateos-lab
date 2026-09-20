import {
  BitVector,
  logicNand,
  type CompiledNode,
} from "@gateos/circuit-model";

export type PrimitiveInputs = Readonly<Record<string, BitVector>>;
export type PrimitiveOutputs = Readonly<Record<string, BitVector>>;
export type ClockEdge = "rising" | "falling";

export type PrimitiveEvaluator = (
  inputs: PrimitiveInputs,
  params: Readonly<Record<string, unknown>>,
  node: CompiledNode,
) => PrimitiveOutputs;

export interface SequentialPrimitiveDefinition<State = unknown> {
  /**
   * When set, this sequential primitive is driven by an explicit 1-bit clock
   * input. The simulator detects 0→1 / 1→0 transitions during settle().
   * Definitions without clockPin continue to use Simulator.stepEdge().
   */
  clockPin?: string;

  createState(
    params: Readonly<Record<string, unknown>>,
    node: CompiledNode,
  ): State;

  sample(
    inputs: PrimitiveInputs,
    state: State,
    edge: ClockEdge,
    params: Readonly<Record<string, unknown>>,
    node: CompiledNode,
  ): State;

  outputs(
    state: State,
    params: Readonly<Record<string, unknown>>,
    node: CompiledNode,
  ): PrimitiveOutputs;

  serializeState(
    state: State,
    params: Readonly<Record<string, unknown>>,
    node: CompiledNode,
  ): unknown;

  deserializeState(
    value: unknown,
    params: Readonly<Record<string, unknown>>,
    node: CompiledNode,
  ): State;
}

export class PrimitiveRegistry {
  readonly #evaluators = new Map<string, PrimitiveEvaluator>();
  readonly #sequential = new Map<
    string,
    SequentialPrimitiveDefinition<unknown>
  >();

  register(id: string, evaluator: PrimitiveEvaluator): void {
    if (this.#evaluators.has(id) || this.#sequential.has(id)) {
      throw new Error(`Primitive evaluator already registered: ${id}`);
    }
    this.#evaluators.set(id, evaluator);
  }

  registerSequential<State>(
    id: string,
    definition: SequentialPrimitiveDefinition<State>,
  ): void {
    if (this.#evaluators.has(id) || this.#sequential.has(id)) {
      throw new Error(`Primitive evaluator already registered: ${id}`);
    }
    this.#sequential.set(
      id,
      definition as SequentialPrimitiveDefinition<unknown>,
    );
  }

  get(id: string): PrimitiveEvaluator {
    const evaluator = this.#evaluators.get(id);
    if (!evaluator) throw new Error(`Unknown combinational primitive: ${id}`);
    return evaluator;
  }

  getSequential(id: string): SequentialPrimitiveDefinition<unknown> {
    const definition = this.#sequential.get(id);
    if (!definition) throw new Error(`Unknown sequential primitive: ${id}`);
    return definition;
  }

  isSequential(id: string): boolean {
    return this.#sequential.has(id);
  }
}

export function createBuiltinPrimitiveRegistry(): PrimitiveRegistry {
  const registry = new PrimitiveRegistry();

  registry.register("builtin.split2", (inputs) => {
    const input = inputs.in;
    if (!input) throw new Error("Split2 requires input 'in'");
    if (input.width !== 2) {
      throw new Error(`Split2 expects a 2-bit input, got ${input.width}`);
    }

    return {
      b0: BitVector.fromLSB([input.get(0)]),
      b1: BitVector.fromLSB([input.get(1)]),
    };
  });

  registry.register("builtin.join2", (inputs) => {
    const bits = ["b0", "b1"].map((id) => inputs[id]);
    if (bits.some((bit) => !bit)) {
      throw new Error("Join2 requires inputs b0, b1");
    }
    for (const bit of bits) {
      if (!bit || bit.width !== 1) {
        throw new Error("Join2 expects two 1-bit inputs");
      }
    }

    return {
      out: BitVector.fromLSB(bits.map((bit) => bit!.get(0))),
    };
  });

  registry.register("builtin.split6", (inputs) => {
    const input = inputs.in;
    if (!input) throw new Error("Split6 requires input 'in'");
    if (input.width !== 6) {
      throw new Error(`Split6 expects a 6-bit input, got ${input.width}`);
    }

    return {
      b0: BitVector.fromLSB([input.get(0)]),
      b1: BitVector.fromLSB([input.get(1)]),
      b2: BitVector.fromLSB([input.get(2)]),
      b3: BitVector.fromLSB([input.get(3)]),
      b4: BitVector.fromLSB([input.get(4)]),
      b5: BitVector.fromLSB([input.get(5)]),
    };
  });

  registry.register("builtin.split4", (inputs) => {
    const input = inputs.in;
    if (!input) throw new Error("Split4 requires input 'in'");
    if (input.width !== 4) {
      throw new Error(`Split4 expects a 4-bit input, got ${input.width}`);
    }

    return {
      b0: BitVector.fromLSB([input.get(0)]),
      b1: BitVector.fromLSB([input.get(1)]),
      b2: BitVector.fromLSB([input.get(2)]),
      b3: BitVector.fromLSB([input.get(3)]),
    };
  });

  registry.register("builtin.join4", (inputs) => {
    const bits = ["b0", "b1", "b2", "b3"].map((id) => inputs[id]);
    if (bits.some((bit) => !bit)) {
      throw new Error("Join4 requires inputs b0, b1, b2, b3");
    }
    for (const bit of bits) {
      if (!bit || bit.width !== 1) {
        throw new Error("Join4 expects four 1-bit inputs");
      }
    }

    return {
      out: BitVector.fromLSB(bits.map((bit) => bit!.get(0))),
    };
  });

  registry.register("builtin.const1.zero", () => ({
    out: BitVector.zeros(1),
  }));

  registry.register("builtin.const1.one", () => ({
    out: BitVector.ones(1),
  }));

  registry.register("builtin.const4.zero", () => ({
    out: BitVector.zeros(4),
  }));

  registry.register("builtin.const4.one", () => ({
    out: BitVector.fromBigInt(1n, 4),
  }));

  registry.register("builtin.nand", (inputs) => {
    const a = inputs.a;
    const b = inputs.b;
    if (!a || !b) throw new Error("NAND requires inputs 'a' and 'b'");
    if (a.width !== b.width) {
      throw new Error(`NAND width mismatch: ${a.width} !== ${b.width}`);
    }

    return {
      out: a.zip(b, logicNand),
    };
  });

  registry.registerSequential<BitVector>("builtin.clock", {
    createState: () => BitVector.zeros(1),
    sample: (_inputs, state, edge) =>
      edge === "rising" ? BitVector.ones(1) : BitVector.zeros(1),
    outputs: (state) => ({ out: state }),
    serializeState: (state) => state.toBinary(),
    deserializeState: (value) => {
      if (typeof value !== "string") {
        throw new Error("Clock state must be a binary string");
      }
      const state = BitVector.fromBinary(value);
      if (state.width !== 1) {
        throw new Error("Clock state must be 1 bit");
      }
      return state;
    },
  });

  registry.registerSequential<BitVector>("builtin.user-dff", {
    clockPin: "clk",
    createState: () => BitVector.unknown(1),
    sample: (inputs, state, edge) => {
      if (edge === "falling") return state;
      const d = inputs.d;
      if (!d) throw new Error("User D Flip-Flop requires input 'd'");
      if (d.width !== 1) {
        throw new Error(`User D Flip-Flop expects 1-bit D, got ${d.width}`);
      }
      return d;
    },
    outputs: (state) => ({ q: state }),
    serializeState: (state) => state.toBinary(),
    deserializeState: (value) => {
      if (typeof value !== "string") {
        throw new Error("User D Flip-Flop state must be a binary string");
      }
      const state = BitVector.fromBinary(value);
      if (state.width !== 1) {
        throw new Error("User D Flip-Flop state must be 1 bit");
      }
      return state;
    },
  });

  registry.registerSequential<BitVector>("builtin.dff", {
    createState: () => BitVector.unknown(1),
    sample: (inputs, state, edge) => {
      if (edge === "falling") return state;
      const d = inputs.d;
      if (!d) throw new Error("D Flip-Flop requires input 'd'");
      if (d.width !== 1) {
        throw new Error(`D Flip-Flop expects 1-bit D, got ${d.width}`);
      }
      return d;
    },
    outputs: (state) => ({ q: state }),
    serializeState: (state) => state.toBinary(),
    deserializeState: (value) => {
      if (typeof value !== "string") {
        throw new Error("D Flip-Flop state must be a binary string");
      }
      const state = BitVector.fromBinary(value);
      if (state.width !== 1) {
        throw new Error("D Flip-Flop state must be 1 bit");
      }
      return state;
    },
  });

  return registry;
}
