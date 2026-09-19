import {
  BitVector,
  logicNand,
  type CompiledNode,
} from "@gateos/circuit-model";

export type PrimitiveInputs = Readonly<Record<string, BitVector>>;
export type PrimitiveOutputs = Readonly<Record<string, BitVector>>;

export type PrimitiveEvaluator = (
  inputs: PrimitiveInputs,
  params: Readonly<Record<string, unknown>>,
  node: CompiledNode,
) => PrimitiveOutputs;

export class PrimitiveRegistry {
  readonly #evaluators = new Map<string, PrimitiveEvaluator>();

  register(id: string, evaluator: PrimitiveEvaluator): void {
    if (this.#evaluators.has(id)) {
      throw new Error(`Primitive evaluator already registered: ${id}`);
    }
    this.#evaluators.set(id, evaluator);
  }

  get(id: string): PrimitiveEvaluator {
    const evaluator = this.#evaluators.get(id);
    if (!evaluator) throw new Error(`Unknown primitive evaluator: ${id}`);
    return evaluator;
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

  return registry;
}
