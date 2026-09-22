import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BitVector,
  createBuiltinComponentRegistry,
  type CircuitDefinition,
  type ComponentRegistry,
} from "@gateos/circuit-model";
import {
  createBuiltinPrimitiveRegistry,
  type PrimitiveRegistry,
} from "@gateos/sim-core";
import {
  runChallenge,
  type ChallengeDefinition,
} from "@gateos/challenge-engine";

function readManifest(): {
  title: string;
  challenges: readonly { id: string; file: string }[];
} {
  return JSON.parse(
    readFileSync(new URL("../curriculum/core/manifest.json", import.meta.url), "utf8"),
  ) as {
    title: string;
    challenges: readonly { id: string; file: string }[];
  };
}

function readChallenge(file: string): ChallengeDefinition {
  return JSON.parse(
    readFileSync(new URL(`../curriculum/core/${file}`, import.meta.url), "utf8"),
  ) as ChallengeDefinition;
}

function readLearning(): {
  stages: Readonly<Record<string, {
    why: string;
    outcomes: readonly string[];
    connectsTo: string;
  }>>;
  challenges: Readonly<Record<string, {
    motivation: string;
    mentalModel: string;
    howItWorks: readonly string[];
    applications: readonly string[];
    commonMistakes: readonly string[];
    buildsToward: string;
  }>>;
} {
  return JSON.parse(
    readFileSync(new URL("../curriculum/core/learning.json", import.meta.url), "utf8"),
  );
}

function extendedRegistry(): {
  components: ComponentRegistry;
  primitives: PrimitiveRegistry;
} {
  const components = createBuiltinComponentRegistry();
  const primitives = createBuiltinPrimitiveRegistry();

  components.register({
    kind: "primitive",
    id: "user.mux2",
    name: "2-to-1 Multiplexer",
    primitiveId: "test.mux2",
    pins: [
      { id: "a", name: "A", direction: "input", width: 1 },
      { id: "b", name: "B", direction: "input", width: 1 },
      { id: "sel", name: "SEL", direction: "input", width: 1 },
      { id: "out", name: "OUT", direction: "output", width: 1 },
    ],
  });
  primitives.register("test.mux2", (inputs) => {
    const sel = inputs.sel?.get(0);
    if (sel === 0) return { out: inputs.a ?? BitVector.unknown(1) };
    if (sel === 1) return { out: inputs.b ?? BitVector.unknown(1) };
    return { out: BitVector.unknown(1) };
  });

  components.register({
    kind: "primitive",
    id: "user.full-adder",
    name: "Full Adder",
    primitiveId: "test.full-adder",
    pins: [
      { id: "a", name: "A", direction: "input", width: 1 },
      { id: "b", name: "B", direction: "input", width: 1 },
      { id: "cin", name: "CIN", direction: "input", width: 1 },
      { id: "sum", name: "SUM", direction: "output", width: 1 },
      { id: "cout", name: "COUT", direction: "output", width: 1 },
    ],
  });
  primitives.register("test.full-adder", (inputs) => {
    const a = inputs.a?.get(0);
    const b = inputs.b?.get(0);
    const cin = inputs.cin?.get(0);
    if (
      (a !== 0 && a !== 1) ||
      (b !== 0 && b !== 1) ||
      (cin !== 0 && cin !== 1)
    ) {
      return {
        sum: BitVector.unknown(1),
        cout: BitVector.unknown(1),
      };
    }

    const total = a + b + cin;
    return {
      sum: BitVector.fromNumber(total & 1, 1),
      cout: BitVector.fromNumber(total >= 2 ? 1 : 0, 1),
    };
  });

  components.register({
    kind: "primitive",
    id: "user.adder4",
    name: "4-bit Ripple Carry Adder",
    primitiveId: "test.adder4",
    pins: [
      { id: "a", name: "A", direction: "input", width: 4 },
      { id: "b", name: "B", direction: "input", width: 4 },
      { id: "cin", name: "CIN", direction: "input", width: 1 },
      { id: "sum", name: "SUM", direction: "output", width: 4 },
      { id: "cout", name: "COUT", direction: "output", width: 1 },
    ],
  });
  primitives.register("test.adder4", (inputs) => {
    const a = inputs.a?.toNumber();
    const b = inputs.b?.toNumber();
    const cin = inputs.cin?.toNumber();
    if (a === null || a === undefined || b === null || b === undefined || cin === null || cin === undefined) {
      return {
        sum: BitVector.unknown(4),
        cout: BitVector.unknown(1),
      };
    }

    const total = a + b + cin;
    return {
      sum: BitVector.fromNumber(total & 0xf, 4),
      cout: BitVector.fromNumber(total > 0xf ? 1 : 0, 1),
    };
  });

  return { components, primitives };
}

