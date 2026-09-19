export type SignalLiteral = number | string;

export interface ChallengePin {
  id: string;
  name: string;
  width: number;
}

export interface TruthTableCase {
  in: Readonly<Record<string, SignalLiteral>>;
  out: Readonly<Record<string, SignalLiteral>>;
}

export interface TruthTableValidator {
  type: "truthTable";
  visibility?: "visible" | "hidden";
  cases: readonly TruthTableCase[];
}

export interface StructuralValidator {
  type: "structural";
  visibility?: "visible" | "hidden";
  rules: {
    allowed?: readonly string[];
    maxComponents?: number;
  };
}

export type SequenceStep =
  | {
      set: Readonly<Record<string, SignalLiteral>>;
    }
  | {
      edge: "rising" | "falling";
    }
  | {
      clock: number;
    }
  | {
      expect: Readonly<Record<string, SignalLiteral>>;
    };

export interface SequenceValidator {
  type: "sequence";
  visibility?: "visible" | "hidden";
  steps: readonly SequenceStep[];
}

export type ChallengeValidator =
  | TruthTableValidator
  | StructuralValidator
  | SequenceValidator;

export interface ChallengeReferenceTableColumn {
  id: string;
  label: string;
  group?: "input" | "state" | "output" | "note";
}

export interface ChallengeReferenceTable {
  id: string;
  title: string;
  description?: string;
  timing?: string;
  columns: readonly ChallengeReferenceTableColumn[];
  rows: readonly Readonly<Record<string, string>>[];
  notes?: readonly string[];
}

export interface ChallengeHint {
  level: 1 | 2 | 3;
  title: string;
  body: string;
}

export interface ChallengeDefinition {
  schema: "gateos.challenge/v1";
  id: string;
  title: string;
  description: string;
  interface: {
    inputs: readonly ChallengePin[];
    outputs: readonly ChallengePin[];
  };
  allowedComponents?: readonly string[];
  initialInputs?: Readonly<Record<string, SignalLiteral>>;
  hints?: readonly [ChallengeHint, ChallengeHint, ChallengeHint];
  referenceTables?: readonly ChallengeReferenceTable[];
  validators: readonly ChallengeValidator[];
  unlocks?: readonly string[];
}

export interface ChallengeTestResult {
  validatorIndex: number;
  caseIndex?: number;
  type: ChallengeValidator["type"] | "interface" | "compile";
  visibility: "visible" | "hidden";
  passed: boolean;
  message: string;
}

export interface ChallengeRunResult {
  passed: boolean;
  tests: readonly ChallengeTestResult[];
}
