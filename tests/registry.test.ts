import { describe, expect, it } from "vitest";
import {
  ComponentRegistry,
  NAND_COMPONENT,
} from "@gateos/circuit-model";

describe("ComponentRegistry", () => {
  it("rejects duplicate component ids", () => {
    const registry = new ComponentRegistry([NAND_COMPONENT]);
    expect(() => registry.register(NAND_COMPONENT)).toThrow(/already registered/);
  });
});
