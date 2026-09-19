import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  BitVector,
  componentPins,
  createBuiltinComponentRegistry,
  type CircuitConnection,
  type CircuitDefinition,
  type CircuitEndpoint,
  type ComponentRegistry,
  type ComponentSpec,
} from "@gateos/circuit-model";
import { compileCircuit } from "@gateos/circuit-compiler";
import {
  createBuiltinPrimitiveRegistry,
  Simulator,
} from "@gateos/sim-core";
import {
  runChallenge,
  type ChallengeDefinition,
  type ChallengeRunResult,
  type SequenceStep,
} from "@gateos/challenge-engine";
import { TraceRecorder } from "@gateos/trace-engine";

const STORAGE_KEY = "gateos-lab:v0.1";
const PROJECT_SCHEMA = "gateos.project/v1";
const CANVAS_WIDTH = 920;
const CANVAS_HEIGHT = 560;

interface CurriculumManifest {
  schema: "gateos.curriculum/v1";
  id: string;
  title: string;
  challenges: readonly { id: string; file: string }[];
}

interface ProbeDefinition {
  id: string;
  name: string;
  vertex: string;
  width: number;
}

interface ProjectState {
  schema: typeof PROJECT_SCHEMA;
  circuits: Record<string, CircuitDefinition>;
  published: Record<string, CircuitDefinition>;
  completed: string[];
  probes: Record<string, ProbeDefinition[]>;
}

interface ProjectLoadResult {
  project: ProjectState;
  error?: string;
}

interface Point {
  x: number;
  y: number;
}

interface DragState {
  instanceId: string;
  offsetX: number;
  offsetY: number;
}

interface PanState {
  clientX: number;
  clientY: number;
  originX: number;
  originY: number;
}

interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ClipboardCircuit {
  instances: CircuitDefinition["instances"];
  connections: CircuitDefinition["connections"];
}

interface PreviewState {
  error?: string;
  outputs: Record<string, string>;
  signals: Record<string, string>;
}

type VisualTestStatus = "idle" | "running" | "pass" | "fail";

interface VisualTestCase {
  id: string;
  visibility: "visible" | "hidden";
  inputs: Readonly<Record<string, number | string>>;
  expected: Readonly<Record<string, number | string>>;
}

interface VisualTestState {
  status: VisualTestStatus;
  actual?: Record<string, string>;
  error?: string;
}

