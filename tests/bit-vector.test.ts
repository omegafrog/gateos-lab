import { describe, expect, it } from "vitest";
import {
  BitVector,
  logicNand,
  resolveLogicDrivers,
} from "../packages/circuit-model/src/index.js";

describe("BitVector", () => {
  it("round-trips binary text with X/Z values", () => {
    expect(BitVector.fromBinary("10XZ").toBinary()).toBe("10XZ");
  });

  it("converts concrete values to bigint", () => {
    expect(BitVector.fromBinary("1010").toBigInt()).toBe(10n);
    expect(BitVector.fromBinary("10X0").toBigInt()).toBeNull();
  });

  it("supports bitwise NAND semantics", () => {
    const a = BitVector.fromBinary("11");
    const b = BitVector.fromBinary("10");
    expect(a.zip(b, logicNand).toBinary()).toBe("01");
  });

  it("resolves multiple drivers", () => {
    expect(resolveLogicDrivers([1, 1])).toBe(1);
    expect(resolveLogicDrivers([0, 1])).toBe("X");
    expect(resolveLogicDrivers(["Z", 1])).toBe(1);
    expect(resolveLogicDrivers(["Z", "Z"])).toBe("Z");
  });
});