function mux4Reference(): CircuitDefinition {
  const instances = [
    { id: "splitA", componentId: "builtin.split4" },
    { id: "splitB", componentId: "builtin.split4" },
    { id: "mux0", componentId: "user.mux2" },
    { id: "mux1", componentId: "user.mux2" },
    { id: "mux2", componentId: "user.mux2" },
    { id: "mux3", componentId: "user.mux2" },
    { id: "join", componentId: "builtin.join4" },
  ];
  const connections: CircuitDefinition["connections"] = [
    {
      id: "a-split",
      from: { kind: "interface", pinId: "a" },
      to: { kind: "instance", instanceId: "splitA", pinId: "in" },
    },
    {
      id: "b-split",
      from: { kind: "interface", pinId: "b" },
      to: { kind: "instance", instanceId: "splitB", pinId: "in" },
    },
  ];

  for (let bit = 0; bit < 4; bit += 1) {
    connections.push(
      {
        id: `a-${bit}`,
        from: { kind: "instance", instanceId: "splitA", pinId: `b${bit}` },
        to: { kind: "instance", instanceId: `mux${bit}`, pinId: "a" },
      },
      {
        id: `b-${bit}`,
        from: { kind: "instance", instanceId: "splitB", pinId: `b${bit}` },
        to: { kind: "instance", instanceId: `mux${bit}`, pinId: "b" },
      },
      {
        id: `sel-${bit}`,
        from: { kind: "interface", pinId: "sel" },
        to: { kind: "instance", instanceId: `mux${bit}`, pinId: "sel" },
      },
      {
        id: `out-${bit}`,
        from: { kind: "instance", instanceId: `mux${bit}`, pinId: "out" },
        to: { kind: "instance", instanceId: "join", pinId: `b${bit}` },
      },
    );
  }

  connections.push({
    id: "out",
    from: { kind: "instance", instanceId: "join", pinId: "out" },
    to: { kind: "interface", pinId: "out" },
  });

  return {
    schema: "gateos.circuit/v1",
    id: "reference.routing.mux4",
    name: "4-bit Multiplexer",
    pins: [
      { id: "a", name: "A", direction: "input", width: 4 },
      { id: "b", name: "B", direction: "input", width: 4 },
      { id: "sel", name: "SEL", direction: "input", width: 1 },
      { id: "out", name: "OUT", direction: "output", width: 4 },
    ],
    instances,
    connections,
  };
}

function adder4Reference(): CircuitDefinition {
  const instances = [
    { id: "splitA", componentId: "builtin.split4" },
    { id: "splitB", componentId: "builtin.split4" },
    { id: "fa0", componentId: "user.full-adder" },
    { id: "fa1", componentId: "user.full-adder" },
    { id: "fa2", componentId: "user.full-adder" },
    { id: "fa3", componentId: "user.full-adder" },
    { id: "join", componentId: "builtin.join4" },
  ];
  const connections: CircuitDefinition["connections"] = [
    {
      id: "a-split",
      from: { kind: "interface", pinId: "a" },
      to: { kind: "instance", instanceId: "splitA", pinId: "in" },
    },
    {
      id: "b-split",
      from: { kind: "interface", pinId: "b" },
      to: { kind: "instance", instanceId: "splitB", pinId: "in" },
    },
    {
      id: "cin",
      from: { kind: "interface", pinId: "cin" },
      to: { kind: "instance", instanceId: "fa0", pinId: "cin" },
    },
  ];

  for (let bit = 0; bit < 4; bit += 1) {
    connections.push(
      {
        id: `a-${bit}`,
        from: { kind: "instance", instanceId: "splitA", pinId: `b${bit}` },
        to: { kind: "instance", instanceId: `fa${bit}`, pinId: "a" },
      },
      {
        id: `b-${bit}`,
        from: { kind: "instance", instanceId: "splitB", pinId: `b${bit}` },
        to: { kind: "instance", instanceId: `fa${bit}`, pinId: "b" },
      },
      {
        id: `sum-${bit}`,
        from: { kind: "instance", instanceId: `fa${bit}`, pinId: "sum" },
        to: { kind: "instance", instanceId: "join", pinId: `b${bit}` },
      },
    );
    if (bit < 3) {
      connections.push({
        id: `carry-${bit}`,
        from: { kind: "instance", instanceId: `fa${bit}`, pinId: "cout" },
        to: { kind: "instance", instanceId: `fa${bit + 1}`, pinId: "cin" },
      });
    }
  }

  connections.push(
    {
      id: "sum",
      from: { kind: "instance", instanceId: "join", pinId: "out" },
      to: { kind: "interface", pinId: "sum" },
    },
    {
      id: "cout",
      from: { kind: "instance", instanceId: "fa3", pinId: "cout" },
      to: { kind: "interface", pinId: "cout" },
    },
  );

  return {
    schema: "gateos.circuit/v1",
    id: "reference.arithmetic.adder4",
    name: "4-bit Ripple Carry Adder",
    pins: [
      { id: "a", name: "A", direction: "input", width: 4 },
      { id: "b", name: "B", direction: "input", width: 4 },
      { id: "cin", name: "CIN", direction: "input", width: 1 },
      { id: "sum", name: "SUM", direction: "output", width: 4 },
      { id: "cout", name: "COUT", direction: "output", width: 1 },
    ],
    instances,
    connections,
  };
}

