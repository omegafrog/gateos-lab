export type LogicValue = 0 | 1 | "X" | "Z";

export function logicNot(value: LogicValue): LogicValue {
  if (value === 0) return 1;
  if (value === 1) return 0;
  return "X";
}

export function logicAnd(a: LogicValue, b: LogicValue): LogicValue {
  const left = a === "Z" ? "X" : a;
  const right = b === "Z" ? "X" : b;

  if (left === 0 || right === 0) return 0;
  if (left === 1 && right === 1) return 1;
  return "X";
}

export function logicOr(a: LogicValue, b: LogicValue): LogicValue {
  const left = a === "Z" ? "X" : a;
  const right = b === "Z" ? "X" : b;

  if (left === 1 || right === 1) return 1;
  if (left === 0 && right === 0) return 0;
  return "X";
}

export function logicXor(a: LogicValue, b: LogicValue): LogicValue {
  const left = a === "Z" ? "X" : a;
  const right = b === "Z" ? "X" : b;

  if ((left !== 0 && left !== 1) || (right !== 0 && right !== 1)) {
    return "X";
  }
  return left === right ? 0 : 1;
}

export function logicNand(a: LogicValue, b: LogicValue): LogicValue {
  return logicNot(logicAnd(a, b));
}

export function resolveLogicDrivers(values: readonly LogicValue[]): LogicValue {
  if (values.length === 0) return "X";

  let driven: 0 | 1 | undefined;

  for (const value of values) {
    if (value === "X") return "X";
    if (value === "Z") continue;

    if (driven === undefined) {
      driven = value;
      continue;
    }

    if (driven !== value) return "X";
  }

  return driven ?? "Z";
}
