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
