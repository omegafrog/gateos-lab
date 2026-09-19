import type { LogicValue } from "./logic-value.js";

const VALID_VALUES = new Set<LogicValue>([0, 1, "X", "Z"]);

export class BitVector {
  readonly #bits: readonly LogicValue[];

  private constructor(bitsLSBFirst: readonly LogicValue[]) {
    if (bitsLSBFirst.length === 0) {
      throw new Error("BitVector width must be at least 1");
    }

    for (const bit of bitsLSBFirst) {
      if (!VALID_VALUES.has(bit)) {
        throw new Error(`Invalid logic value: ${String(bit)}`);
      }
    }

    this.#bits = Object.freeze([...bitsLSBFirst]);
  }

  static fromLSB(bits: readonly LogicValue[]): BitVector {
    return new BitVector(bits);
  }

  static fromBinary(binaryMSBFirst: string): BitVector {
    if (binaryMSBFirst.length === 0) {
      throw new Error("Binary string cannot be empty");
    }

    const bits = [...binaryMSBFirst].map<LogicValue>((char) => {
      if (char === "0") return 0;
      if (char === "1") return 1;
      if (char === "X" || char === "x") return "X";
      if (char === "Z" || char === "z") return "Z";
      throw new Error(`Invalid binary character: ${char}`);
    });

    return new BitVector(bits.reverse());
  }

  static fromBigInt(value: bigint, width: number): BitVector {
    if (width < 1 || !Number.isInteger(width)) {
      throw new Error(`Invalid width: ${width}`);
    }
    if (value < 0n) {
      throw new Error("BitVector.fromBigInt only accepts unsigned values");
    }
    const max = 1n << BigInt(width);
    if (value >= max) {
      throw new Error(`Value ${value} does not fit in ${width} bits`);
    }

    const bits: LogicValue[] = [];
    for (let index = 0; index < width; index += 1) {
      bits.push(((value >> BigInt(index)) & 1n) === 1n ? 1 : 0);
    }
    return new BitVector(bits);
  }

  static fromNumber(value: number, width: number): BitVector {
    if (!Number.isSafeInteger(value)) {
      throw new Error("BitVector.fromNumber requires a safe integer");
    }
    return BitVector.fromBigInt(BigInt(value), width);
  }

  static unknown(width: number): BitVector {
    return BitVector.filled(width, "X");
  }

  static highZ(width: number): BitVector {
    return BitVector.filled(width, "Z");
  }

  static zeros(width: number): BitVector {
    return BitVector.filled(width, 0);
  }

  static ones(width: number): BitVector {
    return BitVector.filled(width, 1);
  }

  static filled(width: number, value: LogicValue): BitVector {
    if (width < 1 || !Number.isInteger(width)) {
      throw new Error(`Invalid width: ${width}`);
    }
    return new BitVector(Array.from({ length: width }, () => value));
  }

  get width(): number {
    return this.#bits.length;
  }

  get(index: number): LogicValue {
    const value = this.#bits[index];
    if (value === undefined) {
      throw new Error(`Bit index out of range: ${index}`);
    }
    return value;
  }

  map(fn: (value: LogicValue, index: number) => LogicValue): BitVector {
    return BitVector.fromLSB(this.#bits.map(fn));
  }

  zip(
    other: BitVector,
    fn: (left: LogicValue, right: LogicValue, index: number) => LogicValue,
  ): BitVector {
    this.assertSameWidth(other);
    return BitVector.fromLSB(
      this.#bits.map((left, index) => fn(left, other.get(index), index)),
    );
  }

  equals(other: BitVector): boolean {
    if (this.width !== other.width) return false;
    for (let index = 0; index < this.width; index += 1) {
      if (this.get(index) !== other.get(index)) return false;
    }
    return true;
  }

  toBinary(): string {
    return [...this.#bits]
      .reverse()
      .map((value) => String(value))
      .join("");
  }

  toBigInt(): bigint | null {
    let value = 0n;
    for (let index = 0; index < this.width; index += 1) {
      const bit = this.get(index);
      if (bit !== 0 && bit !== 1) return null;
      if (bit === 1) value |= 1n << BigInt(index);
    }
    return value;
  }

  toNumber(): number | null {
    const value = this.toBigInt();
    if (value === null || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }

  toJSON(): string {
    return this.toBinary();
  }

  private assertSameWidth(other: BitVector): void {
    if (this.width !== other.width) {
      throw new Error(
        `BitVector width mismatch: ${this.width} !== ${other.width}`,
      );
    }
  }
}
