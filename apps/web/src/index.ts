import { BitVector } from "@gateos/circuit-model";

export function bootstrapMessage(): string {
  const signal = BitVector.fromBinary("1");
  return `GateOS Lab core ready (signal=${signal.toBinary()})`;
}