function incrementer4Reference(): CircuitDefinition {
  return {
    schema: "gateos.circuit/v1",
    id: "reference.arithmetic.incrementer4",
    name: "4-bit Incrementer",
    pins: [
      { id: "in", name: "IN", direction: "input", width: 4 },
      { id: "out", name: "OUT", direction: "output", width: 4 },
      { id: "carry", name: "CARRY", direction: "output", width: 1 },
    ],
    instances: [
      { id: "adder", componentId: "user.adder4" },
      { id: "one4", componentId: "builtin.const4.one" },
      { id: "zero1", componentId: "builtin.const1.zero" },
    ],
    connections: [
      {
        id: "in-a",
        from: { kind: "interface", pinId: "in" },
        to: { kind: "instance", instanceId: "adder", pinId: "a" },
      },
      {
        id: "one-b",
        from: { kind: "instance", instanceId: "one4", pinId: "out" },
        to: { kind: "instance", instanceId: "adder", pinId: "b" },
      },
      {
        id: "zero-cin",
        from: { kind: "instance", instanceId: "zero1", pinId: "out" },
        to: { kind: "instance", instanceId: "adder", pinId: "cin" },
      },
      {
        id: "sum-out",
        from: { kind: "instance", instanceId: "adder", pinId: "sum" },
        to: { kind: "interface", pinId: "out" },
      },
      {
        id: "carry-out",
        from: { kind: "instance", instanceId: "adder", pinId: "cout" },
        to: { kind: "interface", pinId: "carry" },
      },
    ],
  };
}

