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

export const CLOCK_COMPONENT: PrimitiveComponentSpec = {
  kind: "primitive",
  id: "builtin.clock",
  name: "Clock",
  primitiveId: "builtin.clock",
  pins: [
    { id: "out", name: "CLK", direction: "output", width: 1 },
  ],
};

export const SPLIT2_COMPONENT: PrimitiveComponentSpec = {
  kind: "primitive",
  id: "builtin.split2",
  name: "Split2",
  primitiveId: "builtin.split2",
  pins: [
    { id: "in", name: "IN", direction: "input", width: 2 },
    { id: "b0", name: "B0", direction: "output", width: 1 },
    { id: "b1", name: "B1", direction: "output", width: 1 },
  ],
};

export const JOIN2_COMPONENT: PrimitiveComponentSpec = {
  kind: "primitive",
  id: "builtin.join2",
  name: "Join2",
  primitiveId: "builtin.join2",
  pins: [
    { id: "b0", name: "B0", direction: "input", width: 1 },
    { id: "b1", name: "B1", direction: "input", width: 1 },
    { id: "out", name: "OUT", direction: "output", width: 2 },
  ],
};

export const SPLIT4_COMPONENT: PrimitiveComponentSpec = {
  kind: "primitive",
  id: "builtin.split4",
  name: "Split4",
  primitiveId: "builtin.split4",
  pins: [
    { id: "in", name: "IN", direction: "input", width: 4 },
    { id: "b0", name: "B0", direction: "output", width: 1 },
    { id: "b1", name: "B1", direction: "output", width: 1 },
    { id: "b2", name: "B2", direction: "output", width: 1 },
    { id: "b3", name: "B3", direction: "output", width: 1 },
  ],
};

export const JOIN4_COMPONENT: PrimitiveComponentSpec = {
  kind: "primitive",
  id: "builtin.join4",
  name: "Join4",
  primitiveId: "builtin.join4",
  pins: [
    { id: "b0", name: "B0", direction: "input", width: 1 },
    { id: "b1", name: "B1", direction: "input", width: 1 },
    { id: "b2", name: "B2", direction: "input", width: 1 },
    { id: "b3", name: "B3", direction: "input", width: 1 },
    { id: "out", name: "OUT", direction: "output", width: 4 },
  ],
};

export const CONST1_ZERO_COMPONENT: PrimitiveComponentSpec = {
  kind: "primitive",
  id: "builtin.const1.zero",
  name: "Const 0",
  primitiveId: "builtin.const1.zero",
  pins: [{ id: "out", name: "OUT", direction: "output", width: 1 }],
};

export const CONST1_ONE_COMPONENT: PrimitiveComponentSpec = {
  kind: "primitive",
  id: "builtin.const1.one",
  name: "Const 1",
  primitiveId: "builtin.const1.one",
  pins: [{ id: "out", name: "OUT", direction: "output", width: 1 }],
};

export const CONST4_ZERO_COMPONENT: PrimitiveComponentSpec = {
  kind: "primitive",
  id: "builtin.const4.zero",
  name: "Const4 0000",
  primitiveId: "builtin.const4.zero",
  pins: [{ id: "out", name: "OUT", direction: "output", width: 4 }],
};

export const CONST4_ONE_COMPONENT: PrimitiveComponentSpec = {
  kind: "primitive",
  id: "builtin.const4.one",
  name: "Const4 0001",
  primitiveId: "builtin.const4.one",
  pins: [{ id: "out", name: "OUT", direction: "output", width: 4 }],
};

export const DFF_COMPONENT: PrimitiveComponentSpec = {
  kind: "primitive",
  id: "builtin.dff",
  name: "D Flip-Flop",
  primitiveId: "builtin.dff",
  pins: [
    { id: "d", name: "D", direction: "input", width: 1 },
    { id: "q", name: "Q", direction: "output", width: 1 },
  ],
};

export function createBuiltinComponentRegistry(): ComponentRegistry {
  return new ComponentRegistry([
    NAND_COMPONENT,
    CLOCK_COMPONENT,
    DFF_COMPONENT,
    SPLIT2_COMPONENT,
    JOIN2_COMPONENT,
    SPLIT4_COMPONENT,
    JOIN4_COMPONENT,
    CONST1_ZERO_COMPONENT,
    CONST1_ONE_COMPONENT,
    CONST4_ZERO_COMPONENT,
    CONST4_ONE_COMPONENT,
  ]);
}
