import { ComponentRegistry } from "./registry.js";
import type { PrimitiveComponentSpec } from "./types.js";

export const NAND_COMPONENT: PrimitiveComponentSpec = {
  kind: "primitive",
  id: "builtin.nand",
  name: "NAND",
  primitiveId: "builtin.nand",
  pins: [
    { id: "a", name: "A", direction: "input", width: 1 },
    { id: "b", name: "B", direction: "input", width: 1 },
    { id: "out", name: "OUT", direction: "output", width: 1 },
  ],
};

export function createBuiltinComponentRegistry(): ComponentRegistry {
  return new ComponentRegistry([NAND_COMPONENT]);
}