describe("extended curriculum", () => {
  it("validates the 4-bit MUX reference circuit", () => {
    const challenge = readChallenge("12-mux4.challenge.json");
    const { components, primitives } = extendedRegistry();
    expect(runChallenge(challenge, mux4Reference(), components, primitives).passed).toBe(true);
  });

  it("validates the 4-bit ripple-carry adder reference circuit", () => {
    const challenge = readChallenge("13-adder4.challenge.json");
    const { components, primitives } = extendedRegistry();
    expect(runChallenge(challenge, adder4Reference(), components, primitives).passed).toBe(true);
  });

  it("validates the 4-bit incrementer reference circuit", () => {
    const challenge = readChallenge("14-incrementer4.challenge.json");
    const { components, primitives } = extendedRegistry();
    expect(runChallenge(challenge, incrementer4Reference(), components, primitives).passed).toBe(true);
  });

  it("provides concept-first teaching for every stage and challenge", () => {
    const manifest = readManifest();
    const learning = readLearning();

    expect(Object.keys(learning.stages)).toEqual([
      "logic",
      "state",
      "multibit",
      "memory",
      "cpu",
    ]);

    for (const stage of Object.values(learning.stages)) {
      expect(stage.why.length).toBeGreaterThan(100);
      expect(stage.outcomes.length).toBeGreaterThanOrEqual(4);
      expect(stage.outcomes.every((outcome) => outcome.length > 20)).toBe(true);
      expect(stage.connectsTo.length).toBeGreaterThan(60);
    }

    for (const entry of manifest.challenges) {
      const lesson = learning.challenges[entry.id];
      expect(lesson, entry.id).toBeDefined();
      expect(lesson?.motivation.length, entry.id).toBeGreaterThan(80);
      expect(lesson?.mentalModel.length, entry.id).toBeGreaterThan(50);
      expect(lesson?.howItWorks.length, entry.id).toBeGreaterThanOrEqual(3);
      expect(
        lesson?.howItWorks.every((paragraph) => paragraph.length > 35),
        entry.id,
      ).toBe(true);
      expect(lesson?.applications.length, entry.id).toBeGreaterThanOrEqual(3);
      expect(lesson?.commonMistakes.length, entry.id).toBeGreaterThanOrEqual(3);
      expect(lesson?.buildsToward.length, entry.id).toBeGreaterThan(50);

      const challenge = readChallenge(entry.file);
      expect(challenge.description.length, entry.id).toBeGreaterThan(60);
      expect(challenge.hints, entry.id).toHaveLength(3);
      expect(challenge.hints?.map((hint) => hint.level), entry.id).toEqual([
        1, 2, 3,
      ]);
      expect(
        challenge.hints?.every(
          (hint) => hint.title.length > 8 && hint.body.length > 45,
        ),
        entry.id,
      ).toBe(true);
    }
  });

  it("keeps advanced challenges on the progressive three-hint format", () => {
    const files = [
      "12-mux4.challenge.json",
      "13-adder4.challenge.json",
      "14-incrementer4.challenge.json",
      "15-register4.challenge.json",
      "16-counter4.challenge.json",
      "17-program-counter4.challenge.json",
      "18-decoder2to4.challenge.json",
      "19-ram4.challenge.json",
      "20-ram16.challenge.json",
      "25-zero4.challenge.json",
      "26-alu4.challenge.json",
      "27-register-file4.challenge.json",
      "28-register-transfer4.challenge.json",
      "29-alu-datapath4.challenge.json",
    ];

    for (const file of files) {
      const challenge = readChallenge(file);
      expect(challenge.hints).toHaveLength(3);
      expect(challenge.hints?.map((hint) => hint.level)).toEqual([1, 2, 3]);
      expect(challenge.description.length).toBeGreaterThan(20);
      expect(challenge.validators.length).toBeGreaterThan(0);
    }

    for (const file of [
      "15-register4.challenge.json",
      "16-counter4.challenge.json",
      "17-program-counter4.challenge.json",
      "19-ram4.challenge.json",
      "20-ram16.challenge.json",
      "27-register-file4.challenge.json",
      "28-register-transfer4.challenge.json",
      "29-alu-datapath4.challenge.json",
    ]) {
      const challenge = readChallenge(file);
      expect(challenge.referenceTables?.length).toBeGreaterThan(0);
      expect(challenge.validators.some((validator) => validator.type === "sequence")).toBe(true);
    }
  });

  it("defines the memory track as decoder -> RAM4 -> RAM16", () => {
    const decoder = readChallenge("18-decoder2to4.challenge.json");
    const ram4 = readChallenge("19-ram4.challenge.json");
    const ram16 = readChallenge("20-ram16.challenge.json");

    expect(decoder.interface.inputs).toEqual([
      { id: "addr", name: "ADDR", width: 2 },
    ]);
    expect(decoder.unlocks).toContain("memory.ram4");

    expect(ram4.interface.inputs.find((pin) => pin.id === "addr")?.width).toBe(2);
    expect(ram4.interface.inputs.find((pin) => pin.id === "d")?.width).toBe(4);
    expect(ram4.allowedComponents).toContain("user.register4");
    expect(ram4.allowedComponents).toContain("user.decoder2to4");
    expect(ram4.unlocks).toContain("memory.ram16");

    expect(ram16.interface.inputs.find((pin) => pin.id === "addr")?.width).toBe(4);
    expect(ram16.interface.inputs.find((pin) => pin.id === "d")?.width).toBe(4);
    expect(ram16.allowedComponents).toContain("user.ram4");
    expect(ram16.allowedComponents).not.toContain("builtin.ram");
    expect(ram16.validators.some((validator) => validator.type === "sequence")).toBe(true);
  });

  it("teaches RAM16 as stateful memory with separate read, write, and address mapping", () => {
    const ram16 = readChallenge("20-ram16.challenge.json");
    const operation = ram16.referenceTables?.find(
      (table) => table.id === "memory-operation",
    );
    const address = ram16.referenceTables?.find(
      (table) => table.id === "address-hierarchy",
    );

    expect(operation?.kind).toBe("operation");
    expect(operation?.description).toContain("일반 조합논리 진리표로 표현할 수 없습니다");
    expect(operation?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          load: "0",
          clk: "↑",
          effect: "변화 없음",
          q: "RAM[aaaa]",
        }),
        expect.objectContaining({
          load: "1",
          clk: "↑",
          effect: "RAM[aaaa] ← dddd",
          q: "dddd (edge 후)",
        }),
      ]),
    );

    expect(address?.kind).toBe("address");
    expect(address?.rows).toEqual([
      expect.objectContaining({ range: "0000 ~ 0011", bankBits: "00", bank: "RAM4 #0" }),
      expect.objectContaining({ range: "0100 ~ 0111", bankBits: "01", bank: "RAM4 #1" }),
      expect.objectContaining({ range: "1000 ~ 1011", bankBits: "10", bank: "RAM4 #2" }),
      expect.objectContaining({ range: "1100 ~ 1111", bankBits: "11", bank: "RAM4 #3" }),
    ]);
  });

  it("moves from RAM16 into Zero Detector and an ALU built from provided bitwise gates", () => {
    const ram16 = readChallenge("20-ram16.challenge.json");
    const alu = readChallenge("26-alu4.challenge.json");
    const registerFile = readChallenge("27-register-file4.challenge.json");
    const transfer = readChallenge("28-register-transfer4.challenge.json");
    const datapath = readChallenge("29-alu-datapath4.challenge.json");

    expect(ram16.unlocks).toContain("logic.zero4");
    expect(alu.allowedComponents).toEqual(
      expect.arrayContaining([
        "builtin.and4",
        "builtin.or4",
        "builtin.xor4",
        "user.adder4",
        "user.zero4",
      ]),
    );
    expect(alu.allowedComponents).not.toContain("user.logic-unit4");
    expect(alu.allowedComponents).not.toContain("user.and4");
    expect(alu.allowedComponents).not.toContain("user.or4");
    expect(alu.allowedComponents).not.toContain("user.xor4");

    const opTable = alu.referenceTables?.find((table) => table.id === "opcodes");
    expect(opTable?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: "00", operation: "AND" }),
        expect.objectContaining({ op: "01", operation: "OR" }),
        expect.objectContaining({ op: "10", operation: "XOR" }),
        expect.objectContaining({ op: "11", operation: "ADD" }),
      ]),
    );
    expect(alu.interface.outputs.some((pin) => pin.id === "zero")).toBe(true);

    expect(registerFile.interface.inputs.filter((pin) =>
      pin.id === "raddr_a" || pin.id === "raddr_b"
    )).toHaveLength(2);
    expect(registerFile.interface.outputs.map((pin) => pin.id)).toEqual([
      "qa",
      "qb",
    ]);
    expect(registerFile.allowedComponents).toContain("user.register4");

    expect(transfer.allowedComponents).toContain("user.register-file4");
    expect(transfer.unlocks).toContain("cpu.alu-datapath4");

    expect(datapath.allowedComponents).toEqual(
      expect.arrayContaining([
        "user.register-file4",
        "user.alu4",
        "user.mux4",
        "user.or",
      ]),
    );
    expect(datapath.validators.some((validator) => validator.type === "sequence")).toBe(true);
  });

  it("loads the guided curriculum in order through 25 focused challenges", () => {
    const manifest = readManifest();
    expect(manifest.challenges).toHaveLength(25);
    expect(manifest.challenges[19]).toEqual({
      id: "memory.ram16",
      file: "20-ram16.challenge.json",
    });
    expect(manifest.challenges[20]).toEqual({
      id: "logic.zero4",
      file: "25-zero4.challenge.json",
    });
    expect(manifest.challenges[21]).toEqual({
      id: "arithmetic.alu4",
      file: "26-alu4.challenge.json",
    });
    expect(manifest.challenges[24]).toEqual({
      id: "cpu.alu-datapath4",
      file: "29-alu-datapath4.challenge.json",
    });
    expect(manifest.challenges.some((entry) => entry.id === "memory.ram64")).toBe(false);
    expect(manifest.challenges.some((entry) => entry.id === "logic.logic-unit4")).toBe(false);
    expect(manifest.challenges.some((entry) => entry.id === "logic.and4")).toBe(false);
    expect(manifest.challenges.some((entry) => entry.id === "logic.or4")).toBe(false);
    expect(manifest.challenges.some((entry) => entry.id === "logic.xor4")).toBe(false);
    expect(manifest.title).toContain("CPU Datapath");
  });
});