interface VisualSequenceStep {
  id: string;
  visibility: "visible" | "hidden";
  validatorIndex: number;
  stepIndex: number;
  step: SequenceStep;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function literalToVector(value: number | string, width: number): BitVector {
  return typeof value === "number"
    ? BitVector.fromNumber(value, width)
    : BitVector.fromBinary(value);
}

function zeroBits(width: number): string {
  return "0".repeat(width);
}

function concreteInputNumber(binary: string): string {
  if (!/^[01]+$/.test(binary)) return "";
  return BigInt(`0b${binary}`).toString(10);
}

function formatSignals(values: Readonly<Record<string, number | string>>): string {
  return Object.entries(values)
    .map(([name, value]) => `${name.toUpperCase()}=${value}`)
    .join("  ");
}

function formatActual(values: Readonly<Record<string, string>> | undefined): string {
  if (!values) return "—";
  return Object.entries(values)
    .map(([name, value]) => `${name.toUpperCase()}=${value}`)
    .join("  ");
}

function emptyProject(): ProjectState {
  return {
    schema: PROJECT_SCHEMA,
    circuits: {},
    published: {},
    completed: [],
    probes: {},
  };
}

function normalizeProject(value: unknown, strictSchema = false): ProjectState {
  if (!value || typeof value !== "object") {
    throw new Error("Project file must contain a JSON object.");
  }

  const raw = value as Partial<ProjectState> & { schema?: string };

  if (strictSchema && raw.schema !== PROJECT_SCHEMA) {
    throw new Error(
      `Unsupported project schema: ${raw.schema ?? "(missing)"}. Expected ${PROJECT_SCHEMA}.`,
    );
  }

  if (
    raw.schema !== undefined &&
    raw.schema !== PROJECT_SCHEMA
  ) {
    throw new Error(
      `Unsupported project schema: ${raw.schema}. Expected ${PROJECT_SCHEMA}.`,
    );
  }

  return {
    schema: PROJECT_SCHEMA,
    circuits:
      raw.circuits && typeof raw.circuits === "object" ? raw.circuits : {},
    published:
      raw.published && typeof raw.published === "object" ? raw.published : {},
    completed: Array.isArray(raw.completed) ? raw.completed : [],
    probes: raw.probes && typeof raw.probes === "object" ? raw.probes : {},
  };
}

function loadProject(): ProjectLoadResult {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { project: emptyProject() };

  try {
    return {
      project: normalizeProject(JSON.parse(raw)),
    };
  } catch (error) {
    return {
      project: emptyProject(),
      error:
        error instanceof Error
          ? `Saved project could not be loaded: ${error.message}`
          : "Saved project could not be loaded.",
    };
  }
}

function createSubmission(challenge: ChallengeDefinition): CircuitDefinition {
  return {
    schema: "gateos.circuit/v1",
    id: `submission.${challenge.id}`,
    name: challenge.title,
    pins: [
      ...challenge.interface.inputs.map((pin) => ({
        id: pin.id,
        name: pin.name,
        direction: "input" as const,
        width: pin.width,
      })),
      ...challenge.interface.outputs.map((pin) => ({
        id: pin.id,
        name: pin.name,
        direction: "output" as const,
        width: pin.width,
      })),
    ],
    instances: [],
    connections: [],
  };
}

function publishedId(challengeId: string): string {
  const [, ...rest] = challengeId.split(".");
  return `user.${rest.join("-")}`;
}

function buildRegistry(project: ProjectState): ComponentRegistry {
  const registry = createBuiltinComponentRegistry();
  for (const [id, circuit] of Object.entries(project.published)) {
    registry.register({
      kind: "composite",
      id,
      name: circuit.name,
      circuit,
    });
  }
  return registry;
}

function endpointKey(endpoint: CircuitEndpoint): string {
  return endpoint.kind === "interface"
    ? `interface:${endpoint.pinId}`
    : `instance:${endpoint.instanceId}:${endpoint.pinId}`;
}

function instancePosition(
  circuit: CircuitDefinition,
  instanceId: string,
): Point {
  const instance = circuit.instances.find((candidate) => candidate.id === instanceId);
  return instance?.position ?? { x: 360, y: 220 };
}

function componentPinPoint(
  circuit: CircuitDefinition,
  registry: ComponentRegistry,
  instanceId: string,
  pinId: string,
): Point {
  const instance = circuit.instances.find((candidate) => candidate.id === instanceId);
  if (!instance) return { x: 0, y: 0 };

  const spec = registry.get(instance.componentId);
  const pins = componentPins(spec);
  const pin = pins.find((candidate) => candidate.id === pinId);
  if (!pin) return { x: 0, y: 0 };

  const position = instance.position ?? { x: 360, y: 220 };
  const inputPins = pins.filter(
    (candidate) => candidate.direction === "input" || candidate.direction === "inout",
  );
  const outputPins = pins.filter(
    (candidate) => candidate.direction === "output" || candidate.direction === "inout",
  );

  if (pin.direction === "output") {
    const index = outputPins.findIndex((candidate) => candidate.id === pin.id);
    return {
      x: position.x + 140,
      y: position.y + 36 + Math.max(index, 0) * 28,
    };
  }

  const index = inputPins.findIndex((candidate) => candidate.id === pin.id);
  return {
    x: position.x,
    y: position.y + 36 + Math.max(index, 0) * 28,
  };
}

function interfacePinPoint(
  circuit: CircuitDefinition,
  pinId: string,
): Point {
  const inputPins = circuit.pins.filter(
    (pin) => pin.direction === "input" || pin.direction === "inout",
  );
  const outputPins = circuit.pins.filter(
    (pin) => pin.direction === "output" || pin.direction === "inout",
  );

  const inputIndex = inputPins.findIndex((pin) => pin.id === pinId);
  if (inputIndex >= 0) {
    return { x: 48, y: 100 + inputIndex * 74 };
  }

  const outputIndex = outputPins.findIndex((pin) => pin.id === pinId);
  return { x: CANVAS_WIDTH - 48, y: 100 + Math.max(outputIndex, 0) * 74 };
}

function getEndpointPoint(
  endpoint: CircuitEndpoint,
  circuit: CircuitDefinition,
  registry: ComponentRegistry,
): Point {
  if (endpoint.kind === "interface") {
    return interfacePinPoint(circuit, endpoint.pinId);
  }
  return componentPinPoint(
    circuit,
    registry,
    endpoint.instanceId,
    endpoint.pinId,
  );
}

function signalVertex(endpoint: CircuitEndpoint, path = "root"): string {
  return endpoint.kind === "interface"
    ? `${path}::self::${endpoint.pinId}`
    : `${path}::inst:${endpoint.instanceId}::${endpoint.pinId}`;
}

function endpointWidth(
  endpoint: CircuitEndpoint,
  challenge: ChallengeDefinition,
  circuit: CircuitDefinition,
  registry: ComponentRegistry,
): number {
  if (endpoint.kind === "interface") {
    const pin = circuit.pins.find((candidate) => candidate.id === endpoint.pinId);
    return pin?.width ?? 1;
  }

  const instance = circuit.instances.find(
    (candidate) => candidate.id === endpoint.instanceId,
  );
  if (!instance) return 1;

  try {
    const spec = registry.get(instance.componentId);
    return componentPins(spec).find((pin) => pin.id === endpoint.pinId)?.width ?? 1;
  } catch {
    return 1;
  }
}

function signalHex(binary: string): string {
  if (!/^[01]+$/.test(binary)) return "—";
  return `0x${BigInt(`0b${binary}`).toString(16).toUpperCase()}`;
}

function componentDisplayName(spec: ComponentSpec): string {
  return spec.name || spec.id;
}

export function App() {
  const initialProject = useMemo(() => loadProject(), []);
  const [manifest, setManifest] = useState<CurriculumManifest | null>(null);
  const [challenges, setChallenges] = useState<ChallengeDefinition[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [project, setProject] = useState<ProjectState>(initialProject.project);
  const [projectError, setProjectError] = useState(initialProject.error ?? "");
  const [pendingPin, setPendingPin] = useState<CircuitEndpoint | null>(null);
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [selectedInstances, setSelectedInstances] = useState<string[]>([]);
  const [selectedConnection, setSelectedConnection] = useState<string | null>(null);
  const [inspectionPath, setInspectionPath] = useState<string[]>([]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pan, setPan] = useState<PanState | null>(null);
  const [viewport, setViewport] = useState<Viewport>({
    x: 0,
    y: 0,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
  });
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [simulationRevision, setSimulationRevision] = useState(0);
  const [traceRevision, setTraceRevision] = useState(0);
  const [testResult, setTestResult] = useState<ChallengeRunResult | null>(null);
  const [testStates, setTestStates] = useState<Record<string, VisualTestState>>({});
  const [activeTestId, setActiveTestId] = useState<string | null>(null);
  const [testRunning, setTestRunning] = useState(false);
  const [loadError, setLoadError] = useState<string>("");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const clipboardRef = useRef<ClipboardCircuit | null>(null);
  const undoRef = useRef<Record<string, CircuitDefinition[]>>({});
  const redoRef = useRef<Record<string, CircuitDefinition[]>>({});

  useEffect(() => {
    async function loadCurriculum() {
      try {
        const manifestResponse = await fetch("/core/manifest.json");
        if (!manifestResponse.ok) {
          throw new Error(`Failed to load curriculum manifest: ${manifestResponse.status}`);
        }
        const loadedManifest =
          (await manifestResponse.json()) as CurriculumManifest;

        const loadedChallenges = await Promise.all(
          loadedManifest.challenges.map(async (entry) => {
            const response = await fetch(`/core/${entry.file}`);
            if (!response.ok) {
              throw new Error(`Failed to load challenge ${entry.id}`);
            }
            return (await response.json()) as ChallengeDefinition;
          }),
        );

        setManifest(loadedManifest);
        setChallenges(loadedChallenges);
        setSelectedId((current) => current || loadedChallenges[0]?.id || "");
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
      }
    }

    void loadCurriculum();
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  }, [project]);

  const challenge = challenges.find((candidate) => candidate.id === selectedId);

  useEffect(() => {
    if (!challenge) return;
    const values: Record<string, string> = {};
    for (const pin of challenge.interface.inputs) {
      values[pin.id] = zeroBits(pin.width);
    }
    setInputValues(values);
    setPendingPin(null);
    setSelectedInstance(null);
    setSelectedInstances([]);
    setSelectedConnection(null);
    setInspectionPath([]);
    setTestResult(null);
    setTestStates({});
    setActiveTestId(null);
    setTestRunning(false);
  }, [challenge?.id]);

  const circuit = useMemo(() => {
    if (!challenge) return null;
    return project.circuits[challenge.id] ?? createSubmission(challenge);
  }, [challenge, project.circuits]);

  const registry = useMemo(() => buildRegistry(project), [project.published]);

  const simulationRuntime = useMemo(() => {
    if (!challenge || !circuit) {
      return {
        simulator: null as Simulator | null,
        netlist: null as ReturnType<typeof compileCircuit> | null,
        error: undefined as string | undefined,
      };
    }

    try {
      const netlist = compileCircuit(circuit, registry);
      const simulator = new Simulator(
        netlist,
        createBuiltinPrimitiveRegistry(),
      );

      for (const pin of challenge.interface.inputs) {
        simulator.setInput(
          pin.id,
          BitVector.fromBinary(inputValues[pin.id] ?? zeroBits(pin.width)),
        );
      }
      simulator.settle();

      return { simulator, netlist, error: undefined };
    } catch (error) {
      return {
        simulator: null,
        netlist: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [challenge?.id, circuit, registry]);

  useEffect(() => {
    if (!challenge || !simulationRuntime.simulator) return;

    try {
      for (const pin of challenge.interface.inputs) {
        simulationRuntime.simulator.setInput(
          pin.id,
          BitVector.fromBinary(inputValues[pin.id] ?? zeroBits(pin.width)),
        );
      }
      simulationRuntime.simulator.settle();
      setSimulationRevision((current) => current + 1);
    } catch {
      // Preview exposes simulation errors below; keep the session alive.
    }
  }, [challenge, inputValues, simulationRuntime]);

  const traceRuntime = useMemo(
    () =>
      simulationRuntime.simulator
        ? new TraceRecorder(simulationRuntime.simulator, { maxFrames: 256 })
        : null,
    [simulationRuntime.simulator],
  );

  useEffect(() => {
    if (!traceRuntime || !challenge || !simulationRuntime.netlist) return;

    traceRuntime.clearWatches();
    for (const probe of project.probes[challenge.id] ?? []) {
      const net = simulationRuntime.netlist.nets.find((candidate) =>
        candidate.sourceVertices.includes(probe.vertex),
      );
      if (net) traceRuntime.watch(net.id);
    }
    setTraceRevision((current) => current + 1);
  }, [
    traceRuntime,
    challenge,
    project.probes,
    simulationRuntime.netlist,
  ]);

  const inspection = useMemo(() => {
    if (!circuit) {
      return {
        circuit: null as CircuitDefinition | null,
        prefix: "root",
        breadcrumbs: [] as { id: string; name: string }[],
      };
    }

    let current = circuit;
    let prefix = "root";
    const breadcrumbs: { id: string; name: string }[] = [];

    for (const instanceId of inspectionPath) {
      const instance = current.instances.find(
        (candidate) => candidate.id === instanceId,
      );
      if (!instance) break;

      let spec: ComponentSpec;
      try {
        spec = registry.get(instance.componentId);
      } catch {
        break;
      }

      if (spec.kind !== "composite") break;

      breadcrumbs.push({
        id: instanceId,
        name: componentDisplayName(spec),
      });
      prefix = `${prefix}/${instanceId}`;
      current = spec.circuit;
    }

    return {
      circuit: current,
      prefix,
      breadcrumbs,
    };
  }, [circuit, inspectionPath, registry]);

  const displayCircuit = inspection.circuit;
  const displayInputPins = displayCircuit?.pins.filter(
    (pin) => pin.direction === "input" || pin.direction === "inout",
  ) ?? [];
  const displayOutputPins = displayCircuit?.pins.filter(
    (pin) => pin.direction === "output" || pin.direction === "inout",
  ) ?? [];
  const isInspectingNested = inspectionPath.length > 0;

  const visualTestCases = useMemo<VisualTestCase[]>(() => {
    if (!challenge) return [];

    const cases: VisualTestCase[] = [];
    challenge.validators.forEach((validator, validatorIndex) => {
      if (validator.type !== "truthTable") return;

      validator.cases.forEach((testCase, caseIndex) => {
        cases.push({
          id: `truth-${validatorIndex}-${caseIndex}`,
          visibility: validator.visibility ?? "visible",
          inputs: testCase.in,
          expected: testCase.out,
        });
      });
    });

    return cases;
  }, [challenge]);

  const targetTruthRows = useMemo(() => {
    if (!challenge) return [];

    const rows = new Map<
      string,
      {
        id: string;
        inputs: Readonly<Record<string, number | string>>;
        expected: Readonly<Record<string, number | string>>;
      }
    >();

    for (const testCase of visualTestCases) {
      const key = challenge.interface.inputs
        .map((pin) => {
          const literal = testCase.inputs[pin.id];
          if (literal === undefined) return "?";
          return literalToVector(literal, pin.width).toBinary();
        })
        .join("|");

      if (!rows.has(key)) {
        rows.set(key, {
          id: `target-${key}`,
          inputs: testCase.inputs,
          expected: testCase.expected,
        });
      }
    }

    return [...rows.values()].sort((left, right) => {
      const leftKey = challenge.interface.inputs
        .map((pin) => {
          const literal = left.inputs[pin.id];
          return literal === undefined
            ? ""
            : literalToVector(literal, pin.width).toBinary();
        })
        .join("");
      const rightKey = challenge.interface.inputs
        .map((pin) => {
          const literal = right.inputs[pin.id];
          return literal === undefined
            ? ""
            : literalToVector(literal, pin.width).toBinary();
        })
        .join("");
      return leftKey.localeCompare(rightKey);
    });
  }, [challenge, visualTestCases]);

  const visualSequenceSteps = useMemo<VisualSequenceStep[]>(() => {
    if (!challenge) return [];

    const steps: VisualSequenceStep[] = [];
    challenge.validators.forEach((validator, validatorIndex) => {
      if (validator.type !== "sequence") return;

      validator.steps.forEach((step, stepIndex) => {
        steps.push({
          id: `sequence-${validatorIndex}-${stepIndex}`,
          visibility: validator.visibility ?? "visible",
          validatorIndex,
          stepIndex,
          step,
        });
      });
    });

    return steps;
  }, [challenge]);

  function applyTruthRow(
    inputs: Readonly<Record<string, number | string>>,
  ): void {
    if (!challenge || testRunning) return;

    const next: Record<string, string> = {};
    for (const pin of challenge.interface.inputs) {
      const literal = inputs[pin.id];
      if (literal === undefined) continue;
      next[pin.id] = literalToVector(literal, pin.width).toBinary();
    }

    setInputValues((current) => ({
      ...current,
      ...next,
    }));
  }

  function truthRowIsActive(
    inputs: Readonly<Record<string, number | string>>,
  ): boolean {
    if (!challenge) return false;

    return challenge.interface.inputs.every((pin) => {
      const literal = inputs[pin.id];
      if (literal === undefined) return false;
      return (
        inputValues[pin.id] ===
        literalToVector(literal, pin.width).toBinary()
      );
    });
  }

  function truthRowMatches(
    expected: Readonly<Record<string, number | string>>,
  ): boolean {
    if (!challenge) return false;

    return challenge.interface.outputs.every((pin) => {
      const literal = expected[pin.id];
      if (literal === undefined) return false;
      const expectedValue = literalToVector(
        literal,
        pin.width,
      ).toBinary();
      return preview.outputs[pin.id] === expectedValue;
    });
  }

  function updateCircuit(
    updater: (current: CircuitDefinition) => CircuitDefinition,
    recordHistory = true,
  ): void {
    if (!challenge) return;
    const current = project.circuits[challenge.id] ?? createSubmission(challenge);

    if (recordHistory) {
      const stack = undoRef.current[challenge.id] ?? [];
      stack.push(current);
      if (stack.length > 100) stack.shift();
      undoRef.current[challenge.id] = stack;
      redoRef.current[challenge.id] = [];
    }

    const next = updater(current);
    setProject((previous) => ({
      ...previous,
      circuits: {
        ...previous.circuits,
        [challenge.id]: next,
      },
    }));
    setTestResult(null);
    setTestStates({});
    setActiveTestId(null);
  }

  function undo(): void {
    if (!challenge || !circuit) return;
    const stack = undoRef.current[challenge.id] ?? [];
    const previousCircuit = stack.pop();
    if (!previousCircuit) return;

    const redoStack = redoRef.current[challenge.id] ?? [];
    redoStack.push(circuit);
    redoRef.current[challenge.id] = redoStack;
    undoRef.current[challenge.id] = stack;

    setProject((previous) => ({
      ...previous,
      circuits: {
        ...previous.circuits,
        [challenge.id]: previousCircuit,
      },
    }));
    setTestResult(null);
    setTestStates({});
    setActiveTestId(null);
    setPendingPin(null);
    setSelectedInstance(null);
    setSelectedInstances([]);
    setSelectedConnection(null);
  }

  function redo(): void {
    if (!challenge || !circuit) return;
    const stack = redoRef.current[challenge.id] ?? [];
    const nextCircuit = stack.pop();
    if (!nextCircuit) return;

    const undoStack = undoRef.current[challenge.id] ?? [];
    undoStack.push(circuit);
    undoRef.current[challenge.id] = undoStack;
    redoRef.current[challenge.id] = stack;

    setProject((previous) => ({
      ...previous,
      circuits: {
        ...previous.circuits,
        [challenge.id]: nextCircuit,
      },
    }));
    setTestResult(null);
    setTestStates({});
    setActiveTestId(null);
    setPendingPin(null);
    setSelectedInstance(null);
    setSelectedInstances([]);
    setSelectedConnection(null);
  }

  const preview = useMemo<PreviewState>(() => {
    if (!challenge || !simulationRuntime.simulator || !simulationRuntime.netlist) {
      const empty: PreviewState = {
        outputs: {},
        signals: {},
      };
      return simulationRuntime.error
        ? { ...empty, error: simulationRuntime.error }
        : empty;
    }

    try {
      const outputs: Record<string, string> = {};
      for (const pin of challenge.interface.outputs) {
        outputs[pin.id] = simulationRuntime.simulator
          .readOutput(pin.id)
          .toBinary();
      }

      const signals: Record<string, string> = {};
      for (const net of simulationRuntime.netlist.nets) {
        const value = simulationRuntime.simulator.readNet(net.id).toBinary();
        for (const source of net.sourceVertices) signals[source] = value;
      }

      return { outputs, signals };
    } catch (error) {
      return {
        outputs: {},
        signals: {},
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [challenge, simulationRuntime, simulationRevision]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, select, button, [contenteditable='true']",
        )
      ) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
        if (selectedInstances.length > 0) {
          event.preventDefault();
          copySelection();
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
        if (clipboardRef.current) {
          event.preventDefault();
          pasteSelection();
        }
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedInstances.length > 0 || selectedInstance) {
          event.preventDefault();
          removeSelectedInstance();
        } else if (selectedConnection) {
          event.preventDefault();
          removeConnection(selectedConnection);
          setSelectedConnection(null);
        }
      }

      if (event.key === "Escape") {
        setPendingPin(null);
        setSelectedInstance(null);
        setSelectedInstances([]);
        setSelectedConnection(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedInstance, selectedInstances, selectedConnection, challenge?.id, circuit]);

  if (loadError) {
    return (
      <main className="fatal">
        <h1>GateOS Lab</h1>
        <p>{loadError}</p>
      </main>
    );
  }

  if (!manifest || !challenge || !circuit) {
    return (
      <main className="fatal">
        <h1>GateOS Lab</h1>
        <p>Loading curriculum…</p>
      </main>
    );
  }

  const currentIndex = challenges.findIndex((item) => item.id === challenge.id);
  const visualVerificationItems = [
    ...visualTestCases.map((testCase) => testCase.id),
    ...visualSequenceSteps.map((step) => step.id),
  ];
  const passedVisualTests = visualVerificationItems.filter(
    (id) => testStates[id]?.status === "pass",
  ).length;
  const allowedPalette = (challenge.allowedComponents ?? [])
    .map((id) => {
      try {
        return registry.get(id);
      } catch {
        return null;
      }
    })
    .filter((value): value is ComponentSpec => value !== null);

  function isUnlocked(index: number): boolean {
    if (index === 0) return true;
    const previous = challenges[index - 1];
    return previous ? project.completed.includes(previous.id) : false;
  }

  function captureTrace(label: string): void {
    if (!traceRuntime) return;
    traceRuntime.capture(label);
    setTraceRevision((current) => current + 1);
  }

  function stepSimulationEdge(edge: "rising" | "falling"): void {
    if (!simulationRuntime.simulator || testRunning) return;

    try {
      simulationRuntime.simulator.stepEdge(edge);
      captureTrace(`${edge} edge`);
      setSimulationRevision((current) => current + 1);
    } catch (error) {
      setProjectError(
        error instanceof Error ? `Simulation error: ${error.message}` : String(error),
      );
    }
  }

  function stepSimulationClock(): void {
    if (!simulationRuntime.simulator || testRunning) return;

    try {
      simulationRuntime.simulator.stepClock();
      captureTrace("clock");
      setSimulationRevision((current) => current + 1);
    } catch (error) {
      setProjectError(
        error instanceof Error ? `Simulation error: ${error.message}` : String(error),
      );
    }
  }

  function rewindSimulation(): void {
    if (!traceRuntime || !simulationRuntime.simulator || testRunning) return;
    const frame = traceRuntime.rewind();
    if (!frame) return;

    const snapshot = simulationRuntime.simulator.snapshot();
    const restoredInputs: Record<string, string> = {};
    for (const [pinId, value] of Object.entries(snapshot.inputs)) {
      restoredInputs[pinId] = value;
    }

    setInputValues((current) => ({ ...current, ...restoredInputs }));
    setSimulationRevision((current) => current + 1);
    setTraceRevision((current) => current + 1);
  }

  function clearTrace(): void {
    if (!traceRuntime) return;
    traceRuntime.clear();
    setTraceRevision((current) => current + 1);
  }

  function resetSimulation(): void {
    if (!challenge || !simulationRuntime.simulator || testRunning) return;

    try {
      simulationRuntime.simulator.reset();
      const zeros: Record<string, string> = {};
      for (const pin of challenge.interface.inputs) {
        zeros[pin.id] = zeroBits(pin.width);
      }
      setInputValues(zeros);
      traceRuntime?.clear();
      setSimulationRevision((current) => current + 1);
      setTraceRevision((current) => current + 1);
    } catch (error) {
      setProjectError(
        error instanceof Error ? `Simulation reset failed: ${error.message}` : String(error),
      );
    }
  }

  const hasSequentialNodes =
    simulationRuntime.netlist?.nodes.some(
      (node) =>
        node.primitiveId === "builtin.clock" ||
        node.primitiveId === "builtin.dff",
    ) ?? false;

  const traceFrames = traceRuntime?.frames.slice(-16) ?? [];
  const activeProbes = project.probes[challenge.id] ?? [];
  const probeNetIds = new Map<string, string>();
  if (simulationRuntime.netlist) {
    for (const probe of activeProbes) {
      const net = simulationRuntime.netlist.nets.find((candidate) =>
        candidate.sourceVertices.includes(probe.vertex),
      );
      if (net) probeNetIds.set(probe.id, net.id);
    }
  }
  void traceRevision;

  function addComponent(componentId: string): void {
    if (!circuit || isInspectingNested) return;
    const count = circuit.instances.length;
    const id = `u${Date.now().toString(36)}-${count}`;
    updateCircuit((current) => ({
      ...current,
      instances: [
        ...current.instances,
        {
          id,
          componentId,
          position: {
            x: 260 + (count % 4) * 150,
            y: 120 + Math.floor(count / 4) * 120,
          },
        },
      ],
    }));
    setSelectedInstance(id);
    setSelectedInstances([id]);
  }

  function onPinClick(endpoint: CircuitEndpoint): void {
    if (!challenge || !circuit || isInspectingNested) return;
    if (!pendingPin) {
      setPendingPin(endpoint);
      return;
    }

    if (endpointKey(pendingPin) === endpointKey(endpoint)) {
      setPendingPin(null);
      return;
    }

    const fromWidth = endpointWidth(
      pendingPin,
      challenge,
      circuit,
      registry,
    );
    const toWidth = endpointWidth(
      endpoint,
      challenge,
      circuit,
      registry,
    );

    if (fromWidth !== toWidth) {
      setProjectError(
        `Cannot connect ${fromWidth}-bit pin to ${toWidth}-bit pin.`,
      );
      setPendingPin(null);
      return;
    }

    setProjectError("");

    const connection: CircuitConnection = {
      id: `w-${Date.now().toString(36)}-${circuit.connections.length}`,
      from: pendingPin,
      to: endpoint,
    };

    updateCircuit((current) => ({
      ...current,
      connections: [...current.connections, connection],
    }));
    setPendingPin(null);
  }

  function removeConnection(id: string): void {
    if (isInspectingNested) return;
    updateCircuit((current) => ({
      ...current,
      connections: current.connections.filter((connection) => connection.id !== id),
    }));
    setSelectedConnection((current) => (current === id ? null : current));
  }

  function removeSelectedInstance(): void {
    if (isInspectingNested) return;
    const ids = new Set(
      selectedInstances.length > 0
        ? selectedInstances
        : selectedInstance
          ? [selectedInstance]
          : [],
    );
    if (ids.size === 0) return;

    updateCircuit((current) => ({
      ...current,
      instances: current.instances.filter(
        (instance) => !ids.has(instance.id),
      ),
      connections: current.connections.filter(
        (connection) =>
          !(
            connection.from.kind === "instance" &&
            ids.has(connection.from.instanceId)
          ) &&
          !(
            connection.to.kind === "instance" &&
            ids.has(connection.to.instanceId)
          ),
      ),
    }));
    setSelectedInstance(null);
    setSelectedInstances([]);
  }

  function copySelection(): void {
    if (!circuit || isInspectingNested || selectedInstances.length === 0) return;
    const ids = new Set(selectedInstances);

    clipboardRef.current = {
      instances: circuit.instances.filter((instance) => ids.has(instance.id)),
      connections: circuit.connections.filter(
        (connection) =>
          connection.from.kind === "instance" &&
          connection.to.kind === "instance" &&
          ids.has(connection.from.instanceId) &&
          ids.has(connection.to.instanceId),
      ),
    };
  }

  function pasteSelection(): void {
    if (!circuit || isInspectingNested || !clipboardRef.current) return;

    const idMap = new Map<string, string>();
    const stamp = Date.now().toString(36);
    const newInstances = clipboardRef.current.instances.map((instance, index) => {
      const id = `paste-${stamp}-${index}`;
      idMap.set(instance.id, id);
      const position = instance.position ?? { x: 360, y: 220 };
      return {
        ...instance,
        id,
        position: {
          x: position.x + 36,
          y: position.y + 36,
        },
      };
    });

    const newConnections = clipboardRef.current.connections.map(
      (connection, index) => {
        const mapEndpoint = (endpoint: CircuitEndpoint): CircuitEndpoint => {
          if (endpoint.kind === "interface") return endpoint;
          return {
            ...endpoint,
            instanceId: idMap.get(endpoint.instanceId) ?? endpoint.instanceId,
          };
        };

        return {
          ...connection,
          id: `paste-wire-${stamp}-${index}`,
          from: mapEndpoint(connection.from),
          to: mapEndpoint(connection.to),
        };
      },
    );

    updateCircuit((current) => ({
      ...current,
      instances: [...current.instances, ...newInstances],
      connections: [...current.connections, ...newConnections],
    }));

    const pastedIds = newInstances.map((instance) => instance.id);
    setSelectedInstances(pastedIds);
    setSelectedInstance(pastedIds[0] ?? null);
  }

  function addProbe(): void {
    if (!challenge || !displayCircuit || !selectedConnection) return;
    const connection = displayCircuit.connections.find(
      (candidate) => candidate.id === selectedConnection,
    );
    if (!connection) return;

    const vertex = signalVertex(connection.from, inspection.prefix);
    const width = endpointWidth(
      connection.from,
      challenge,
      displayCircuit,
      registry,
    );
    const existing = project.probes[challenge.id] ?? [];
    if (existing.some((probe) => probe.vertex === vertex)) return;

    const probe: ProbeDefinition = {
      id: `probe-${Date.now().toString(36)}`,
      name: `Probe ${existing.length + 1}`,
      vertex,
      width,
    };

    setProject((previous) => ({
      ...previous,
      probes: {
        ...previous.probes,
        [challenge.id]: [...existing, probe],
      },
    }));
  }

  function removeProbe(id: string): void {
    if (!challenge) return;
    const probes = project.probes[challenge.id] ?? [];
    setProject((previous) => ({
      ...previous,
      probes: {
        ...previous.probes,
        [challenge.id]: probes.filter((probe) => probe.id !== id),
      },
    }));
  }

  function renameProbe(id: string): void {
    if (!challenge) return;
    const probes = project.probes[challenge.id] ?? [];
    const current = probes.find((probe) => probe.id === id);
    if (!current) return;

    const nextName = window.prompt("Probe name", current.name)?.trim();
    if (!nextName) return;

    setProject((previous) => ({
      ...previous,
      probes: {
        ...previous.probes,
        [challenge.id]: probes.map((probe) =>
          probe.id === id ? { ...probe, name: nextName } : probe,
        ),
      },
    }));
  }

  function exportProject(): void {
    const blob = new Blob([JSON.stringify(project, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "gateos-project.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importProject(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const imported = normalizeProject(parsed, true);
      setProject(imported);
      setProjectError("");
      setSelectedInstance(null);
      setSelectedInstances([]);
      setSelectedConnection(null);
      setPendingPin(null);
      setTestResult(null);
      setTestStates({});
    } catch (error) {
      setProjectError(
        error instanceof Error
          ? `Project import failed: ${error.message}`
          : "Project import failed.",
      );
    }
  }

  function clientToCanvasPoint(clientX: number, clientY: number): Point {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: clientX, y: clientY };

    return {
      x:
        viewport.x +
        ((clientX - rect.left) / rect.width) * viewport.width,
      y:
        viewport.y +
        ((clientY - rect.top) / rect.height) * viewport.height,
    };
  }

  function canvasPoint(event: ReactPointerEvent<SVGSVGElement>): Point {
    return clientToCanvasPoint(event.clientX, event.clientY);
  }

  function zoomAt(clientX: number, clientY: number, factor: number): void {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;

    setViewport((current) => {
      const worldX =
        current.x + ((clientX - rect.left) / rect.width) * current.width;
      const worldY =
        current.y + ((clientY - rect.top) / rect.height) * current.height;
      const nextWidth = Math.max(
        300,
        Math.min(CANVAS_WIDTH * 2.5, current.width * factor),
      );
      const nextHeight = nextWidth * (CANVAS_HEIGHT / CANVAS_WIDTH);
      const rx = (worldX - current.x) / current.width;
      const ry = (worldY - current.y) / current.height;

      return {
        x: worldX - rx * nextWidth,
        y: worldY - ry * nextHeight,
        width: nextWidth,
        height: nextHeight,
      };
    });
  }

  function resetViewport(): void {
    setViewport({
      x: 0,
      y: 0,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
    });
  }

  function beginPan(event: ReactPointerEvent<SVGRectElement>): void {
    if (event.button !== 0 || testRunning) return;
    event.stopPropagation();
    setPan({
      clientX: event.clientX,
      clientY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
    });
    setSelectedInstance(null);
    setSelectedInstances([]);
    setSelectedConnection(null);
    setPendingPin(null);
  }

  function beginDrag(
    event: ReactPointerEvent<SVGGElement>,
    instanceId: string,
  ): void {
    if (!circuit || !challenge || testRunning || isInspectingNested) return;
    event.stopPropagation();

    if (!selectedInstances.includes(instanceId)) {
      setSelectedInstances([instanceId]);
      setSelectedInstance(instanceId);
    }

    const stack = undoRef.current[challenge.id] ?? [];
    stack.push(circuit);
    if (stack.length > 100) stack.shift();
    undoRef.current[challenge.id] = stack;
    redoRef.current[challenge.id] = [];
    const position = instancePosition(circuit, instanceId);
    const point = clientToCanvasPoint(event.clientX, event.clientY);

    setDrag({
      instanceId,
      offsetX: point.x - position.x,
      offsetY: point.y - position.y,
    });
    setSelectedInstance(instanceId);
  }

  function moveDrag(event: ReactPointerEvent<SVGSVGElement>): void {
    if (pan) {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = ((event.clientX - pan.clientX) / rect.width) * viewport.width;
      const dy = ((event.clientY - pan.clientY) / rect.height) * viewport.height;
      setViewport((current) => ({
        ...current,
        x: pan.originX - dx,
        y: pan.originY - dy,
      }));
      return;
    }

    if (!drag) return;
    const point = canvasPoint(event);

    updateCircuit(
      (current) => ({
        ...current,
        instances: current.instances.map((instance) =>
          instance.id === drag.instanceId
            ? {
                ...instance,
                position: {
                  x: Math.max(
                    90,
                    Math.min(CANVAS_WIDTH - 230, point.x - drag.offsetX),
                  ),
                  y: Math.max(
                    30,
                    Math.min(CANVAS_HEIGHT - 120, point.y - drag.offsetY),
                  ),
                },
              }
            : instance,
        ),
      }),
      false,
    );
  }

  function evaluateVisualTest(testCase: VisualTestCase): VisualTestState {
    if (!challenge || !circuit) {
      return { status: "fail", error: "No active challenge" };
    }

    try {
      const netlist = compileCircuit(circuit, registry);
      const simulator = new Simulator(
        netlist,
        createBuiltinPrimitiveRegistry(),
      );

      for (const pin of challenge.interface.inputs) {
        const literal = testCase.inputs[pin.id];
        if (literal === undefined) {
          throw new Error(`Test case is missing input ${pin.id}`);
        }
        simulator.setInput(pin.id, literalToVector(literal, pin.width));
      }

      simulator.settle();

      const actual: Record<string, string> = {};
      let passed = true;

      for (const pin of challenge.interface.outputs) {
        const expectedLiteral = testCase.expected[pin.id];
        if (expectedLiteral === undefined) {
          throw new Error(`Test case is missing expected output ${pin.id}`);
        }

        const expected = literalToVector(expectedLiteral, pin.width);
        const output = simulator.readOutput(pin.id);
        actual[pin.id] = output.toBinary();

        if (!output.equals(expected)) passed = false;
      }

      return {
        status: passed ? "pass" : "fail",
        actual,
      };
    } catch (error) {
      return {
        status: "fail",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function runTests(): Promise<void> {
    if (!challenge || !circuit || testRunning) return;

    setTestRunning(true);
    setTestResult(null);
    setTestStates(
      Object.fromEntries(
        visualVerificationItems.map((id) => [
          id,
          { status: "idle" as const },
        ]),
      ),
    );

    try {
      for (const testCase of visualTestCases) {
        setActiveTestId(testCase.id);
        setTestStates((current) => ({
          ...current,
          [testCase.id]: { status: "running" },
        }));

        const animatedInputs: Record<string, string> = {};
        for (const pin of challenge.interface.inputs) {
          const literal = testCase.inputs[pin.id];
          if (literal !== undefined) {
            animatedInputs[pin.id] = literalToVector(
              literal,
              pin.width,
            ).toBinary();
          }
        }
        setInputValues((current) => ({ ...current, ...animatedInputs }));

        await sleep(420);

        const state = evaluateVisualTest(testCase);
        setTestStates((current) => ({
          ...current,
          [testCase.id]: state,
        }));

        await sleep(state.status === "pass" ? 180 : 420);
      }

      const sequenceValidators = challenge.validators
        .map((validator, validatorIndex) => ({ validator, validatorIndex }))
        .filter(
          (
            entry,
          ): entry is {
            validator: Extract<
              ChallengeDefinition["validators"][number],
              { type: "sequence" }
            >;
            validatorIndex: number;
          } => entry.validator.type === "sequence",
        );

      for (const { validator, validatorIndex } of sequenceValidators) {
        const simulator =
          simulationRuntime.simulator ??
          new Simulator(
            compileCircuit(circuit, registry),
            createBuiltinPrimitiveRegistry(),
          );

        simulator.reset();
        setSimulationRevision((current) => current + 1);
        await sleep(220);

        for (let stepIndex = 0; stepIndex < validator.steps.length; stepIndex += 1) {
          const step = validator.steps[stepIndex];
          if (!step) continue;

          const id = `sequence-${validatorIndex}-${stepIndex}`;
          setActiveTestId(id);
          setTestStates((current) => ({
            ...current,
            [id]: { status: "running" },
          }));

          try {
            if ("set" in step) {
              const animatedInputs: Record<string, string> = {};

              for (const [pinId, literal] of Object.entries(step.set)) {
                const pin = challenge.interface.inputs.find(
                  (candidate) => candidate.id === pinId,
                );
                if (!pin) throw new Error(`Unknown input ${pinId}`);

                simulator.setInput(
                  pinId,
                  literalToVector(literal, pin.width),
                );

                animatedInputs[pinId] = literalToVector(
                  literal,
                  pin.width,
                ).toBinary();
              }

              simulator.settle();
              setInputValues((current) => ({
                ...current,
                ...animatedInputs,
              }));
              setSimulationRevision((current) => current + 1);
              setTestStates((current) => ({
                ...current,
                [id]: { status: "pass" },
              }));
            } else if ("edge" in step) {
              simulator.stepEdge(step.edge);
              setSimulationRevision((current) => current + 1);
              setTestStates((current) => ({
                ...current,
                [id]: { status: "pass" },
              }));
            } else if ("clock" in step) {
              for (let count = 0; count < step.clock; count += 1) {
                simulator.stepClock();
              }
              setSimulationRevision((current) => current + 1);
              setTestStates((current) => ({
                ...current,
                [id]: { status: "pass" },
              }));
            } else {
              const actual: Record<string, string> = {};
              let passed = true;

              for (const [pinId, literal] of Object.entries(step.expect)) {
                const pin = challenge.interface.outputs.find(
                  (candidate) => candidate.id === pinId,
                );
                if (!pin) throw new Error(`Unknown output ${pinId}`);

                const expected = literalToVector(literal, pin.width);
                const output = simulator.readOutput(pinId);
                actual[pinId] = output.toBinary();
                if (!output.equals(expected)) passed = false;
              }

              setTestStates((current) => ({
                ...current,
                [id]: {
                  status: passed ? "pass" : "fail",
                  actual,
                },
              }));
            }
          } catch (error) {
            setTestStates((current) => ({
              ...current,
              [id]: {
                status: "fail",
                error: error instanceof Error ? error.message : String(error),
              },
            }));
          }

          await sleep(320);
        }
      }

      const result = runChallenge(
        challenge,
        circuit,
        registry,
        createBuiltinPrimitiveRegistry(),
      );
      setTestResult(result);
    } finally {
      setActiveTestId(null);
      setTestRunning(false);
    }
  }

  function publish(): void {
    if (!testResult?.passed || !challenge || !circuit) return;
    const id = publishedId(challenge.id);
    const publishedCircuit: CircuitDefinition = {
      ...circuit,
      id: `artifact.${challenge.id}`,
      name: challenge.title,
    };

    setProject((previous) => ({
      ...previous,
      published: {
        ...previous.published,
        [id]: publishedCircuit,
      },
      completed: previous.completed.includes(challenge.id)
        ? previous.completed
        : [...previous.completed, challenge.id],
    }));
  }

  function enterComposite(instanceId: string): void {
    if (!displayCircuit) return;
    const instance = displayCircuit.instances.find(
      (candidate) => candidate.id === instanceId,
    );
    if (!instance) return;

    try {
      const spec = registry.get(instance.componentId);
      if (spec.kind !== "composite") return;
      setInspectionPath((current) => [...current, instanceId]);
      setSelectedInstance(null);
      setSelectedInstances([]);
      setSelectedConnection(null);
      setPendingPin(null);
      resetViewport();
    } catch {
      // Unknown components cannot be entered.
    }
  }

  function leaveToDepth(depth: number): void {
    setInspectionPath((current) => current.slice(0, depth));
    setSelectedInstance(null);
    setSelectedInstances([]);
    setSelectedConnection(null);
    setPendingPin(null);
    resetViewport();
  }

  function resetChallenge(): void {
    if (!challenge) return;
    setProject((previous) => {
      const circuits = { ...previous.circuits };
      delete circuits[challenge.id];
      return { ...previous, circuits };
    });
    setTestResult(null);
    setPendingPin(null);
    setSelectedInstance(null);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <strong>GateOS Lab</strong>
          <span className="muted"> · {manifest.title}</span>
        </div>
        <div className="topbar-actions">
          <button onClick={undo}>Undo</button>
          <button onClick={redo}>Redo</button>
          <button onClick={exportProject}>Export project</button>
          <button onClick={() => importInputRef.current?.click()}>
            Import project
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => void importProject(event)}
          />
          <button onClick={resetChallenge}>Reset challenge</button>
          <span className="progress">
            {project.completed.length}/{challenges.length} complete
          </span>
        </div>
      </header>

      <aside className="sidebar left-panel">
        <h2>Curriculum</h2>
        <nav className="challenge-list">
          {challenges.map((item, index) => {
            const unlocked = isUnlocked(index);
            const completed = project.completed.includes(item.id);
            return (
              <button
                key={item.id}
                className={[
                  "challenge-item",
                  item.id === challenge.id ? "active" : "",
                  completed ? "complete" : "",
                ].join(" ")}
                data-testid={`challenge-${item.id}`}
                disabled={!unlocked}
                onClick={() => setSelectedId(item.id)}
              >
                <span>{index + 1}</span>
                <span>{item.title}</span>
                <span>{completed ? "✓" : unlocked ? "" : "🔒"}</span>
              </button>
            );
          })}
        </nav>

        <h2>Components</h2>
        <div className="palette">
          {allowedPalette.length === 0 ? (
            <p className="muted">Required chips are not published yet.</p>
          ) : (
            allowedPalette.map((spec) => (
              <button
                key={spec.id}
                data-testid={`palette-${spec.id}`}
                onClick={() => addComponent(spec.id)}
              >
                <strong>{componentDisplayName(spec)}</strong>
                <small>{spec.id}</small>
              </button>
            ))
          )}
        </div>
      </aside>

      <main className="workspace">
        {projectError ? (
          <div className="project-error">
            <span>{projectError}</span>
            <button onClick={() => setProjectError("")}>Dismiss</button>
          </div>
        ) : null}
        <section className="challenge-header">
          <div>
            <p className="eyebrow">Challenge {currentIndex + 1}</p>
            <h1>{challenge.title}</h1>
            <p>{challenge.description}</p>
          </div>
          <div className="run-actions">
            <button
              className="primary"
              data-testid="run-tests"
              disabled={testRunning}
              onClick={() => void runTests()}
            >
              {testRunning ? "Testing…" : "Run all tests"}
            </button>
            <button
              className="success"
              data-testid="publish-chip"
              disabled={!testResult?.passed}
              onClick={publish}
            >
              Publish chip
            </button>
          </div>
        </section>

        {targetTruthRows.length > 0 ? (
          <section className="truth-table-panel" data-testid="target-truth-table">
            <div className="truth-table-header">
              <div>
                <strong>Target truth table</strong>
                <p>
                  이 회로가 만족해야 하는 전체 입출력 관계입니다. 행을 클릭하면
                  해당 입력 조합을 회로에 바로 적용합니다.
                </p>
              </div>
              <span>{targetTruthRows.length} rows</span>
            </div>

            <div className="truth-table-scroll">
              <table>
                <thead>
                  <tr>
                    {challenge.interface.inputs.map((pin) => (
                      <th key={`in-${pin.id}`} className="truth-input-column">
                        {pin.name}
                        {pin.width > 1 ? <small>{pin.width}b</small> : null}
                      </th>
                    ))}
                    <th className="truth-divider" aria-hidden="true" />
                    {challenge.interface.outputs.map((pin) => (
                      <th key={`out-${pin.id}`} className="truth-output-column">
                        {pin.name}
                        {pin.width > 1 ? <small>{pin.width}b</small> : null}
                      </th>
                    ))}
                    <th className="truth-status-column">Now</th>
                  </tr>
                </thead>
                <tbody>
                  {targetTruthRows.map((row, rowIndex) => {
                    const active = truthRowIsActive(row.inputs);
                    const matches = active && truthRowMatches(row.expected);

                    return (
                      <tr
                        key={row.id}
                        data-testid={`truth-row-${rowIndex}`}
                        className={active ? "active" : ""}
                        onClick={() => applyTruthRow(row.inputs)}
                        title="Apply this input combination"
                      >
                        {challenge.interface.inputs.map((pin) => {
                          const literal = row.inputs[pin.id];
                          const value =
                            literal === undefined
                              ? "?"
                              : literalToVector(
                                  literal,
                                  pin.width,
                                ).toBinary();
                          return (
                            <td key={`in-${pin.id}`}>
                              <code>{value}</code>
                              {pin.width > 1 ? (
                                <small>{signalHex(value)}</small>
                              ) : null}
                            </td>
                          );
                        })}
                        <td className="truth-divider" aria-hidden="true" />
                        {challenge.interface.outputs.map((pin) => {
                          const literal = row.expected[pin.id];
                          const value =
                            literal === undefined
                              ? "?"
                              : literalToVector(
                                  literal,
                                  pin.width,
                                ).toBinary();
                          return (
                            <td key={`out-${pin.id}`}>
                              <code>{value}</code>
                              {pin.width > 1 ? (
                                <small>{signalHex(value)}</small>
                              ) : null}
                            </td>
                          );
                        })}
                        <td className="truth-live-status">
                          {active ? (
                            <span className={matches ? "match" : "mismatch"}>
                              {matches ? "✓" : "≠"}
                            </span>
                          ) : (
                            <span>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="truth-table-legend">
              <span>
                <strong>✓</strong> 현재 회로 출력이 목표와 일치
              </span>
              <span>
                <strong>≠</strong> 현재 입력은 이 행이지만 출력이 아직 다름
              </span>
            </div>
          </section>
        ) : null}

        {(challenge.referenceTables ?? []).map((table) => (
          <section
            key={table.id}
            className="reference-table-panel"
            data-testid={`reference-table-${table.id}`}
          >
            <div className="reference-table-header">
              <div>
                <strong>{table.title}</strong>
                {table.description ? <p>{table.description}</p> : null}
                {table.timing ? (
                  <p className="reference-timing">
                    <strong>Timing:</strong> {table.timing}
                  </p>
                ) : null}
              </div>
              <span>State / characteristic table</span>
            </div>

            <div className="reference-table-scroll">
              <table>
                <thead>
                  <tr>
                    {table.columns.map((column) => (
                      <th
                        key={column.id}
                        className={`reference-column-${column.group ?? "note"}`}
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {table.columns.map((column) => (
                        <td key={column.id}>
                          {column.group === "note" ? (
                            <span>{row[column.id] ?? "—"}</span>
                          ) : (
                            <code>{row[column.id] ?? "—"}</code>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {table.notes && table.notes.length > 0 ? (
              <div className="reference-table-notes">
                {table.notes.map((note, index) => (
                  <span key={index}>• {note}</span>
                ))}
              </div>
            ) : null}
          </section>
        ))}

        <div className="hierarchy-bar">
          <div className="breadcrumbs">
            <button
              className={inspectionPath.length === 0 ? "active" : ""}
              onClick={() => leaveToDepth(0)}
            >
              {challenge.title}
            </button>
            {inspection.breadcrumbs.map((crumb, index) => (
              <span key={`${crumb.id}-${index}`}>
                <span className="crumb-separator">›</span>
                <button
                  className={
                    index === inspection.breadcrumbs.length - 1 ? "active" : ""
                  }
                  onClick={() => leaveToDepth(index + 1)}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </div>
          <span className="hierarchy-mode">
            {isInspectingNested
              ? "Inspect mode · double-click another composite to go deeper"
              : "Edit mode · double-click a composite chip to inspect inside"}
          </span>
        </div>

        <section className="io-strip">
          <div>
            <strong>Inputs</strong>
            {challenge.interface.inputs.map((pin) => {
              const binary = inputValues[pin.id] ?? zeroBits(pin.width);

              if (pin.width === 1) {
                return (
                  <button
                    key={pin.id}
                    className="io-value"
                    data-testid={`input-${pin.id}`}
                    disabled={testRunning}
                    onClick={() =>
                      setInputValues((current) => ({
                        ...current,
                        [pin.id]:
                          current[pin.id] === "1" ? "0" : "1",
                      }))
                    }
                  >
                    {pin.name}: {binary}
                  </button>
                );
              }

              const max = ((1n << BigInt(pin.width)) - 1n).toString(10);
              return (
                <label key={pin.id} className="bus-input">
                  <span>{pin.name}</span>
                  <input
                    type="number"
                    min="0"
                    max={max}
                    disabled={testRunning}
                    value={concreteInputNumber(binary)}
                    onChange={(event) => {
                      if (event.target.value === "") return;
                      try {
                        const value = BigInt(event.target.value);
                        const limit = 1n << BigInt(pin.width);
                        if (value < 0n || value >= limit) return;
                        const next = BitVector.fromBigInt(
                          value,
                          pin.width,
                        ).toBinary();
                        setInputValues((current) => ({
                          ...current,
                          [pin.id]: next,
                        }));
                      } catch {
                        // Keep the last valid bus value.
                      }
                    }}
                  />
                  <code>{binary}</code>
                  <small>{signalHex(binary)}</small>
                </label>
              );
            })}
          </div>
          <div>
            <strong>Outputs</strong>
            {challenge.interface.outputs.map((pin) => (
              <span key={pin.id} className="io-output">
                {pin.name}: {preview.outputs[pin.id] ?? "X"}
                {pin.width > 1 ? (
                  <small>
                    {signalHex(preview.outputs[pin.id] ?? "X")}
                  </small>
                ) : null}
              </span>
            ))}
          </div>
          {preview.error ? <span className="error-text">{preview.error}</span> : null}
          {hasSequentialNodes ? (
            <div className="clock-controls">
              <strong>Clock</strong>
              <button
                disabled={testRunning}
                onClick={() => stepSimulationEdge("rising")}
                title="Rising edge"
              >
                ↑ edge
              </button>
              <button
                disabled={testRunning}
                onClick={() => stepSimulationEdge("falling")}
                title="Falling edge"
              >
                ↓ edge
              </button>
              <button
                disabled={testRunning}
                onClick={stepSimulationClock}
                title="Rising + falling edge"
              >
                Step clock
              </button>
              <button
                disabled={testRunning || !(traceRuntime?.canRewind ?? false)}
                onClick={rewindSimulation}
                title="Restore the state before the last captured step"
              >
                Rewind
              </button>
              <button
                disabled={testRunning}
                onClick={resetSimulation}
                title="Reset sequential state and cycle counter"
              >
                Reset sim
              </button>
              <span>
                cycle {simulationRuntime.simulator?.cycle ?? 0}
              </span>
            </div>
          ) : null}
        </section>

        <section className="canvas-frame">
          <div className="canvas-toolbar">
            <span>Drag empty space to pan · mouse wheel to zoom</span>
            <div>
              <button
                onClick={() => {
                  const rect = svgRef.current?.getBoundingClientRect();
                  if (rect) zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 0.8);
                }}
              >
                +
              </button>
              <button
                onClick={() => {
                  const rect = svgRef.current?.getBoundingClientRect();
                  if (rect) zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.25);
                }}
              >
                −
              </button>
              <button onClick={resetViewport}>Reset view</button>
            </div>
          </div>
          <svg
            ref={svgRef}
            className={testRunning ? "circuit-canvas testing" : "circuit-canvas"}
            viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`}
            onPointerMove={moveDrag}
            onPointerUp={() => {
              setDrag(null);
              setPan(null);
            }}
            onPointerLeave={() => {
              setDrag(null);
              setPan(null);
            }}
            onClick={() => {
              if (drag || pan) return;
              setSelectedInstance(null);
              setSelectedInstances([]);
              setSelectedConnection(null);
              setPendingPin(null);
            }}
          >
            <defs>
              <pattern
                id="grid"
                width="24"
                height="24"
                patternUnits="userSpaceOnUse"
              >
                <path d="M 24 0 L 0 0 0 24" className="grid-line" />
              </pattern>
            </defs>
            <rect
              x={-CANVAS_WIDTH}
              y={-CANVAS_HEIGHT}
              width={CANVAS_WIDTH * 3}
              height={CANVAS_HEIGHT * 3}
              fill="url(#grid)"
              onPointerDown={beginPan}
            />

            {(displayCircuit?.connections ?? []).map((connection) => {
              const from = getEndpointPoint(
                connection.from,
                displayCircuit!,
                registry,
              );
              const to = getEndpointPoint(
                connection.to,
                displayCircuit!,
                registry,
              );
              const curve = Math.max(60, Math.abs(to.x - from.x) * 0.4);
              return (
                <path
                  key={connection.id}
                  className={
                    selectedConnection === connection.id
                      ? "wire selected"
                      : "wire"
                  }
                  d={`M ${from.x} ${from.y} C ${from.x + curve} ${from.y}, ${to.x - curve} ${to.y}, ${to.x} ${to.y}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedConnection(connection.id);
                    setSelectedInstance(null);
                  }}
                />
              );
            })}

            {displayInputPins.map((pin) => {
              const point = interfacePinPoint(displayCircuit!, pin.id);
              const endpoint: CircuitEndpoint = {
                kind: "interface",
                pinId: pin.id,
              };
              return (
                <g key={pin.id}>
                  <text x={point.x - 12} y={point.y - 16} textAnchor="middle">
                    {pin.name}
                  </text>
                  <circle
                    className={
                      endpointKey(pendingPin ?? endpoint) === endpointKey(endpoint) &&
                      pendingPin
                        ? "pin pending"
                        : "pin"
                    }
                    data-testid={`pin-interface-${pin.id}`}
                    data-pin-id={pin.id}
                    cx={point.x}
                    cy={point.y}
                    r="8"
                    onClick={(event) => {
                      event.stopPropagation();
                      onPinClick(endpoint);
                    }}
                  />
                  <text x={point.x} y={point.y + 28} textAnchor="middle" className="signal-label">
                    {preview.signals[signalVertex(endpoint, inspection.prefix)] ?? "X"}
                  </text>
                </g>
              );
            })}

            {displayOutputPins.map((pin) => {
              const point = interfacePinPoint(displayCircuit!, pin.id);
              const endpoint: CircuitEndpoint = {
                kind: "interface",
                pinId: pin.id,
              };
              return (
                <g key={pin.id}>
                  <text x={point.x + 12} y={point.y - 16} textAnchor="middle">
                    {pin.name}
                  </text>
                  <circle
                    className={
                      endpointKey(pendingPin ?? endpoint) === endpointKey(endpoint) &&
                      pendingPin
                        ? "pin pending"
                        : "pin"
                    }
                    data-testid={`pin-interface-${pin.id}`}
                    data-pin-id={pin.id}
                    cx={point.x}
                    cy={point.y}
                    r="8"
                    onClick={(event) => {
                      event.stopPropagation();
                      onPinClick(endpoint);
                    }}
                  />
                  <text x={point.x} y={point.y + 28} textAnchor="middle" className="signal-label">
                    {preview.signals[signalVertex(endpoint, inspection.prefix)] ?? "X"}
                  </text>
                </g>
              );
            })}

            {(displayCircuit?.instances ?? []).map((instance) => {
              const spec = registry.get(instance.componentId);
              const pins = componentPins(spec);
              const position = instance.position ?? { x: 360, y: 220 };
              const inputs = pins.filter(
                (pin) => pin.direction === "input" || pin.direction === "inout",
              );
              const outputs = pins.filter(
                (pin) => pin.direction === "output" || pin.direction === "inout",
              );
              const rows = Math.max(inputs.length, outputs.length, 1);
              const height = 58 + rows * 28;

              return (
                <g
                  key={instance.id}
                  className="component"
                  data-testid={`component-${instance.id}`}
                  data-instance-id={instance.id}
                  onPointerDown={(event) => beginDrag(event, instance.id)}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    enterComposite(instance.id);
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedConnection(null);

                    if (event.shiftKey) {
                      setSelectedInstances((current) => {
                        const exists = current.includes(instance.id);
                        const next = exists
                          ? current.filter((id) => id !== instance.id)
                          : [...current, instance.id];
                        setSelectedInstance(next[0] ?? null);
                        return next;
                      });
                    } else {
                      setSelectedInstance(instance.id);
                      setSelectedInstances([instance.id]);
                    }
                  }}
                >
                  <rect
                    x={position.x}
                    y={position.y}
                    width="140"
                    height={height}
                    rx="10"
                    className={
                      selectedInstances.includes(instance.id)
                        ? "component-body selected"
                        : "component-body"
                    }
                  />
                  <text
                    x={position.x + 70}
                    y={position.y + 24}
                    textAnchor="middle"
                    className="component-title"
                  >
                    {componentDisplayName(spec)}
                  </text>

                  {inputs.map((pin) => {
                    const endpoint: CircuitEndpoint = {
                      kind: "instance",
                      instanceId: instance.id,
                      pinId: pin.id,
                    };
                    const point = componentPinPoint(
                      displayCircuit!,
                      registry,
                      instance.id,
                      pin.id,
                    );
                    return (
                      <g key={pin.id}>
                        <circle
                          className={
                            pendingPin &&
                            endpointKey(pendingPin) === endpointKey(endpoint)
                              ? "pin pending"
                              : "pin"
                          }
                          data-pin-id={pin.id}
                          cx={point.x}
                          cy={point.y}
                          r="7"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            onPinClick(endpoint);
                          }}
                        />
                        <text x={point.x + 12} y={point.y + 4} className="pin-name">
                          {pin.name}
                        </text>
                        <text x={point.x + 12} y={point.y + 18} className="signal-label">
                          {preview.signals[signalVertex(endpoint, inspection.prefix)] ?? "X"}
                        </text>
                      </g>
                    );
                  })}

                  {outputs.map((pin) => {
                    const endpoint: CircuitEndpoint = {
                      kind: "instance",
                      instanceId: instance.id,
                      pinId: pin.id,
                    };
                    const point = componentPinPoint(
                      displayCircuit!,
                      registry,
                      instance.id,
                      pin.id,
                    );
                    return (
                      <g key={pin.id}>
                        <circle
                          className={
                            pendingPin &&
                            endpointKey(pendingPin) === endpointKey(endpoint)
                              ? "pin pending"
                              : "pin"
                          }
                          data-pin-id={pin.id}
                          cx={point.x}
                          cy={point.y}
                          r="7"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            onPinClick(endpoint);
                          }}
                        />
                        <text
                          x={point.x - 12}
                          y={point.y + 4}
                          textAnchor="end"
                          className="pin-name"
                        >
                          {pin.name}
                        </text>
                        <text
                          x={point.x - 12}
                          y={point.y + 18}
                          textAnchor="end"
                          className="signal-label"
                        >
                          {preview.signals[signalVertex(endpoint, inspection.prefix)] ?? "X"}
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </section>

        {hasSequentialNodes ? (
          <section className="waveform-panel">
            <div className="waveform-header">
              <div>
                <strong>Waveform</strong>
                <p className="muted">
                  Probes are sampled after each captured edge/clock step. Rewind restores the
                  previous simulator state.
                </p>
              </div>
              <div>
                <span>{traceFrames.length} frames</span>
                <button
                  disabled={traceFrames.length === 0}
                  onClick={clearTrace}
                >
                  Clear
                </button>
              </div>
            </div>

            {activeProbes.length === 0 ? (
              <p className="waveform-empty">
                Select a wire in the Inspector and add a Probe to watch it here.
              </p>
            ) : traceFrames.length === 0 ? (
              <p className="waveform-empty">
                Step the clock or an edge to capture the first waveform sample.
              </p>
            ) : (
              <div className="waveform-scroll">
                <div
                  className="waveform-grid"
                  style={{
                    gridTemplateColumns: `150px repeat(${traceFrames.length}, minmax(54px, 1fr))`,
                  }}
                >
                  <div className="waveform-corner">signal / frame</div>
                  {traceFrames.map((frame) => (
                    <div key={frame.index} className="waveform-frame-label">
                      <strong>{frame.index}</strong>
                      <small>c{frame.cycleAfter}</small>
                    </div>
                  ))}

                  {activeProbes.flatMap((probe) => {
                    const netId = probeNetIds.get(probe.id);
                    return [
                      <div key={`${probe.id}-name`} className="waveform-name">
                        <strong>{probe.name}</strong>
                        <small>{probe.width}b</small>
                      </div>,
                      ...traceFrames.map((frame) => {
                        const value = netId
                          ? frame.signalSamples[netId] ?? "·"
                          : "·";
                        return (
                          <div
                            key={`${probe.id}-${frame.index}`}
                            className={[
                              "waveform-cell",
                              value.includes("X") ? "unknown" : "",
                            ].join(" ")}
                            title={frame.label ?? `frame ${frame.index}`}
                          >
                            {value}
                          </div>
                        );
                      }),
                    ];
                  })}
                </div>
              </div>
            )}
          </section>
        ) : null}

        <section className="test-runner">
          <div className="test-runner-header">
            <div>
              <strong>Verification</strong>
              <p className="muted">
                테스트를 실행하면 각 입력 조합이 회로에 실제로 적용되고,
                신호가 전파된 뒤 결과를 비교합니다.
              </p>
            </div>
            <div className="test-summary">
              <span>
                {passedVisualTests}/{visualVerificationItems.length} steps
              </span>
              {testResult ? (
                <strong
                  data-testid="test-overall-result"
                  className={testResult.passed ? "pass" : "fail"}
                >
                  {testResult.passed ? "ALL TESTS PASSED" : "TEST FAILED"}
                </strong>
              ) : (
                <strong>{testRunning ? "RUNNING" : "NOT VERIFIED"}</strong>
              )}
            </div>
          </div>

          <div className="test-case-list">
            {visualTestCases.map((testCase, index) => {
              const state = testStates[testCase.id] ?? { status: "idle" as const };
              const reveal =
                testCase.visibility === "visible" || state.status !== "idle";
              const isActive = activeTestId === testCase.id;

              return (
                <div
                  key={testCase.id}
                  className={[
                    "test-case-row",
                    state.status,
                    isActive ? "active" : "",
                  ].join(" ")}
                >
                  <span className="test-case-number">{index + 1}</span>
                  <div>
                    <small>INPUT</small>
                    <code>
                      {reveal
                        ? formatSignals(testCase.inputs)
                        : "hidden until execution"}
                    </code>
                  </div>
                  <div>
                    <small>EXPECTED</small>
                    <code>
                      {reveal
                        ? formatSignals(testCase.expected)
                        : "hidden until execution"}
                    </code>
                  </div>
                  <div>
                    <small>ACTUAL</small>
                    <code>
                      {state.error
                        ? state.error
                        : formatActual(state.actual)}
                    </code>
                  </div>
                  <span className="test-case-status">
                    {state.status === "idle"
                      ? "○"
                      : state.status === "running"
                        ? "▶"
                        : state.status === "pass"
                          ? "✓"
                          : "✗"}
                  </span>
                </div>
              );
            })}
            {visualSequenceSteps.map((sequenceStep, index) => {
              const state =
                testStates[sequenceStep.id] ?? { status: "idle" as const };
              const reveal =
                sequenceStep.visibility === "visible" ||
                state.status !== "idle";
              const isActive = activeTestId === sequenceStep.id;
              const step = sequenceStep.step;

              let action = "STEP";
              let detail = "";
              let expected = "—";

              if ("set" in step) {
                action = "SET";
                detail = reveal
                  ? formatSignals(step.set)
                  : "hidden until execution";
              } else if ("edge" in step) {
                action = "EDGE";
                detail = reveal ? step.edge.toUpperCase() : "hidden";
              } else if ("clock" in step) {
                action = "CLOCK";
                detail = reveal ? `× ${step.clock}` : "hidden";
              } else {
                action = "EXPECT";
                expected = reveal
                  ? formatSignals(step.expect)
                  : "hidden until execution";
              }

              return (
                <div
                  key={sequenceStep.id}
                  className={[
                    "test-case-row",
                    "sequence-step-row",
                    state.status,
                    isActive ? "active" : "",
                  ].join(" ")}
                >
                  <span className="test-case-number">
                    S{index + 1}
                  </span>
                  <div>
                    <small>ACTION</small>
                    <code>{action}</code>
                  </div>
                  <div>
                    <small>VALUE / EXPECTED</small>
                    <code>{action === "EXPECT" ? expected : detail}</code>
                  </div>
                  <div>
                    <small>ACTUAL</small>
                    <code>
                      {state.error
                        ? state.error
                        : action === "EXPECT"
                          ? formatActual(state.actual)
                          : state.status === "pass"
                            ? "done"
                            : "—"}
                    </code>
                  </div>
                  <span className="test-case-status">
                    {state.status === "idle"
                      ? "○"
                      : state.status === "running"
                        ? "▶"
                        : state.status === "pass"
                          ? "✓"
                          : "✗"}
                  </span>
                </div>
              );
            })}
          </div>

          {testResult && !testResult.passed ? (
            <div className="validation-errors">
              {testResult.tests
                .filter((test) => !test.passed && test.type !== "truthTable")
                .map((test, index) => (
                  <p key={index}>✗ {test.message}</p>
                ))}
            </div>
          ) : null}
        </section>

        <section className="bottom-panel">
          <div>
            <strong>Wiring</strong>
            <p className="muted">
              핀 하나를 클릭한 뒤 연결할 다른 핀을 클릭하세요. 선을 클릭하면 선택되고,
              Delete/Backspace로 제거할 수 있습니다.
            </p>
            {pendingPin ? (
              <p>Selected pin: <code>{endpointKey(pendingPin)}</code></p>
            ) : null}
          </div>
          <div>
            <strong>Selection</strong>
            <p className="muted">
              클릭으로 선택, Shift+클릭으로 다중 선택합니다. Ctrl/Cmd+C/V로
              복사/붙여넣기하고 Delete/Backspace로 일괄 삭제할 수 있습니다.
            </p>
            <button
              className="danger"
              disabled={
                (selectedInstances.length === 0 && !selectedInstance) ||
                testRunning
              }
              onClick={removeSelectedInstance}
            >
              Delete selected component{selectedInstances.length > 1 ? "s" : ""}
            </button>
          </div>
        </section>
      </main>

      <aside className="sidebar right-panel">
        <h2>Inspector</h2>
        <dl>
          <dt>Challenge</dt>
          <dd>{challenge.id}</dd>
          <dt>Circuit</dt>
          <dd>{displayCircuit?.id ?? circuit.id}</dd>
          <dt>Mode</dt>
          <dd>{isInspectingNested ? "Inspect nested component" : "Edit root"}</dd>
          <dt>Components</dt>
          <dd>{displayCircuit?.instances.length ?? circuit.instances.length}</dd>
          <dt>Wires</dt>
          <dd>{displayCircuit?.connections.length ?? circuit.connections.length}</dd>
          <dt>Published as</dt>
          <dd>
            {project.published[publishedId(challenge.id)]
              ? publishedId(challenge.id)
              : "—"}
          </dd>
        </dl>

        <h2>Selected signal</h2>
        {selectedConnection ? (() => {
          const connection = displayCircuit?.connections.find(
            (candidate) => candidate.id === selectedConnection,
          );
          if (!connection || !displayCircuit) return null;
          const vertex = signalVertex(connection.from, inspection.prefix);
          const value = preview.signals[vertex] ?? "X";
          const width = endpointWidth(
            connection.from,
            challenge,
            displayCircuit,
            registry,
          );
          return (
            <div className="selected-signal-card">
              <dl>
                <dt>Wire</dt>
                <dd>{selectedConnection}</dd>
                <dt>Width</dt>
                <dd>{width} bit{width === 1 ? "" : "s"}</dd>
                <dt>Binary</dt>
                <dd className={value.includes("X") ? "unknown-value" : ""}>
                  <code>{value}</code>
                </dd>
                <dt>Hex</dt>
                <dd><code>{signalHex(value)}</code></dd>
              </dl>
              <div className="signal-actions">
                <button onClick={addProbe}>Add probe</button>
                <button
                  className="danger"
                  disabled={isInspectingNested}
                  onClick={() => removeConnection(selectedConnection)}
                >
                  Delete wire
                </button>
              </div>
            </div>
          );
        })() : (
          <p className="muted">Click a wire to inspect it.</p>
        )}

        <h2>Selected component</h2>
        {selectedInstance ? (() => {
          const instance = displayCircuit?.instances.find(
            (candidate) => candidate.id === selectedInstance,
          );
          if (!instance) {
            return <p className="muted">Selected component is unavailable.</p>;
          }

          const spec = registry.get(instance.componentId);
          return (
            <div className="selected-component-card component-inspector-card">
              <div className="component-inspector-header">
                <div>
                  <strong>{componentDisplayName(spec)}</strong>
                  <code>{selectedInstance}</code>
                </div>
                <button
                  className="danger"
                  disabled={testRunning || isInspectingNested}
                  onClick={removeSelectedInstance}
                >
                  Delete
                </button>
              </div>
              <div className="component-pin-inspector">
                {componentPins(spec).map((pin) => {
                  const endpoint: CircuitEndpoint = {
                    kind: "instance",
                    instanceId: instance.id,
                    pinId: pin.id,
                  };
                  const value =
                    preview.signals[
                      signalVertex(endpoint, inspection.prefix)
                    ] ?? "X";

                  return (
                    <div key={pin.id}>
                      <span>
                        {pin.name}
                        <small>
                          {pin.direction} · {pin.width}b
                        </small>
                      </span>
                      <code className={value.includes("X") ? "unknown-value" : ""}>
                        {value}
                      </code>
                      <code>{signalHex(value)}</code>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })() : (
          <p className="muted">Click a component to select it.</p>
        )}

        <h2>Probes</h2>
        <div className="probe-list">
          {(project.probes[challenge.id] ?? []).length === 0 ? (
            <p className="muted">Select a wire and add a probe.</p>
          ) : (
            (project.probes[challenge.id] ?? []).map((probe) => {
              const value = preview.signals[probe.vertex] ?? "X";
              return (
                <div key={probe.id} className="probe-card">
                  <button
                    className="probe-name"
                    title="Rename probe"
                    onClick={() => renameProbe(probe.id)}
                  >
                    {probe.name}
                  </button>
                  <code className={value.includes("X") ? "unknown-value" : ""}>
                    {value}
                  </code>
                  <small>{signalHex(value)}</small>
                  <button
                    className="probe-remove"
                    title="Remove probe"
                    onClick={() => removeProbe(probe.id)}
                  >
                    ×
                  </button>
                </div>
              );
            })
          )}
        </div>

        <h2>Live signals</h2>
        <div className="signal-list">
          {Object.entries(preview.signals)
            .slice(0, 30)
            .map(([path, value]) => (
              <div key={path}>
                <code>{path}</code>
                <strong>{value}</strong>
              </div>
            ))}
        </div>
      </aside>
    </div>
  );
}
