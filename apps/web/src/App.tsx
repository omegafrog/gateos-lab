import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
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
import { JourneyView, StageCompletionReveal } from "./Journey.js";

const STORAGE_KEY = "gateos-lab:v0.1";
const VIEW_KEY = "gateos-lab:view";
const STAGE_REVEAL_KEY = "gateos-lab:stage-reveals";
const PROJECT_SCHEMA = "gateos.project/v1";
const CANVAS_WIDTH = 920;
const CANVAS_HEIGHT = 560;
const WIRE_DRAG_THRESHOLD_PX = 5;

interface CurriculumManifest {
  schema: "gateos.curriculum/v1";
  id: string;
  title: string;
  challenges: readonly { id: string; file: string }[];
}

interface ChallengeLearningContent {
  motivation: string;
  mentalModel: string;
  howItWorks: readonly string[];
  applications: readonly string[];
  commonMistakes: readonly string[];
  buildsToward: string;
}

interface StageLearningContent {
  why: string;
  outcomes: readonly string[];
  connectsTo: string;
}

interface CurriculumLearning {
  schema: "gateos.learning/v1";
  stages: Readonly<Record<string, StageLearningContent>>;
  challenges: Readonly<Record<string, ChallengeLearningContent>>;
}

interface ProjectState {
  schema: typeof PROJECT_SCHEMA;
  circuits: Record<string, CircuitDefinition>;
  published: Record<string, CircuitDefinition>;
  completed: string[];
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

interface InterfaceDragState {
  pinId: string;
  offsetX: number;
  offsetY: number;
}

interface WireEndpointMoveState {
  connectionId: string;
  end: "from" | "to";
}

interface WireNodeMoveState {
  connectionId: string;
  nodeIndex: number;
}

interface WireGestureCandidate {
  mode: "branch" | "move-node";
  connectionId: string;
  existingNodeIndex: number | undefined;
  pointerId: number;
  clientX: number;
  clientY: number;
}

interface CanvasContextMenu {
  kind: "component" | "wire";
  targetId: string;
  x: number;
  y: number;
  label: string;
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

interface VisualSequenceCheck extends VisualSequenceStep {
  setupSteps: readonly VisualSequenceStep[];
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
  };
}

function normalizeCircuitToGrid(
  circuit: CircuitDefinition,
): CircuitDefinition {
  const layout = circuit.layout ?? {};
  const rawInterfacePositions = layout.interfacePositions;
  let nextLayout = layout;

  if (
    rawInterfacePositions &&
    typeof rawInterfacePositions === "object"
  ) {
    const normalizedPositions: Record<string, unknown> = {};
    for (const [pinId, value] of Object.entries(
      rawInterfacePositions as Record<string, unknown>,
    )) {
      if (value && typeof value === "object") {
        const x = (value as Record<string, unknown>).x;
        const y = (value as Record<string, unknown>).y;
        if (typeof x === "number" && typeof y === "number") {
          normalizedPositions[pinId] = snapPoint({ x, y });
          continue;
        }
      }
      normalizedPositions[pinId] = value;
    }

    nextLayout = {
      ...layout,
      interfacePositions: normalizedPositions,
    };
  }

  return {
    ...circuit,
    instances: circuit.instances.map((instance) =>
      instance.position
        ? {
            ...instance,
            position: snapPoint(instance.position),
          }
        : instance,
    ),
    connections: circuit.connections.map((connection) => ({
      ...connection,
      ...(connection.route
        ? {
            route: connection.route.map((point) => snapPoint(point)),
          }
        : {}),
      ...(connection.branchStart
        ? { branchStart: snapPoint(connection.branchStart) }
        : {}),
    })),
    layout: nextLayout,
  };
}

function normalizeProjectGrid(project: ProjectState): ProjectState {
  return {
    ...project,
    circuits: Object.fromEntries(
      Object.entries(project.circuits).map(([id, circuit]) => [
        id,
        normalizeCircuitToGrid(circuit),
      ]),
    ),
    published: Object.fromEntries(
      Object.entries(project.published).map(([id, circuit]) => [
        id,
        normalizeCircuitToGrid(circuit),
      ]),
    ),
  };
}

function loadProject(): ProjectLoadResult {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { project: emptyProject() };

  try {
    return {
      project: normalizeProjectGrid(
        normalizeProject(JSON.parse(raw)),
      ),
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
  return instance?.position
    ? snapPoint(instance.position)
    : { x: 360, y: 216 };
}

const PLACEMENT_GRID = 12;
const COMPACT_COMPONENT_WIDTH = PLACEMENT_GRID * 8;
const TERMINAL_BODY_WIDTH = PLACEMENT_GRID * 8;
const TERMINAL_PORT_GAP = PLACEMENT_GRID;

function snapCoordinate(value: number): number {
  return Math.round(value / PLACEMENT_GRID) * PLACEMENT_GRID;
}

function snapPoint(point: Point): Point {
  return {
    x: snapCoordinate(point.x),
    y: snapCoordinate(point.y),
  };
}

function componentGeometry(spec: ComponentSpec): {
  width: number;
  height: number;
  inputPins: ReturnType<typeof componentPins>;
  outputPins: ReturnType<typeof componentPins>;
} {
  const pins = componentPins(spec);
  const inputPins = pins.filter(
    (pin) => pin.direction === "input" || pin.direction === "inout",
  );
  const outputPins = pins.filter(
    (pin) => pin.direction === "output" || pin.direction === "inout",
  );
  const rows = Math.max(inputPins.length, outputPins.length, 1);

  return {
    width: COMPACT_COMPONENT_WIDTH,
    height: (rows + 1) * PLACEMENT_GRID * 2,
    inputPins,
    outputPins,
  };
}

function compactComponentLabel(spec: ComponentSpec): string {
  const id = spec.id.toLowerCase();
  if (id.includes("split4")) return "SPLIT";
  if (id.includes("join4")) return "JOIN";
  if (id === "builtin.const1.zero") return "0";
  if (id === "builtin.const1.one") return "1";
  if (id === "builtin.const4.zero") return "0000";
  if (id === "builtin.const4.one") return "0001";
  if (id.includes("program-counter4")) return "PC4";
  if (id.includes("counter4")) return "CTR4";
  if (id.includes("register4")) return "REG4";
  if (id.includes("incrementer4")) return "INC4";
  if (id.includes("adder4")) return "ADD4";
  if (id.includes("mux4")) return "MUX4";
  if (id.includes("half-adder")) return "HA";
  if (id.includes("full-adder")) return "FA";
  if (id.includes("sr-latch")) return "SR";
  if (id.includes("d-latch")) return "DL";
  if (id.includes("dff")) return "DFF";
  if (id.includes("register")) return "REG";
  if (id.includes("mux")) return "MUX";
  if (id.includes("xor")) return "XOR";
  if (id.includes("and")) return "AND";
  if (id.includes("or")) return "OR";
  if (id.includes("not")) return "NOT";
  if (id.includes("nand")) return "NAND";

  const letters = spec.name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  return letters.slice(0, 4) || spec.name.slice(0, 4).toUpperCase();
}

function compactSymbolKind(spec: ComponentSpec):
  | "nand"
  | "not"
  | "and"
  | "or"
  | "xor"
  | "mux"
  | "generic" {
  const id = spec.id.toLowerCase();
  if (id === "builtin.nand" || id.endsWith(".nand")) return "nand";
  if (id.includes("not")) return "not";
  if (id.includes("xor")) return "xor";
  if (id.endsWith(".or") || id.includes("user.or")) return "or";
  if (id.endsWith(".and") || id.includes("user.and")) return "and";
  if (id.includes("mux")) return "mux";
  return "generic";
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

  const position = instance.position
    ? snapPoint(instance.position)
    : { x: 360, y: 216 };
  const geometry = componentGeometry(spec);

  if (pin.direction === "output") {
    const index = geometry.outputPins.findIndex(
      (candidate) => candidate.id === pin.id,
    );
    const step = geometry.height / (geometry.outputPins.length + 1);
    return {
      x: snapCoordinate(position.x + geometry.width),
      y: snapCoordinate(
        position.y + step * (Math.max(index, 0) + 1),
      ),
    };
  }

  const index = geometry.inputPins.findIndex(
    (candidate) => candidate.id === pin.id,
  );
  const step = geometry.height / (geometry.inputPins.length + 1);
  return {
    x: snapCoordinate(position.x),
    y: snapCoordinate(
      position.y + step * (Math.max(index, 0) + 1),
    ),
  };
}

function storedInterfacePosition(
  circuit: CircuitDefinition,
  pinId: string,
): Point | null {
  const raw = circuit.layout?.interfacePositions;
  if (!raw || typeof raw !== "object") return null;

  const position = (raw as Record<string, unknown>)[pinId];
  if (!position || typeof position !== "object") return null;

  const x = (position as Record<string, unknown>).x;
  const y = (position as Record<string, unknown>).y;
  return typeof x === "number" && typeof y === "number"
    ? snapPoint({ x, y })
    : null;
}

function interfacePinPoint(
  circuit: CircuitDefinition,
  pinId: string,
): Point {
  const stored = storedInterfacePosition(circuit, pinId);
  if (stored) return stored;

  const inputPins = circuit.pins.filter(
    (pin) => pin.direction === "input" || pin.direction === "inout",
  );
  const outputPins = circuit.pins.filter(
    (pin) => pin.direction === "output" || pin.direction === "inout",
  );

  const inputIndex = inputPins.findIndex((pin) => pin.id === pinId);
  if (inputIndex >= 0) {
    return snapPoint({
      x: 144,
      y: 120 + inputIndex * PLACEMENT_GRID * 8,
    });
  }

  const outputIndex = outputPins.findIndex((pin) => pin.id === pinId);
  return snapPoint({
    x: CANVAS_WIDTH - 132,
    y: 120 + Math.max(outputIndex, 0) * PLACEMENT_GRID * 8,
  });
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

function isSingleCellDiagonal(start: Point, end: Point): boolean {
  return (
    Math.abs(end.x - start.x) === PLACEMENT_GRID &&
    Math.abs(end.y - start.y) === PLACEMENT_GRID
  );
}

function constrainedSegmentPoints(start: Point, end: Point): readonly Point[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (
    dx === 0 ||
    dy === 0 ||
    isSingleCellDiagonal(start, end)
  ) {
    return [end];
  }

  const xSteps = Math.abs(dx) / PLACEMENT_GRID;
  const ySteps = Math.abs(dy) / PLACEMENT_GRID;

  // Long diagonal runs are not allowed. Route on the hidden grid and only
  // preserve a diagonal when it crosses exactly one hidden cell.
  if (xSteps >= 2) {
    const midX =
      start.x +
      Math.sign(dx) *
        Math.max(1, Math.floor(xSteps / 2)) *
        PLACEMENT_GRID;
    return [
      { x: midX, y: start.y },
      { x: midX, y: end.y },
      end,
    ];
  }

  if (ySteps >= 2) {
    const midY =
      start.y +
      Math.sign(dy) *
        Math.max(1, Math.floor(ySteps / 2)) *
        PLACEMENT_GRID;
    return [
      { x: start.x, y: midY },
      { x: end.x, y: midY },
      end,
    ];
  }

  return [end];
}

function constrainedWirePoints(points: readonly Point[]): readonly Point[] {
  const first = points[0];
  if (!first) return [];

  const result: Point[] = [first];
  for (const end of points.slice(1)) {
    const start = result[result.length - 1]!;
    for (const point of constrainedSegmentPoints(start, end)) {
      const previous = result[result.length - 1];
      if (!previous || previous.x !== point.x || previous.y !== point.y) {
        result.push(point);
      }
    }
  }
  return result;
}

function wirePath(points: readonly Point[]): string {
  const routed = constrainedWirePoints(points);
  const first = routed[0];
  if (!first) return "";
  return [
    `M ${first.x} ${first.y}`,
    ...routed.slice(1).map((point) => `L ${point.x} ${point.y}`),
  ].join(" ");
}

function routedWirePath(
  from: Point,
  route: readonly Point[] | undefined,
  to: Point,
): string {
  return wirePath([from, ...(route ?? []), to]);
}

function pointToSegmentDistanceSquared(
  point: Point,
  start: Point,
  end: Point,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    const px = point.x - start.x;
    const py = point.y - start.y;
    return px * px + py * py;
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        (dx * dx + dy * dy),
    ),
  );
  const nearestX = start.x + t * dx;
  const nearestY = start.y + t * dy;
  const px = point.x - nearestX;
  const py = point.y - nearestY;
  return px * px + py * py;
}

function routeInsertionIndex(
  from: Point,
  route: readonly Point[],
  to: Point,
  point: Point,
): number {
  const points = [from, ...route, to];
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) continue;

    const rendered = [start, ...constrainedSegmentPoints(start, end)];
    for (
      let segmentIndex = 0;
      segmentIndex < rendered.length - 1;
      segmentIndex += 1
    ) {
      const segmentStart = rendered[segmentIndex];
      const segmentEnd = rendered[segmentIndex + 1];
      if (!segmentStart || !segmentEnd) continue;

      const distance = pointToSegmentDistanceSquared(
        point,
        segmentStart,
        segmentEnd,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
  }

  return bestIndex;
}

function endpointRole(
  endpoint: CircuitEndpoint,
  circuit: CircuitDefinition,
  registry: ComponentRegistry,
): "source" | "destination" | "inout" {
  if (endpoint.kind === "interface") {
    const pin = circuit.pins.find((candidate) => candidate.id === endpoint.pinId);
    if (!pin || pin.direction === "inout") return "inout";
    return pin.direction === "input" ? "source" : "destination";
  }

  const instance = circuit.instances.find(
    (candidate) => candidate.id === endpoint.instanceId,
  );
  if (!instance) return "inout";

  try {
    const pin = componentPins(registry.get(instance.componentId)).find(
      (candidate) => candidate.id === endpoint.pinId,
    );
    if (!pin || pin.direction === "inout") return "inout";
    return pin.direction === "output" ? "source" : "destination";
  } catch {
    return "inout";
  }
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

function signalValueClass(
  value: string,
): "value-zero" | "value-one" | "value-x" | "value-z" {
  if (value.includes("X")) return "value-x";
  if (value.includes("Z")) return "value-z";
  if (/^0+$/.test(value)) return "value-zero";
  if (/^[01]+$/.test(value)) return "value-one";
  return "value-x";
}

function componentDisplayName(spec: ComponentSpec): string {
  return spec.name || spec.id;
}

function componentShowsStoredValue(spec: ComponentSpec): boolean {
  const id = spec.id.toLowerCase();
  return (
    id.includes("register") ||
    id.includes("counter") ||
    id.includes("dff") ||
    id.includes("latch")
  );
}

interface CurriculumStage {
  id: string;
  title: string;
  description: string;
  startIndex: number;
  endIndex: number;
}

const CURRICULUM_STAGES: readonly CurriculumStage[] = [
  {
    id: "logic",
    title: "Logic Foundations",
    description: "NAND에서 시작해 기본 gate와 Adder까지 만듭니다.",
    startIndex: 0,
    endIndex: 6,
  },
  {
    id: "state",
    title: "State & Sequential",
    description: "Latch, Flip-Flop, Register로 상태 저장을 배웁니다.",
    startIndex: 7,
    endIndex: 10,
  },
  {
    id: "multibit",
    title: "Multi-bit Building Blocks",
    description: "4-bit 연산과 Counter, Program Counter를 구성합니다.",
    startIndex: 11,
    endIndex: 16,
  },
  {
    id: "memory",
    title: "Memory",
    description: "Address Decoder와 RAM 계층을 직접 만듭니다.",
    startIndex: 17,
    endIndex: 20,
  },
  {
    id: "cpu",
    title: "CPU Datapath",
    description: "ALU, Register File, write-back datapath를 연결합니다.",
    startIndex: 21,
    endIndex: 28,
  },
];

function curriculumStageForIndex(index: number): number {
  const stageIndex = CURRICULUM_STAGES.findIndex(
    (stage) => index >= stage.startIndex && index <= stage.endIndex,
  );
  return stageIndex >= 0 ? stageIndex : 0;
}

export function App() {
  const initialProject = useMemo(() => loadProject(), []);
  const [manifest, setManifest] = useState<CurriculumManifest | null>(null);
  const [learning, setLearning] = useState<CurriculumLearning | null>(null);
  const [challenges, setChallenges] = useState<ChallengeDefinition[]>([]);
  const [appMode, setAppMode] = useState<"journey" | "lab">(() =>
    localStorage.getItem(VIEW_KEY) === "lab" ? "lab" : "journey",
  );
  const [stageCelebration, setStageCelebration] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [activeStageIndex, setActiveStageIndex] = useState(0);
  const [curriculumOpen, setCurriculumOpen] = useState(false);
  const [project, setProject] = useState<ProjectState>(initialProject.project);
  const [projectError, setProjectError] = useState(initialProject.error ?? "");
  const [pendingPin, setPendingPin] = useState<CircuitEndpoint | null>(null);
  const [wirePointer, setWirePointer] = useState<Point | null>(null);
  const [wireRoutePoints, setWireRoutePoints] = useState<Point[]>([]);
  const [wireDragging, setWireDragging] = useState(false);
  const [wireDraftStart, setWireDraftStart] = useState<Point | null>(null);
  const [pendingBranchStart, setPendingBranchStart] =
    useState<Point | null>(null);
  const [wireEndpointMove, setWireEndpointMove] =
    useState<WireEndpointMoveState | null>(null);
  const [wireHoverTarget, setWireHoverTarget] =
    useState<CircuitEndpoint | null>(null);
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [selectedInstances, setSelectedInstances] = useState<string[]>([]);
  const [selectedConnection, setSelectedConnection] = useState<string | null>(null);
  const [canvasContextMenu, setCanvasContextMenu] =
    useState<CanvasContextMenu | null>(null);
  const [inspectionPath, setInspectionPath] = useState<string[]>([]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [interfaceDrag, setInterfaceDrag] =
    useState<InterfaceDragState | null>(null);
  const [pan, setPan] = useState<PanState | null>(null);
  const [viewport, setViewport] = useState<Viewport>({
    x: 0,
    y: 0,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
  });
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [draftInputValues, setDraftInputValues] = useState<Record<string, string>>({});
  const [simulationRevision, setSimulationRevision] = useState(0);
  const [traceRevision, setTraceRevision] = useState(0);
  const [testResult, setTestResult] = useState<ChallengeRunResult | null>(null);
  const [testStates, setTestStates] = useState<Record<string, VisualTestState>>({});
  const [activeTestId, setActiveTestId] = useState<string | null>(null);
  const [expandedVerificationChecks, setExpandedVerificationChecks] =
    useState<Set<string>>(() => new Set());
  const [testRunning, setTestRunning] = useState(false);
  const [revealedHintCount, setRevealedHintCount] = useState(0);
  const [loadError, setLoadError] = useState<string>("");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const clipboardRef = useRef<ClipboardCircuit | null>(null);
  const undoRef = useRef<Record<string, CircuitDefinition[]>>({});
  const redoRef = useRef<Record<string, CircuitDefinition[]>>({});
  const dragGestureRef = useRef<DragState | null>(null);
  const interfaceDragGestureRef = useRef<InterfaceDragState | null>(null);
  const panGestureRef = useRef<PanState | null>(null);
  const pendingWireRef = useRef<CircuitEndpoint | null>(null);
  const wireDraggingRef = useRef(false);
  const wireRoutePointsRef = useRef<Point[]>([]);
  const wireDraftStartRef = useRef<Point | null>(null);
  const pendingBranchStartRef = useRef<Point | null>(null);
  const wireEndpointMoveRef = useRef<WireEndpointMoveState | null>(null);
  const wireNodeMoveRef = useRef<WireNodeMoveState | null>(null);
  const wireGestureCandidateRef = useRef<WireGestureCandidate | null>(null);
  const altPressedRef = useRef(false);

  useEffect(() => {
    async function loadCurriculum() {
      try {
        const manifestResponse = await fetch("/core/manifest.json");
        if (!manifestResponse.ok) {
          throw new Error(`Failed to load curriculum manifest: ${manifestResponse.status}`);
        }
        const loadedManifest =
          (await manifestResponse.json()) as CurriculumManifest;

        const learningResponse = await fetch("/core/learning.json");
        if (!learningResponse.ok) {
          throw new Error(
            `Failed to load curriculum learning content: ${learningResponse.status}`,
          );
        }
        const loadedLearning =
          (await learningResponse.json()) as CurriculumLearning;

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
        setLearning(loadedLearning);
        setChallenges(loadedChallenges);

        const completed = new Set(initialProject.project.completed);
        let nextIndex = loadedChallenges.findIndex((item, index) => {
          if (completed.has(item.id)) return false;
          return index === 0 || completed.has(loadedChallenges[index - 1]?.id ?? "");
        });
        if (nextIndex < 0) {
          nextIndex = Math.max(loadedChallenges.length - 1, 0);
        }

        setActiveStageIndex(curriculumStageForIndex(nextIndex));
        setSelectedId((current) => current || loadedChallenges[nextIndex]?.id || "");
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
      }
    }

    void loadCurriculum();
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  }, [project]);

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, appMode);
  }, [appMode]);

  useEffect(() => {
    pendingWireRef.current = pendingPin;
  }, [pendingPin]);

  useEffect(() => {
    wireDraggingRef.current = wireDragging;
  }, [wireDragging]);

  useEffect(() => {
    wireRoutePointsRef.current = wireRoutePoints;
  }, [wireRoutePoints]);

  useEffect(() => {
    wireDraftStartRef.current = wireDraftStart;
  }, [wireDraftStart]);

  useEffect(() => {
    pendingBranchStartRef.current = pendingBranchStart;
  }, [pendingBranchStart]);

  useEffect(() => {
    wireEndpointMoveRef.current = wireEndpointMove;
  }, [wireEndpointMove]);

  const challenge = challenges.find((candidate) => candidate.id === selectedId);
  const usesStagedInputs = (challenge?.referenceTables?.length ?? 0) > 0;

  useEffect(() => {
    if (!challenge) return;
    const index = challenges.findIndex((item) => item.id === challenge.id);
    if (index >= 0) {
      setActiveStageIndex(curriculumStageForIndex(index));
    }
  }, [challenge?.id, challenges]);

  useEffect(() => {
    if (!challenge) return;
    const values: Record<string, string> = {};
    for (const pin of challenge.interface.inputs) {
      const initial = challenge.initialInputs?.[pin.id];
      values[pin.id] =
        initial === undefined
          ? zeroBits(pin.width)
          : literalToVector(initial, pin.width).toBinary();
    }
    setInputValues(values);
    setDraftInputValues(values);
    setPendingPin(null);
    setWirePointer(null);
    setWireRoutePoints([]);
    setWireDragging(false);
    setWireDraftStart(null);
    setPendingBranchStart(null);
    setWireEndpointMove(null);
    setWireHoverTarget(null);
    setSelectedInstance(null);
    setSelectedInstances([]);
    setSelectedConnection(null);
    setInspectionPath([]);
    setTestResult(null);
    setTestStates({});
    setActiveTestId(null);
    setExpandedVerificationChecks(new Set());
    setTestRunning(false);
    setRevealedHintCount(0);
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
    for (const pin of challenge.interface.outputs) {
      const netId = simulationRuntime.netlist.rootOutputs[pin.id];
      if (netId) traceRuntime.watch(netId);
    }
    setTraceRevision((current) => current + 1);
  }, [
    traceRuntime,
    challenge,
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

  const visualSequenceChecks = useMemo<VisualSequenceCheck[]>(() => {
    const setupByValidator = new Map<number, VisualSequenceStep[]>();
    const checks: VisualSequenceCheck[] = [];

    for (const item of visualSequenceSteps) {
      const setup = setupByValidator.get(item.validatorIndex) ?? [];
      if ("expect" in item.step) {
        checks.push({
          ...item,
          setupSteps: [...setup],
        });
        setupByValidator.set(item.validatorIndex, []);
      } else {
        setup.push(item);
        setupByValidator.set(item.validatorIndex, setup);
      }
    }

    return checks;
  }, [visualSequenceSteps]);

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
    setDraftInputValues((current) => ({
      ...current,
      ...next,
    }));
  }

  function applyDraftInputs(): void {
    if (!challenge || !usesStagedInputs || testRunning) return;

    const next: Record<string, string> = {};
    for (const pin of challenge.interface.inputs) {
      next[pin.id] =
        draftInputValues[pin.id] ??
        inputValues[pin.id] ??
        zeroBits(pin.width);
    }

    setInputValues(next);
  }

  function editRootInput(pinId: string, width: number): void {
    if (testRunning || isInspectingNested) return;

    const applied = inputValues[pinId] ?? zeroBits(width);
    const current = usesStagedInputs
      ? draftInputValues[pinId] ?? applied
      : applied;

    if (width === 1) {
      const next = current === "1" ? "0" : "1";
      const setter = usesStagedInputs
        ? setDraftInputValues
        : setInputValues;
      setter((values) => ({ ...values, [pinId]: next }));
      return;
    }

    const entered = window.prompt(
      `${pinId} 값을 입력하세요 (binary, decimal 또는 0x hex)`,
      current,
    );
    if (entered === null) return;

    const raw = entered.trim();
    try {
      let value: bigint;
      if (/^[01]+$/.test(raw)) {
        value = BigInt(`0b${raw}`);
      } else if (/^0x[0-9a-f]+$/i.test(raw)) {
        value = BigInt(raw);
      } else if (/^\d+$/.test(raw)) {
        value = BigInt(raw);
      } else {
        throw new Error("지원하지 않는 입력 형식입니다.");
      }

      const limit = 1n << BigInt(width);
      if (value < 0n || value >= limit) {
        throw new Error(`0 ~ ${limit - 1n} 범위의 값을 입력하세요.`);
      }

      const next = BitVector.fromBigInt(value, width).toBinary();
      const setter = usesStagedInputs
        ? setDraftInputValues
        : setInputValues;
      setter((values) => ({ ...values, [pinId]: next }));
      setProjectError("");
    } catch (error) {
      setProjectError(
        error instanceof Error ? error.message : String(error),
      );
    }
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
    function handleGlobalWirePointerUp(event: PointerEvent): void {
      const activePendingWire = pendingWireRef.current;
      if (!activePendingWire || !wireDraggingRef.current) return;

      const targetEndpoint = findWireEndpointNear(
        event.clientX,
        event.clientY,
      );

      if (targetEndpoint) {
        finishWireConnection(
          targetEndpoint,
          event.clientX,
          event.clientY,
        );
      } else {
        placeDraftWireNode(event.clientX, event.clientY);
      }
    }

    window.addEventListener(
      "pointerup",
      handleGlobalWirePointerUp,
      true,
    );
    return () =>
      window.removeEventListener(
        "pointerup",
        handleGlobalWirePointerUp,
        true,
      );
  });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Alt") altPressedRef.current = true;

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
        setCanvasContextMenu(null);
        setPendingPin(null);
        setWirePointer(null);
        wireDraftStartRef.current = null;
        pendingBranchStartRef.current = null;
        wireEndpointMoveRef.current = null;
        wireNodeMoveRef.current = null;
        setWireRoutePoints([]);
        setWireDragging(false);
        setWireDraftStart(null);
        setPendingBranchStart(null);
        setWireEndpointMove(null);
        setWireHoverTarget(null);
        setSelectedInstance(null);
        setSelectedInstances([]);
        setSelectedConnection(null);
      }
    }

    function handleKeyUp(event: KeyboardEvent): void {
      if (event.key === "Alt") altPressedRef.current = false;
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [selectedInstance, selectedInstances, selectedConnection, challenge?.id, circuit]);

  if (loadError) {
    return (
      <main className="fatal">
        <h1>GateOS Lab</h1>
        <p>{loadError}</p>
      </main>
    );
  }

  if (!manifest || !learning || !challenge || !circuit) {
    return (
      <main className="fatal">
        <h1>GateOS Lab</h1>
        <p>Loading curriculum…</p>
      </main>
    );
  }

  if (appMode === "journey") {
    return (
      <JourneyView
        completed={project.completed}
        challenges={challenges}
        onEnterLab={() => setAppMode("lab")}
        onOpenChallenge={(challengeId: string) => {
          setSelectedId(challengeId);
          const index = challenges.findIndex((item) => item.id === challengeId);
          if (index >= 0) setActiveStageIndex(curriculumStageForIndex(index));
          setAppMode("lab");
        }}
      />
    );
  }

  const currentIndex = challenges.findIndex((item) => item.id === challenge.id);
  const activeStage =
    CURRICULUM_STAGES[activeStageIndex] ?? CURRICULUM_STAGES[0]!;
  const activeStageLearning = learning.stages[activeStage.id];
  const challengeLearning = learning.challenges[challenge.id];
  const stageChallenges = challenges
    .map((item, index) => ({ item, index }))
    .filter(
      ({ index }) =>
        index >= activeStage.startIndex && index <= activeStage.endIndex,
    );
  const stageCompletedCount = stageChallenges.filter(({ item }) =>
    project.completed.includes(item.id),
  ).length;
  const visualVerificationItems = [
    ...visualTestCases.map((testCase) => testCase.id),
    ...visualSequenceChecks.map((step) => step.id),
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

  function openStage(stageIndex: number): void {
    const stage = CURRICULUM_STAGES[stageIndex];
    if (!stage) return;

    const firstIndex = stage.startIndex;
    if (!isUnlocked(firstIndex)) return;

    const currentInStage =
      currentIndex >= stage.startIndex && currentIndex <= stage.endIndex;
    let targetIndex = currentInStage ? currentIndex : -1;

    if (targetIndex < 0) {
      for (let index = stage.startIndex; index <= stage.endIndex; index += 1) {
        const item = challenges[index];
        if (!item || !isUnlocked(index)) continue;
        targetIndex = index;
        if (!project.completed.includes(item.id)) break;
      }
    }

    if (targetIndex < 0) targetIndex = firstIndex;
    const target = challenges[targetIndex];
    if (!target) return;

    setActiveStageIndex(stageIndex);
    setSelectedId(target.id);
  }

  function captureTrace(label: string): void {
    if (!traceRuntime) return;
    traceRuntime.capture(label);
    setTraceRevision((current) => current + 1);
  }

  function externalClockInput() {
    return challenge?.interface.inputs.find(
      (pin) =>
        pin.width === 1 &&
        (pin.id.toLowerCase() === "clk" ||
          pin.name.trim().toLowerCase() === "clk"),
    );
  }

  function applyStagedInputsToSimulator(
    simulator: Simulator,
    clockPinId?: string,
  ): Record<string, string> {
    const applied: Record<string, string> = {};
    if (!challenge) return applied;

    for (const pin of challenge.interface.inputs) {
      if (pin.id === clockPinId) continue;
      const value =
        draftInputValues[pin.id] ??
        inputValues[pin.id] ??
        zeroBits(pin.width);
      simulator.setInput(pin.id, BitVector.fromBinary(value));
      applied[pin.id] = value;
    }
    simulator.settle();
    return applied;
  }

  function driveExternalClockEdge(
    edge: "rising" | "falling",
  ): boolean {
    const simulator = simulationRuntime.simulator;
    const clockPin = externalClockInput();
    if (!simulator || !clockPin) return false;

    const applied = applyStagedInputsToSimulator(simulator, clockPin.id);
    const before = edge === "rising" ? "0" : "1";
    const after = edge === "rising" ? "1" : "0";

    // An edge button means "produce this edge", not merely "set CLK to this
    // level". Force the opposite level first so repeated clicks still produce
    // a real transition for explicit-clock registers.
    simulator.setInput(clockPin.id, BitVector.fromBinary(before));
    simulator.settle();
    simulator.setInput(clockPin.id, BitVector.fromBinary(after));
    simulator.settle();

    const nextInputs = { ...applied, [clockPin.id]: after };
    setInputValues((current) => ({ ...current, ...nextInputs }));
    setDraftInputValues((current) => ({ ...current, ...nextInputs }));
    return true;
  }

  function driveExternalClockCycle(): boolean {
    const simulator = simulationRuntime.simulator;
    const clockPin = externalClockInput();
    if (!simulator || !clockPin) return false;

    const applied = applyStagedInputsToSimulator(simulator, clockPin.id);

    // One cycle ends low: 0 → 1 samples D/EN, then 1 → 0 closes the cycle.
    simulator.setInput(clockPin.id, BitVector.zeros(1));
    simulator.settle();
    simulator.setInput(clockPin.id, BitVector.ones(1));
    simulator.settle();
    simulator.setInput(clockPin.id, BitVector.zeros(1));
    simulator.settle();

    const nextInputs = { ...applied, [clockPin.id]: "0" };
    setInputValues((current) => ({ ...current, ...nextInputs }));
    setDraftInputValues((current) => ({ ...current, ...nextInputs }));
    return true;
  }

  function stepSimulationEdge(edge: "rising" | "falling"): void {
    if (!simulationRuntime.simulator || testRunning) return;

    try {
      if (!driveExternalClockEdge(edge)) {
        simulationRuntime.simulator.stepEdge(edge);
      }
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
      if (!driveExternalClockCycle()) {
        simulationRuntime.simulator.stepClock();
      }
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
    setDraftInputValues((current) => ({ ...current, ...restoredInputs }));
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
      setDraftInputValues(zeros);
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
        node.primitiveId === "builtin.dff" ||
        node.primitiveId === "builtin.user-dff" ||
        node.primitiveId === "builtin.user-register",
    ) ?? false;

  const traceFrames = traceRuntime?.frames.slice(-16) ?? [];
  const waveformOutputs = challenge.interface.outputs.map((pin) => ({
    id: pin.id,
    name: pin.name,
    width: pin.width,
    netId: simulationRuntime.netlist?.rootOutputs[pin.id],
  }));
  void traceRevision;

  function addComponent(componentId: string): void {
    if (!circuit || isInspectingNested) return;
    const count = circuit.instances.length;
    const id = `u${Date.now().toString(36)}-${count}`;
    const position = snapPoint({
      x: viewport.x + viewport.width * 0.38 + (count % 3) * PLACEMENT_GRID * 4,
      y: viewport.y + viewport.height * 0.32 + (count % 3) * PLACEMENT_GRID * 4,
    });
    updateCircuit((current) => ({
      ...current,
      instances: [
        ...current.instances,
        {
          id,
          componentId,
          position,
        },
      ],
    }));
    setSelectedInstance(id);
    setSelectedInstances([id]);
  }

  function beginWireConnection(
    event: ReactPointerEvent<SVGCircleElement>,
    endpoint: CircuitEndpoint,
  ): void {
    if (!challenge || !circuit || isInspectingNested || testRunning) return;
    event.stopPropagation();
    event.preventDefault();

    pendingWireRef.current = endpoint;
    wireRoutePointsRef.current = [];
    wireDraggingRef.current = true;
    wireDraftStartRef.current = null;
    pendingBranchStartRef.current = null;
    wireEndpointMoveRef.current = null;
    wireNodeMoveRef.current = null;
    setPendingPin(endpoint);
    setWirePointer(
      snapPoint(clientToCanvasPoint(event.clientX, event.clientY)),
    );
    setWireRoutePoints([]);
    setWireDragging(true);
    setWireDraftStart(null);
    setPendingBranchStart(null);
    setWireEndpointMove(null);
    setWireHoverTarget(null);
    setSelectedConnection(null);
    setSelectedInstance(null);
    setSelectedInstances([]);
    setProjectError("");
  }

  function clearPendingWireGesture(): void {
    pendingWireRef.current = null;
    wireRoutePointsRef.current = [];
    wireDraggingRef.current = false;
    wireDraftStartRef.current = null;
    pendingBranchStartRef.current = null;
    wireEndpointMoveRef.current = null;
    wireNodeMoveRef.current = null;
    wireGestureCandidateRef.current = null;
    setPendingPin(null);
    setWirePointer(null);
    setWireRoutePoints([]);
    setWireDragging(false);
    setWireDraftStart(null);
    setPendingBranchStart(null);
    setWireEndpointMove(null);
    setWireHoverTarget(null);
  }

  function findWireEndpointNear(
    clientX: number,
    clientY: number,
  ): CircuitEndpoint | null {
    if (!displayCircuit) return null;

    const point = clientToCanvasPoint(clientX, clientY);
    const candidates: Array<{
      endpoint: CircuitEndpoint;
      point: Point;
    }> = [];

    for (const pin of displayCircuit.pins) {
      const endpoint: CircuitEndpoint = {
        kind: "interface",
        pinId: pin.id,
      };
      candidates.push({
        endpoint,
        point: interfacePinPoint(displayCircuit, pin.id),
      });
    }

    for (const instance of displayCircuit.instances) {
      let spec: ComponentSpec;
      try {
        spec = registry.get(instance.componentId);
      } catch {
        continue;
      }

      for (const pin of componentPins(spec)) {
        const endpoint: CircuitEndpoint = {
          kind: "instance",
          instanceId: instance.id,
          pinId: pin.id,
        };
        candidates.push({
          endpoint,
          point: componentPinPoint(
            displayCircuit,
            registry,
            instance.id,
            pin.id,
          ),
        });
      }
    }

    let nearest: CircuitEndpoint | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    const maxDistanceSquared = 18 * 18;

    for (const candidate of candidates) {
      const dx = candidate.point.x - point.x;
      const dy = candidate.point.y - point.y;
      const distance = dx * dx + dy * dy;
      if (
        distance <= maxDistanceSquared &&
        distance < nearestDistance
      ) {
        nearest = candidate.endpoint;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  function placeDraftWireNode(clientX: number, clientY: number): void {
    const activePendingWire = pendingWireRef.current ?? pendingPin;
    if (
      !activePendingWire ||
      !wireDraggingRef.current ||
      !displayCircuit
    ) {
      return;
    }

    const next = snapPoint(clientToCanvasPoint(clientX, clientY));
    const start =
      wireDraftStartRef.current ??
      getEndpointPoint(activePendingWire, displayCircuit, registry);
    const currentRoute = wireRoutePointsRef.current;
    const previous = currentRoute[currentRoute.length - 1] ?? start;

    if (previous.x !== next.x || previous.y !== next.y) {
      const nextRoute = [...currentRoute, next];
      wireRoutePointsRef.current = nextRoute;
      setWireRoutePoints(nextRoute);
    }

    setWirePointer(next);
    wireDraggingRef.current = false;
    setWireDragging(false);
    setWireHoverTarget(null);
  }

  function finishWireConnection(
    endpoint: CircuitEndpoint,
    clientX?: number,
    clientY?: number,
  ): void {
    if (
      !challenge ||
      !circuit ||
      !(pendingWireRef.current ?? pendingPin) ||
      isInspectingNested
    ) {
      return;
    }

    const activePendingPin = pendingWireRef.current ?? pendingPin;
    if (!activePendingPin) return;

    if (endpointKey(activePendingPin) === endpointKey(endpoint)) {
      if (
        clientX !== undefined &&
        clientY !== undefined &&
        displayCircuit
      ) {
        const start = getEndpointPoint(
          activePendingPin,
          displayCircuit,
          registry,
        );
        const drop = snapPoint(
          clientToCanvasPoint(clientX, clientY),
        );
        if (drop.x !== start.x || drop.y !== start.y) {
          placeDraftWireNode(clientX, clientY);
          return;
        }
      }

      clearPendingWireGesture();
      return;
    }

    const pendingWidth = endpointWidth(
      activePendingPin,
      challenge,
      circuit,
      registry,
    );
    const endpointPinWidth = endpointWidth(
      endpoint,
      challenge,
      circuit,
      registry,
    );

    if (pendingWidth !== endpointPinWidth) {
      setProjectError(
        `${pendingWidth}-bit 핀과 ${endpointPinWidth}-bit 핀은 연결할 수 없습니다.`,
      );
      clearPendingWireGesture();
      return;
    }

    const pendingRole = endpointRole(activePendingPin, circuit, registry);
    const targetRole = endpointRole(endpoint, circuit, registry);

    if (
      pendingRole !== "inout" &&
      targetRole !== "inout" &&
      pendingRole === targetRole
    ) {
      setProjectError(
        pendingRole === "source"
          ? "출력(source)끼리는 연결할 수 없습니다."
          : "입력(destination)끼리는 연결할 수 없습니다.",
      );
      clearPendingWireGesture();
      return;
    }

    const from =
      pendingRole === "destination" && targetRole === "source"
        ? endpoint
        : activePendingPin;
    const to =
      pendingRole === "destination" && targetRole === "source"
        ? activePendingPin
        : endpoint;

    const route =
      pendingRole === "destination" && targetRole === "source"
        ? [...wireRoutePointsRef.current].reverse()
        : [...wireRoutePointsRef.current];

    const movingEndpoint = wireEndpointMoveRef.current;
    const branchStart = pendingBranchStartRef.current;
    const connection: CircuitConnection = {
      id:
        movingEndpoint?.connectionId ??
        `w-${Date.now().toString(36)}-${circuit.connections.length}`,
      from,
      to,
      route,
      ...(branchStart ? { branchStart } : {}),
    };

    updateCircuit((current) => ({
      ...current,
      connections: movingEndpoint
        ? current.connections.map((candidate) =>
            candidate.id === movingEndpoint.connectionId
              ? connection
              : candidate,
          )
        : [...current.connections, connection],
    }));
    clearPendingWireGesture();
    setProjectError("");
  }

  function visualWireStart(
    connection: CircuitConnection,
    currentCircuit: CircuitDefinition,
  ): Point {
    return connection.branchStart
      ? snapPoint(connection.branchStart)
      : getEndpointPoint(connection.from, currentCircuit, registry);
  }

  function recordWireEditHistory(): void {
    if (!challenge || !circuit) return;
    const stack = undoRef.current[challenge.id] ?? [];
    stack.push(circuit);
    if (stack.length > 100) stack.shift();
    undoRef.current[challenge.id] = stack;
    redoRef.current[challenge.id] = [];
  }

  function beginWireDragCandidate(
    event: ReactPointerEvent<SVGPathElement | SVGCircleElement>,
    connectionId: string,
    mode: WireGestureCandidate["mode"],
    existingNodeIndex?: number,
  ): void {
    if (!circuit || !challenge || isInspectingNested || testRunning) return;

    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    clearPendingWireGesture();
    wireGestureCandidateRef.current = {
      mode,
      connectionId,
      existingNodeIndex,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    };

    setSelectedConnection(connectionId);
    setSelectedInstance(null);
    setSelectedInstances([]);
    setProjectError("");
  }

  function beginWireBranch(
    event: ReactPointerEvent<SVGElement>,
    connectionId: string,
    originClientX = event.clientX,
    originClientY = event.clientY,
  ): void {
    if (!circuit || !challenge || isInspectingNested || testRunning) return;
    const connection = circuit.connections.find(
      (candidate) => candidate.id === connectionId,
    );
    if (!connection) return;

    event.stopPropagation();
    event.preventDefault();

    const point = snapPoint(
      clientToCanvasPoint(originClientX, originClientY),
    );
    const from = visualWireStart(connection, circuit);
    const to = getEndpointPoint(connection.to, circuit, registry);
    const route = [...(connection.route ?? [])];

    if (
      ![from, ...route, to].some(
        (candidate) =>
          candidate.x === point.x && candidate.y === point.y,
      )
    ) {
      const insertAt = routeInsertionIndex(from, route, to, point);
      route.splice(insertAt, 0, point);

      updateCircuit((current) => ({
        ...current,
        connections: current.connections.map((candidate) =>
          candidate.id === connectionId
            ? { ...candidate, route }
            : candidate,
        ),
      }));
    }

    pendingWireRef.current = connection.from;
    wireRoutePointsRef.current = [];
    wireDraggingRef.current = true;
    wireDraftStartRef.current = point;
    pendingBranchStartRef.current = point;
    wireEndpointMoveRef.current = null;
    wireNodeMoveRef.current = null;

    setPendingPin(connection.from);
    setWirePointer(point);
    setWireRoutePoints([]);
    setWireDragging(true);
    setWireDraftStart(point);
    setPendingBranchStart(point);
    setWireEndpointMove(null);
    setWireHoverTarget(null);
    setSelectedConnection(connectionId);
    setSelectedInstance(null);
    setSelectedInstances([]);
    setProjectError("");
  }

  function beginMoveWireNode(
    event: ReactPointerEvent<SVGElement>,
    connectionId: string,
    existingNodeIndex?: number,
    originClientX = event.clientX,
    originClientY = event.clientY,
  ): void {
    if (!circuit || !challenge || isInspectingNested || testRunning) return;
    const connection = circuit.connections.find(
      (candidate) => candidate.id === connectionId,
    );
    if (!connection) return;

    event.stopPropagation();
    event.preventDefault();

    const from = visualWireStart(connection, circuit);
    const to = getEndpointPoint(connection.to, circuit, registry);
    const route = [...(connection.route ?? [])];
    const point = snapPoint(
      clientToCanvasPoint(originClientX, originClientY),
    );

    let nodeIndex = existingNodeIndex;
    if (nodeIndex === undefined) {
      nodeIndex = route.findIndex(
        (candidate) =>
          candidate.x === point.x && candidate.y === point.y,
      );

      if (nodeIndex < 0) {
        if (
          (from.x === point.x && from.y === point.y) ||
          (to.x === point.x && to.y === point.y)
        ) {
          return;
        }
        nodeIndex = routeInsertionIndex(from, route, to, point);
        route.splice(nodeIndex, 0, point);
      }
    }

    if (nodeIndex < 0 || nodeIndex >= route.length) return;

    recordWireEditHistory();
    wireNodeMoveRef.current = {
      connectionId,
      nodeIndex,
    };
    pendingWireRef.current = null;
    wireDraggingRef.current = false;
    wireDraftStartRef.current = null;
    pendingBranchStartRef.current = null;
    wireEndpointMoveRef.current = null;

    updateCircuit(
      (current) => ({
        ...current,
        connections: current.connections.map((candidate) =>
          candidate.id === connectionId
            ? { ...candidate, route }
            : candidate,
        ),
      }),
      false,
    );

    setPendingPin(null);
    setWirePointer(null);
    setWireRoutePoints([]);
    setWireDragging(false);
    setWireDraftStart(null);
    setPendingBranchStart(null);
    setWireEndpointMove(null);
    setWireHoverTarget(null);
    setSelectedConnection(connectionId);
    setSelectedInstance(null);
    setSelectedInstances([]);
    setProjectError("");
  }

  function terminalConnectionForEndpoint(
    endpoint: CircuitEndpoint,
  ): { connection: CircuitConnection; end: "from" | "to" } | null {
    if (!circuit) return null;
    const key = endpointKey(endpoint);

    const destination = circuit.connections.find(
      (connection) => endpointKey(connection.to) === key,
    );
    if (destination) {
      return { connection: destination, end: "to" };
    }

    // Source pins remain available for fan-out. Only destination-side
    // leaves behave as movable wire endpoints.
    return null;
  }

  function beginMoveWireEndpoint(
    event: ReactPointerEvent<SVGCircleElement>,
    connection: CircuitConnection,
    end: "from" | "to",
  ): void {
    if (!circuit || !challenge || isInspectingNested || testRunning) return;
    event.stopPropagation();
    event.preventDefault();

    const pendingEndpoint =
      end === "to" ? connection.from : connection.to;
    const route =
      end === "to"
        ? [...(connection.route ?? [])]
        : [...(connection.route ?? [])].reverse();
    const draftStart =
      end === "to"
        ? visualWireStart(connection, circuit)
        : getEndpointPoint(connection.to, circuit, registry);
    const movingPoint =
      end === "to"
        ? getEndpointPoint(connection.to, circuit, registry)
        : getEndpointPoint(connection.from, circuit, registry);
    const moveState: WireEndpointMoveState = {
      connectionId: connection.id,
      end,
    };
    const branchStart =
      end === "to" && connection.branchStart
        ? snapPoint(connection.branchStart)
        : null;

    pendingWireRef.current = pendingEndpoint;
    wireRoutePointsRef.current = route;
    wireDraggingRef.current = true;
    wireDraftStartRef.current = draftStart;
    pendingBranchStartRef.current = branchStart;
    wireEndpointMoveRef.current = moveState;
    wireNodeMoveRef.current = null;

    setPendingPin(pendingEndpoint);
    setWirePointer(movingPoint);
    setWireRoutePoints(route);
    setWireDragging(true);
    setWireDraftStart(draftStart);
    setPendingBranchStart(branchStart);
    setWireEndpointMove(moveState);
    setWireHoverTarget(null);
    setSelectedConnection(connection.id);
    setSelectedInstance(null);
    setSelectedInstances([]);
    setProjectError("");
  }

  function beginPinWireGesture(
    event: ReactPointerEvent<SVGCircleElement>,
    endpoint: CircuitEndpoint,
  ): void {
    const terminal = terminalConnectionForEndpoint(endpoint);
    if (terminal) {
      beginMoveWireEndpoint(
        event,
        terminal.connection,
        terminal.end,
      );
      return;
    }

    beginWireConnection(event, endpoint);
  }

  function removeConnection(id: string): void {
    if (isInspectingNested) return;
    updateCircuit((current) => ({
      ...current,
      connections: current.connections.filter((connection) => connection.id !== id),
    }));
    setSelectedConnection((current) => (current === id ? null : current));
    setCanvasContextMenu(null);
  }

  function removeInstances(ids: ReadonlySet<string>): void {
    if (isInspectingNested || ids.size === 0) return;

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
    setSelectedConnection(null);
    setCanvasContextMenu(null);
  }

  function removeSelectedInstance(): void {
    const ids = new Set(
      selectedInstances.length > 0
        ? selectedInstances
        : selectedInstance
          ? [selectedInstance]
          : [],
    );
    removeInstances(ids);
  }

  function openComponentContextMenu(
    event: ReactMouseEvent<SVGGElement>,
    instanceId: string,
    label: string,
  ): void {
    if (isInspectingNested || testRunning) return;
    event.preventDefault();
    event.stopPropagation();
    clearPendingWireGesture();
    setSelectedConnection(null);
    setSelectedInstance(instanceId);
    setSelectedInstances([instanceId]);
    setCanvasContextMenu({
      kind: "component",
      targetId: instanceId,
      x: event.clientX,
      y: event.clientY,
      label,
    });
  }

  function openWireContextMenu(
    event: ReactMouseEvent<SVGPathElement>,
    connectionId: string,
  ): void {
    if (isInspectingNested || testRunning) return;
    event.preventDefault();
    event.stopPropagation();
    clearPendingWireGesture();
    setSelectedInstance(null);
    setSelectedInstances([]);
    setSelectedConnection(connectionId);
    setCanvasContextMenu({
      kind: "wire",
      targetId: connectionId,
      x: event.clientX,
      y: event.clientY,
      label: "Wire",
    });
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
        position: snapPoint({
          x: position.x + PLACEMENT_GRID * 4,
          y: position.y + PLACEMENT_GRID * 4,
        }),
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

        const route = connection.route?.map((point) => ({
          x: point.x + PLACEMENT_GRID * 4,
          y: point.y + PLACEMENT_GRID * 4,
        }));
        const branchStart = connection.branchStart
          ? {
              x: connection.branchStart.x + PLACEMENT_GRID * 4,
              y: connection.branchStart.y + PLACEMENT_GRID * 4,
            }
          : undefined;

        return {
          ...connection,
          id: `paste-wire-${stamp}-${index}`,
          from: mapEndpoint(connection.from),
          to: mapEndpoint(connection.to),
          ...(route ? { route } : {}),
          ...(branchStart ? { branchStart } : {}),
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
      const imported = normalizeProjectGrid(
        normalizeProject(parsed, true),
      );
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

  function canvasPoint(event: ReactPointerEvent<SVGElement>): Point {
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
    if (testRunning) return;
    if (event.button !== 0 && event.button !== 1) return;
    if (pendingPin && event.button === 0) {
      event.stopPropagation();
      return;
    }
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const nextPan = {
      clientX: event.clientX,
      clientY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
    };
    panGestureRef.current = nextPan;
    setPan(nextPan);
    setSelectedInstance(null);
    setSelectedInstances([]);
    setSelectedConnection(null);
    setPendingPin(null);
  }

  function beginInterfaceDrag(
    event: ReactPointerEvent<SVGElement>,
    pinId: string,
    _direction: "input" | "output",
  ): void {
    if (!circuit || !challenge || testRunning || isInspectingNested) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const stack = undoRef.current[challenge.id] ?? [];
    stack.push(circuit);
    if (stack.length > 100) stack.shift();
    undoRef.current[challenge.id] = stack;
    redoRef.current[challenge.id] = [];

    const position = interfacePinPoint(circuit, pinId);
    const point = clientToCanvasPoint(event.clientX, event.clientY);
    const nextInterfaceDrag = {
      pinId,
      offsetX: point.x - position.x,
      offsetY: point.y - position.y,
    };
    interfaceDragGestureRef.current = nextInterfaceDrag;
    setInterfaceDrag(nextInterfaceDrag);
    setSelectedInstance(null);
    setSelectedInstances([]);
    setSelectedConnection(null);
    pendingWireRef.current = null;
    wireRoutePointsRef.current = [];
    wireDraggingRef.current = false;
    wireDraftStartRef.current = null;
    pendingBranchStartRef.current = null;
    wireEndpointMoveRef.current = null;
    setPendingPin(null);
    setWirePointer(null);
    setWireRoutePoints([]);
    setWireDragging(false);
    setWireDraftStart(null);
    setPendingBranchStart(null);
    setWireEndpointMove(null);
    setWireHoverTarget(null);
  }

  function resumeDraftWire(
    event: ReactPointerEvent<SVGCircleElement>,
  ): void {
    if (!pendingPin || testRunning) return;
    event.stopPropagation();
    event.preventDefault();
    const last =
      wireRoutePoints[wireRoutePoints.length - 1] ??
      wireDraftStartRef.current ??
      (displayCircuit
        ? getEndpointPoint(pendingPin, displayCircuit, registry)
        : null);
    if (!last) return;
    setWirePointer(last);
    wireDraggingRef.current = true;
    setWireDragging(true);
    setWireHoverTarget(null);
  }

  function beginDrag(
    event: ReactPointerEvent<SVGGElement>,
    instanceId: string,
  ): void {
    if (event.button !== 0) return;
    if (!circuit || !challenge || testRunning || isInspectingNested) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

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

    const nextDrag = {
      instanceId,
      offsetX: point.x - position.x,
      offsetY: point.y - position.y,
    };
    dragGestureRef.current = nextDrag;
    setDrag(nextDrag);
    setSelectedInstance(instanceId);
  }

  function moveDrag(event: ReactPointerEvent<SVGElement>): void {
    const activePan = panGestureRef.current ?? pan;
    if (activePan) {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = ((event.clientX - activePan.clientX) / rect.width) * viewport.width;
      const dy = ((event.clientY - activePan.clientY) / rect.height) * viewport.height;
      setViewport((current) => ({
        ...current,
        x: activePan.originX - dx,
        y: activePan.originY - dy,
      }));
      return;
    }

    const wireCandidate = wireGestureCandidateRef.current;
    if (wireCandidate) {
      const dx = event.clientX - wireCandidate.clientX;
      const dy = event.clientY - wireCandidate.clientY;
      if (Math.hypot(dx, dy) < WIRE_DRAG_THRESHOLD_PX) {
        return;
      }

      wireGestureCandidateRef.current = null;
      if (wireCandidate.mode === "branch") {
        beginWireBranch(
          event,
          wireCandidate.connectionId,
          wireCandidate.clientX,
          wireCandidate.clientY,
        );
      } else {
        beginMoveWireNode(
          event,
          wireCandidate.connectionId,
          wireCandidate.existingNodeIndex,
        );
        // Inserting a new joint updates the circuit. Do not immediately run
        // the move branch below against the pre-insertion render snapshot;
        // the next pointermove will move the newly inserted node.
        return;
      }
    }

    const point = canvasPoint(event);

    const activeWireNodeMove = wireNodeMoveRef.current;
    if (activeWireNodeMove) {
      const next = snapPoint(point);
      updateCircuit(
        (current) => ({
          ...current,
          connections: current.connections.map((connection) => {
            if (connection.id !== activeWireNodeMove.connectionId) {
              return connection;
            }
            const route = [...(connection.route ?? [])];
            if (!route[activeWireNodeMove.nodeIndex]) return connection;
            route[activeWireNodeMove.nodeIndex] = next;
            return { ...connection, route };
          }),
        }),
        false,
      );
      return;
    }

    const activePendingWire = pendingWireRef.current ?? pendingPin;
    if (activePendingWire && wireDraggingRef.current) {
      setWirePointer(snapPoint(point));
      return;
    }

    const activeInterfaceDrag =
      interfaceDragGestureRef.current ?? interfaceDrag;
    if (activeInterfaceDrag) {
      const next = snapPoint({
        x: point.x - activeInterfaceDrag.offsetX,
        y: point.y - activeInterfaceDrag.offsetY,
      });

      updateCircuit(
        (current) => {
          const layout = current.layout ?? {};
          const rawPositions = layout.interfacePositions;
          const positions =
            rawPositions && typeof rawPositions === "object"
              ? (rawPositions as Record<string, unknown>)
              : {};

          return {
            ...current,
            layout: {
              ...layout,
              interfacePositions: {
                ...positions,
                [activeInterfaceDrag.pinId]: next,
              },
            },
          };
        },
        false,
      );
      return;
    }

    const activeDrag = dragGestureRef.current ?? drag;
    if (!activeDrag) return;

    updateCircuit(
      (current) => ({
        ...current,
        instances: current.instances.map((instance) => {
          if (instance.id !== activeDrag.instanceId) return instance;
          return {
            ...instance,
            position: snapPoint({
              x: point.x - activeDrag.offsetX,
              y: point.y - activeDrag.offsetY,
            }),
          };
        }),
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
        setDraftInputValues((current) => ({ ...current, ...animatedInputs }));

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
              setDraftInputValues((current) => ({
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

          await sleep("expect" in step ? 320 : 70);
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

    const stageIndex = curriculumStageForIndex(currentIndex);
    const stage = CURRICULUM_STAGES[stageIndex];
    const completesStage =
      stage !== undefined &&
      currentIndex === stage.endIndex &&
      !project.completed.includes(challenge.id);

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

    if (completesStage && stage) {
      let seen: string[] = [];
      try {
        const raw = localStorage.getItem(STAGE_REVEAL_KEY);
        seen = raw ? (JSON.parse(raw) as string[]) : [];
      } catch {
        seen = [];
      }
      if (!seen.includes(stage.id)) {
        localStorage.setItem(
          STAGE_REVEAL_KEY,
          JSON.stringify([...seen, stage.id]),
        );
        setStageCelebration(stage.id);
      }
    }
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
          <button
            className="journey-toggle"
            data-testid="journey-toggle"
            onClick={() => setAppMode("journey")}
          >
            Journey
          </button>
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

      <button
        type="button"
        className={`curriculum-side-tab ${curriculumOpen ? "open" : ""}`}
        data-testid="curriculum-toggle"
        aria-controls="curriculum-drawer"
        aria-expanded={curriculumOpen}
        aria-label="커리큘럼 열기"
        onClick={() => setCurriculumOpen(true)}
      >
        <span>Curriculum</span>
        <strong>{currentIndex + 1}</strong>
      </button>

      <div
        className={`curriculum-backdrop ${curriculumOpen ? "open" : ""}`}
        aria-hidden="true"
        onClick={() => setCurriculumOpen(false)}
      />
      <aside
        id="curriculum-drawer"
        className={`curriculum-drawer ${curriculumOpen ? "open" : ""}`}
        aria-hidden={!curriculumOpen}
      >
        <div className="curriculum-drawer-header">
          <div>
            <span>Learning path</span>
            <h2>Curriculum</h2>
          </div>
          <button
            type="button"
            aria-label="커리큘럼 닫기"
            onClick={() => setCurriculumOpen(false)}
          >
            ×
          </button>
        </div>
        <section className="stage-pager" data-testid="curriculum-stage-pager">
          <div className="stage-pager-top">
            <button
              data-testid="stage-prev"
              aria-label="이전 학습 단계"
              disabled={activeStageIndex === 0}
              onClick={() => openStage(activeStageIndex - 1)}
            >
              ←
            </button>
            <div>
              <span className="stage-number">
                Stage {activeStageIndex + 1} / {CURRICULUM_STAGES.length}
              </span>
              <strong data-testid="stage-title">{activeStage.title}</strong>
            </div>
            <button
              data-testid="stage-next"
              aria-label="다음 학습 단계"
              disabled={
                activeStageIndex >= CURRICULUM_STAGES.length - 1 ||
                !isUnlocked(
                  CURRICULUM_STAGES[activeStageIndex + 1]?.startIndex ??
                    challenges.length,
                )
              }
              onClick={() => openStage(activeStageIndex + 1)}
            >
              →
            </button>
          </div>
          <p>{activeStage.description}</p>
          {activeStageLearning ? (
            <div className="stage-learning-context">
              <div>
                <strong>왜 이 챕터를 배우나요?</strong>
                <p>{activeStageLearning.why}</p>
              </div>
              <div>
                <strong>이 챕터를 끝내면</strong>
                <ul>
                  {activeStageLearning.outcomes.map((outcome) => (
                    <li key={outcome}>{outcome}</li>
                  ))}
                </ul>
              </div>
              <div className="stage-connects">
                <strong>어디로 이어지나요?</strong>
                <p>{activeStageLearning.connectsTo}</p>
              </div>
            </div>
          ) : null}
          <div className="stage-progress">
            <span>
              {stageCompletedCount}/{stageChallenges.length} complete
            </span>
            <div aria-hidden="true">
              <i
                style={{
                  width: `${
                    stageChallenges.length > 0
                      ? (stageCompletedCount / stageChallenges.length) * 100
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
          <div className="stage-dots" aria-label="학습 단계">
            {CURRICULUM_STAGES.map((stage, index) => {
              const unlocked = isUnlocked(stage.startIndex);
              return (
                <button
                  key={stage.id}
                  className={index === activeStageIndex ? "active" : ""}
                  data-testid={`stage-${stage.id}`}
                  disabled={!unlocked}
                  aria-label={`${index + 1}단계 ${stage.title}`}
                  onClick={() => openStage(index)}
                >
                  {index + 1}
                </button>
              );
            })}
          </div>
        </section>

        <nav className="challenge-list" data-testid="stage-challenge-list">
          {stageChallenges.map(({ item, index }) => {
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
                onClick={() => {
                  setSelectedId(item.id);
                  setCurriculumOpen(false);
                }}
              >
                <span>{index + 1}</span>
                <span>{item.title}</span>
                <span>{completed ? "✓" : unlocked ? "" : "🔒"}</span>
              </button>
            );
          })}
        </nav>


      </aside>

      <aside className="sidebar left-panel component-panel">
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
              data-testid="reset-chip-state"
              disabled={testRunning || !simulationRuntime.simulator}
              onClick={resetSimulation}
              title="테스트나 수동 clock 실행으로 바뀐 칩 내부 상태와 입력을 초기화합니다."
            >
              Reset chip values
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

        {challengeLearning ? (
          <section className="learning-panel" data-testid="learning-panel">
            <div className="learning-panel-header">
              <div>
                <span>CONCEPT LESSON</span>
                <strong>이 회로를 왜 만드는가?</strong>
              </div>
              <p>{challengeLearning.motivation}</p>
            </div>

            <div className="learning-mental-model">
              <span>핵심 mental model</span>
              <strong>{challengeLearning.mentalModel}</strong>
            </div>

            <div className="learning-grid">
              <article>
                <h3>동작 원리</h3>
                <ol>
                  {challengeLearning.howItWorks.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              </article>
              <article>
                <h3>어디에 사용하나요?</h3>
                <ul>
                  {challengeLearning.applications.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
              <article>
                <h3>흔한 실수</h3>
                <ul>
                  {challengeLearning.commonMistakes.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            </div>

            <div className="learning-builds-toward">
              <strong>다음 단계와의 연결</strong>
              <p>{challengeLearning.buildsToward}</p>
            </div>
          </section>
        ) : null}

        {(challenge.hints?.length ?? 0) > 0 ? (
          <section className="hint-panel" data-testid="hints-panel">
            <div className="hint-panel-header">
              <div>
                <strong>단계별 힌트</strong>
                <p>
                  막혔을 때만 한 단계씩 확인하세요. 뒤 단계일수록 연결 방법을
                  더 구체적으로 알려줍니다.
                </p>
              </div>
              {revealedHintCount < (challenge.hints?.length ?? 0) ? (
                <button
                  className="hint-reveal-button"
                  data-testid="reveal-hint"
                  onClick={() =>
                    setRevealedHintCount((current) =>
                      Math.min(
                        current + 1,
                        challenge.hints?.length ?? current,
                      ),
                    )
                  }
                >
                  힌트 {revealedHintCount + 1}단계 보기
                </button>
              ) : (
                <span className="hint-complete">3단계까지 확인함</span>
              )}
            </div>

            {revealedHintCount === 0 ? (
              <p className="hint-locked-message">
                아직 힌트를 열지 않았습니다.
              </p>
            ) : (
              <div className="hint-list">
                {(challenge.hints ?? [])
                  .slice(0, revealedHintCount)
                  .map((hint) => (
                    <article
                      key={hint.level}
                      className={`hint-card hint-level-${hint.level}`}
                      data-testid={`hint-level-${hint.level}`}
                    >
                      <div className="hint-card-title">
                        <span>{hint.level}단계</span>
                        <strong>{hint.title}</strong>
                      </div>
                      <p>{hint.body}</p>
                    </article>
                  ))}
              </div>
            )}
          </section>
        ) : null}

        {targetTruthRows.length > 0 ? (
          <section className="truth-table-panel" data-testid="target-truth-table">
            <div className="truth-table-header">
              <div>
                <strong>목표 진리표 (Truth Table)</strong>
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
                    <strong>동작 시점 (Timing):</strong> {table.timing}
                  </p>
                ) : null}
              </div>
              <span>상태표 (State / Characteristic Table)</span>
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

        <section className="canvas-frame">
          <div className="canvas-toolbar">
            <div className="canvas-toolbar-info">
              <span>빈 공간 드래그: 이동 · Wire 드래그: 분기 · Alt+Wire 드래그: 관절 추가/이동 · 12-unit grid snap · 줌: + / −</span>
              {preview.error ? (
                <span className="error-text">{preview.error}</span>
              ) : null}
            </div>
            <div className="canvas-toolbar-actions">
              {usesStagedInputs && !isInspectingNested ? (
                <>
                  <span
                    className="applied-input-summary"
                    data-testid="applied-input-summary"
                  >
                    적용됨:&nbsp;
                    {challenge.interface.inputs
                      .map(
                        (pin) =>
                          `${pin.name}=${inputValues[pin.id] ?? zeroBits(pin.width)}`,
                      )
                      .join("  ")}
                  </span>
                  <button
                    className="apply-inputs"
                    data-testid="apply-inputs"
                    disabled={
                      testRunning ||
                      !challenge.interface.inputs.some(
                        (pin) =>
                          (draftInputValues[pin.id] ??
                            inputValues[pin.id] ??
                            zeroBits(pin.width)) !==
                          (inputValues[pin.id] ?? zeroBits(pin.width)),
                      )
                    }
                    onClick={applyDraftInputs}
                  >
                    입력 적용
                  </button>
                </>
              ) : null}
              {hasSequentialNodes ? (
                <div className="clock-controls">
                  <strong>Clock</strong>
                  <button
                    data-testid="clock-rising"
                    disabled={testRunning}
                    onClick={() => stepSimulationEdge("rising")}
                    title="상승 에지(rising edge) — 현재 입력을 적용한 뒤 CLK 0→1"
                  >
                    ↑
                  </button>
                  <button
                    data-testid="clock-falling"
                    disabled={testRunning}
                    onClick={() => stepSimulationEdge("falling")}
                    title="하강 에지(falling edge) — 현재 입력을 적용한 뒤 CLK 1→0"
                  >
                    ↓
                  </button>
                  <button
                    data-testid="clock-cycle"
                    disabled={testRunning}
                    onClick={stepSimulationClock}
                    title="현재 입력을 적용한 뒤 CLK 0→1→0"
                  >
                    1 cycle
                  </button>
                  <button
                    disabled={testRunning || !(traceRuntime?.canRewind ?? false)}
                    onClick={rewindSimulation}
                  >
                    Rewind
                  </button>
                  <button disabled={testRunning} onClick={resetSimulation}>
                    Reset
                  </button>
                  <span>cycle {simulationRuntime.simulator?.cycle ?? 0}</span>
                </div>
              ) : null}
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
              <button onClick={resetViewport}>화면 맞춤</button>
            </div>
          </div>
          <svg
            ref={svgRef}
            className={testRunning ? "circuit-canvas testing" : "circuit-canvas"}
            viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`}
            onPointerMove={moveDrag}
            onPointerUpCapture={(event) => {
              const activePendingWire =
                pendingWireRef.current ?? pendingPin;
              if (!activePendingWire) return;

              const targetEndpoint = findWireEndpointNear(
                event.clientX,
                event.clientY,
              );

              if (targetEndpoint) {
                finishWireConnection(
                  targetEndpoint,
                  event.clientX,
                  event.clientY,
                );
              } else {
                placeDraftWireNode(event.clientX, event.clientY);
              }

              event.stopPropagation();
            }}
            onPointerUp={(event) => {
              const wireCandidate = wireGestureCandidateRef.current;
              wireGestureCandidateRef.current = null;
              dragGestureRef.current = null;
              interfaceDragGestureRef.current = null;
              panGestureRef.current = null;
              wireNodeMoveRef.current = null;
              setDrag(null);
              setInterfaceDrag(null);
              setPan(null);

              if (wireCandidate) {
                event.stopPropagation();
                return;
              }

              placeDraftWireNode(event.clientX, event.clientY);
            }}
            onPointerLeave={() => {
              wireGestureCandidateRef.current = null;
              dragGestureRef.current = null;
              interfaceDragGestureRef.current = null;
              panGestureRef.current = null;
              wireNodeMoveRef.current = null;
              setDrag(null);
              setInterfaceDrag(null);
              setPan(null);
            }}
            onClick={() => {
              if (drag || interfaceDrag || pan || pendingPin) return;
              setCanvasContextMenu(null);
              setSelectedInstance(null);
              setSelectedInstances([]);
              setSelectedConnection(null);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setCanvasContextMenu(null);
            }}
          >
            <rect
              x={viewport.x - viewport.width * 50}
              y={viewport.y - viewport.height * 50}
              width={viewport.width * 100}
              height={viewport.height * 100}
              fill="transparent"
              pointerEvents="all"
              data-testid="canvas-pan-surface"
              onPointerDown={beginPan}
              onPointerMove={moveDrag}
            />
            {(displayCircuit?.connections ?? []).map((connection) => {
              if (wireEndpointMove?.connectionId === connection.id) {
                return null;
              }

              const from = connection.branchStart
                ? snapPoint(connection.branchStart)
                : getEndpointPoint(
                    connection.from,
                    displayCircuit!,
                    registry,
                  );
              const to = getEndpointPoint(
                connection.to,
                displayCircuit!,
                registry,
              );
              const sourceValue =
                preview.signals[
                  signalVertex(connection.from, inspection.prefix)
                ] ?? "X";
              const wireValueClass = signalValueClass(sourceValue);

              return (
                <g key={connection.id}>
                  <path
                    className={[
                      "wire",
                      wireValueClass,
                      selectedConnection === connection.id ? "selected" : "",
                    ].join(" ")}
                    data-signal-value={sourceValue}
                    d={routedWirePath(
                      from,
                      connection.route as readonly Point[] | undefined,
                      to,
                    )}
                    pointerEvents="none"
                  />
                  <path
                    className="wire-hit-target"
                    data-testid={`wire-hit-${connection.id}`}
                    d={routedWirePath(
                      from,
                      connection.route as readonly Point[] | undefined,
                      to,
                    )}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      beginWireDragCandidate(
                        event,
                        connection.id,
                        event.altKey || altPressedRef.current
                          ? "move-node"
                          : "branch",
                      );
                    }}
                    onPointerMove={moveDrag}
                    onContextMenu={(event) =>
                      openWireContextMenu(event, connection.id)
                    }
                  />
                  {(connection.route ?? []).map((node, nodeIndex) => (
                    <circle
                      key={`${connection.id}-node-${nodeIndex}`}
                      className="wire-node wire-junction"
                      data-testid={`wire-node-${connection.id}-${nodeIndex}`}
                      cx={node.x}
                      cy={node.y}
                      r="5"
                      onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        beginWireDragCandidate(
                          event,
                          connection.id,
                          event.altKey || altPressedRef.current
                            ? "move-node"
                            : "branch",
                          event.altKey || altPressedRef.current
                            ? nodeIndex
                            : undefined,
                        );
                      }}
                      onPointerMove={moveDrag}
                    />
                  ))}
                </g>
              );
            })}

            {pendingPin
              ? wireRoutePoints.map((node, nodeIndex) => {
                  const isLast = nodeIndex === wireRoutePoints.length - 1;
                  return (
                    <circle
                      key={`draft-wire-node-${nodeIndex}`}
                      className={[
                        "wire-node",
                        "draft",
                        isLast ? "wire-end" : "",
                      ].join(" ")}
                      data-testid={
                        isLast ? "draft-wire-end" : undefined
                      }
                      cx={node.x}
                      cy={node.y}
                      r={isLast ? "7" : "5"}
                      pointerEvents={isLast ? "all" : "none"}
                      onPointerDown={
                        isLast ? resumeDraftWire : undefined
                      }
                    />
                  );
                })
              : null}

            {pendingPin &&
            wireRoutePoints.length === 0 &&
            wireDraftStart &&
            !wireDragging ? (
              <circle
                className="wire-node draft wire-end"
                data-testid="draft-wire-end"
                cx={wireDraftStart.x}
                cy={wireDraftStart.y}
                r="7"
                pointerEvents="all"
                onPointerDown={resumeDraftWire}
              />
            ) : null}

            {pendingPin && wirePointer && displayCircuit ? (
              <path
                className={[
                  "wire",
                  wireDragging ? "wire-preview" : "wire-draft-placed",
                ].join(" ")}
                d={wirePath([
                  wireDraftStart ??
                    getEndpointPoint(pendingPin, displayCircuit, registry),
                  ...wireRoutePoints,
                  wirePointer,
                ])}
                pointerEvents="none"
              />
            ) : null}

            {displayInputPins.map((pin) => {
              const point = interfacePinPoint(displayCircuit!, pin.id);
              const endpoint: CircuitEndpoint = {
                kind: "interface",
                pinId: pin.id,
              };
              const isRootInput =
                !isInspectingNested &&
                challenge.interface.inputs.some(
                  (candidate) => candidate.id === pin.id,
                );
              const applied =
                inputValues[pin.id] ??
                preview.signals[
                  signalVertex(endpoint, inspection.prefix)
                ] ??
                zeroBits(pin.width);
              const shown =
                isRootInput && usesStagedInputs
                  ? draftInputValues[pin.id] ?? applied
                  : isRootInput
                    ? applied
                    : preview.signals[
                        signalVertex(endpoint, inspection.prefix)
                      ] ?? "X";
              const changed = isRootInput && shown !== applied;

              return (
                <g
                  key={pin.id}
                  className={[
                    "interface-terminal",
                    "input-terminal",
                    changed ? "pending-value" : "",
                  ].join(" ")}
                  data-testid={isRootInput ? `input-${pin.id}` : undefined}
                  data-terminal-x={point.x}
                  data-terminal-y={point.y}
                  data-draft-value={shown}
                  data-applied-value={applied}
                >
                  <rect
                    x={point.x - TERMINAL_BODY_WIDTH - TERMINAL_PORT_GAP}
                    y={point.y - 30}
                    width={TERMINAL_BODY_WIDTH}
                    height={60}
                    rx={10}
                    className="interface-terminal-body"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (isRootInput) editRootInput(pin.id, pin.width);
                    }}
                  />
                  <text
                    x={point.x - 62}
                    y={point.y - 10}
                    textAnchor="middle"
                    className="interface-terminal-name"
                  >
                    {pin.name}
                  </text>
                  <text
                    x={point.x - 62}
                    y={point.y + 14}
                    textAnchor="middle"
                    className="interface-terminal-value"
                  >
                    {shown}
                  </text>
                  {changed ? (
                    <text
                      x={point.x - 62}
                      y={point.y + 26}
                      textAnchor="middle"
                      className="interface-terminal-applied"
                    >
                      적용 {applied}
                    </text>
                  ) : null}
                  {isRootInput ? (
                    <g
                      className="terminal-drag-handle"
                      data-testid={`drag-interface-${pin.id}`}
                      onPointerDown={(event) =>
                        beginInterfaceDrag(event, pin.id, "input")
                      }
                    >
                      <rect
                        x={point.x - TERMINAL_BODY_WIDTH - TERMINAL_PORT_GAP + 5}
                        y={point.y - 28}
                        width={18}
                        height={12}
                        rx="4"
                      />
                      <text
                        x={point.x - TERMINAL_BODY_WIDTH - TERMINAL_PORT_GAP + 14}
                        y={point.y - 19}
                        textAnchor="middle"
                      >
                        ⋮⋮
                      </text>
                    </g>
                  ) : null}
                  <circle
                    className={[
                      "pin",
                      "interface-port",
                      pendingPin &&
                      endpointKey(pendingPin) === endpointKey(endpoint)
                        ? "wire-source"
                        : "",
                      wireHoverTarget &&
                      endpointKey(wireHoverTarget) === endpointKey(endpoint)
                        ? "wire-target"
                        : "",
                    ].join(" ")}
                    data-testid={`pin-interface-${pin.id}`}
                    data-pin-id={pin.id}
                    data-wire-endpoint={endpointKey(endpoint)}
                    cx={point.x}
                    cy={point.y}
                    r="8"
                    onPointerDown={(event) =>
                      beginPinWireGesture(event, endpoint)
                    }
                    onPointerEnter={() => {
                      if (pendingPin && wireDragging) setWireHoverTarget(endpoint);
                    }}
                    onPointerLeave={() => {
                      if (
                        wireHoverTarget &&
                        endpointKey(wireHoverTarget) === endpointKey(endpoint)
                      ) {
                        setWireHoverTarget(null);
                      }
                    }}
                    onPointerUp={(event) => {
                      event.stopPropagation();
                      finishWireConnection(
                        endpoint,
                        event.clientX,
                        event.clientY,
                      );
                    }}
                  />
                </g>
              );
            })}

            {displayOutputPins.map((pin) => {
              const point = interfacePinPoint(displayCircuit!, pin.id);
              const endpoint: CircuitEndpoint = {
                kind: "interface",
                pinId: pin.id,
              };
              const value =
                preview.signals[
                  signalVertex(endpoint, inspection.prefix)
                ] ?? "X";
              const valueClass = signalValueClass(value);

              return (
                <g
                  key={pin.id}
                  className={[
                    "interface-terminal",
                    "output-terminal",
                    valueClass,
                  ].join(" ")}
                  data-testid={`output-${pin.id}`}
                  data-terminal-x={point.x}
                  data-terminal-y={point.y}
                  data-value={value}
                >
                  <rect
                    x={point.x + TERMINAL_PORT_GAP}
                    y={point.y - 30}
                    width={TERMINAL_BODY_WIDTH}
                    height={60}
                    rx={10}
                    className="interface-terminal-body"
                  />
                  <text
                    x={point.x + 62}
                    y={point.y - 10}
                    textAnchor="middle"
                    className="interface-terminal-name"
                  >
                    {pin.name}
                  </text>
                  <text
                    x={point.x + 62}
                    y={point.y + 16}
                    textAnchor="middle"
                    className="interface-terminal-value"
                  >
                    {value}
                  </text>
                  {!isInspectingNested ? (
                    <g
                      className="terminal-drag-handle"
                      data-testid={`drag-interface-${pin.id}`}
                      onPointerDown={(event) =>
                        beginInterfaceDrag(event, pin.id, "output")
                      }
                    >
                      <rect
                        x={point.x + TERMINAL_PORT_GAP + TERMINAL_BODY_WIDTH - 23}
                        y={point.y - 28}
                        width={18}
                        height={12}
                        rx="4"
                      />
                      <text
                        x={point.x + TERMINAL_PORT_GAP + TERMINAL_BODY_WIDTH - 14}
                        y={point.y - 19}
                        textAnchor="middle"
                      >
                        ⋮⋮
                      </text>
                    </g>
                  ) : null}
                  <circle
                    className={[
                      "pin",
                      "interface-port",
                      pendingPin &&
                      endpointKey(pendingPin) === endpointKey(endpoint)
                        ? "wire-source"
                        : "",
                      wireHoverTarget &&
                      endpointKey(wireHoverTarget) === endpointKey(endpoint)
                        ? "wire-target"
                        : "",
                    ].join(" ")}
                    data-testid={`pin-interface-${pin.id}`}
                    data-pin-id={pin.id}
                    data-wire-endpoint={endpointKey(endpoint)}
                    cx={point.x}
                    cy={point.y}
                    r="8"
                    onPointerDown={(event) =>
                      beginPinWireGesture(event, endpoint)
                    }
                    onPointerEnter={() => {
                      if (pendingPin && wireDragging) setWireHoverTarget(endpoint);
                    }}
                    onPointerLeave={() => {
                      if (
                        wireHoverTarget &&
                        endpointKey(wireHoverTarget) === endpointKey(endpoint)
                      ) {
                        setWireHoverTarget(null);
                      }
                    }}
                    onPointerUp={(event) => {
                      event.stopPropagation();
                      finishWireConnection(
                        endpoint,
                        event.clientX,
                        event.clientY,
                      );
                    }}
                  />
                </g>
              );
            })}

            {(displayCircuit?.instances ?? []).map((instance) => {
              const spec = registry.get(instance.componentId);
              const pins = componentPins(spec);
              const position = instance.position ?? { x: 360, y: 220 };
              const geometry = componentGeometry(spec);
              const inputs = geometry.inputPins;
              const outputs = geometry.outputPins;
              const symbolKind = compactSymbolKind(spec);
              const symbolLabel = compactComponentLabel(spec);
              const selected = selectedInstances.includes(instance.id);
              const storedValuePin = componentShowsStoredValue(spec)
                ? outputs.find(
                    (pin) =>
                      pin.id.toLowerCase() === "q" ||
                      pin.name.toLowerCase() === "q",
                  ) ?? outputs[0]
                : undefined;
              const storedValue = storedValuePin
                ? preview.signals[
                    signalVertex(
                      {
                        kind: "instance",
                        instanceId: instance.id,
                        pinId: storedValuePin.id,
                      },
                      inspection.prefix,
                    )
                  ] ?? "X".repeat(storedValuePin.width)
                : null;

              return (
                <g
                  key={instance.id}
                  className="component"
                  data-testid={`component-${instance.id}`}
                  data-instance-id={instance.id}
                  data-component-id={instance.componentId}
                  data-symbol-kind={symbolKind}
                  data-position-x={position.x}
                  data-position-y={position.y}
                  onPointerDown={(event) => beginDrag(event, instance.id)}
                  onContextMenu={(event) =>
                    openComponentContextMenu(
                      event,
                      instance.id,
                      componentDisplayName(spec),
                    )
                  }
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
                  <title>{componentDisplayName(spec)}</title>
                  <rect
                    x={position.x}
                    y={position.y}
                    width={geometry.width}
                    height={geometry.height}
                    rx="8"
                    className="component-hitbox"
                  />
                  {symbolKind === "nand" ? (
                    <g
                      className={[
                        "compact-symbol",
                        "logic-symbol",
                        selected ? "selected" : "",
                      ].join(" ")}
                    >
                      <path
                        d={[
                          `M ${position.x + 18} ${position.y + 8}`,
                          `L ${position.x + 44} ${position.y + 8}`,
                          `A ${geometry.height / 2 - 8} ${geometry.height / 2 - 8} 0 0 1`,
                          `${position.x + 44} ${position.y + geometry.height - 8}`,
                          `L ${position.x + 18} ${position.y + geometry.height - 8}`,
                          "Z",
                        ].join(" ")}
                        className="logic-symbol-body"
                      />
                      <circle
                        cx={position.x + 73}
                        cy={position.y + geometry.height / 2}
                        r="5"
                        className="logic-symbol-bubble"
                      />
                      <line
                        x1={position.x + 78}
                        y1={position.y + geometry.height / 2}
                        x2={position.x + geometry.width}
                        y2={position.y + geometry.height / 2}
                        className="logic-symbol-lead"
                      />
                      <text
                        x={position.x + 38}
                        y={position.y + geometry.height / 2 + 4}
                        textAnchor="middle"
                        className="compact-symbol-label"
                      >
                        NAND
                      </text>
                    </g>
                  ) : symbolKind === "not" ? (
                    <g
                      className={[
                        "compact-symbol",
                        "logic-symbol",
                        selected ? "selected" : "",
                      ].join(" ")}
                    >
                      <path
                        d={[
                          `M ${position.x + 18} ${position.y + 9}`,
                          `L ${position.x + 67} ${position.y + geometry.height / 2}`,
                          `L ${position.x + 18} ${position.y + geometry.height - 9}`,
                          "Z",
                        ].join(" ")}
                        className="logic-symbol-body"
                      />
                      <circle
                        cx={position.x + 73}
                        cy={position.y + geometry.height / 2}
                        r="5"
                        className="logic-symbol-bubble"
                      />
                      <line
                        x1={position.x + 78}
                        y1={position.y + geometry.height / 2}
                        x2={position.x + geometry.width}
                        y2={position.y + geometry.height / 2}
                        className="logic-symbol-lead"
                      />
                    </g>
                  ) : symbolKind === "and" ? (
                    <g
                      className={[
                        "compact-symbol",
                        "logic-symbol",
                        selected ? "selected" : "",
                      ].join(" ")}
                    >
                      <path
                        d={[
                          `M ${position.x + 18} ${position.y + 8}`,
                          `L ${position.x + 48} ${position.y + 8}`,
                          `A ${geometry.height / 2 - 8} ${geometry.height / 2 - 8} 0 0 1`,
                          `${position.x + 48} ${position.y + geometry.height - 8}`,
                          `L ${position.x + 18} ${position.y + geometry.height - 8}`,
                          "Z",
                        ].join(" ")}
                        className="logic-symbol-body"
                      />
                      <line
                        x1={position.x + 72}
                        y1={position.y + geometry.height / 2}
                        x2={position.x + geometry.width}
                        y2={position.y + geometry.height / 2}
                        className="logic-symbol-lead"
                      />
                      <text
                        x={position.x + 40}
                        y={position.y + geometry.height / 2 + 4}
                        textAnchor="middle"
                        className="compact-symbol-label"
                      >
                        AND
                      </text>
                    </g>
                  ) : symbolKind === "or" ? (
                    <g
                      className={[
                        "compact-symbol",
                        "logic-symbol",
                        "or-symbol",
                        selected ? "selected" : "",
                      ].join(" ")}
                    >
                      <path
                        d={[
                          `M ${position.x + 17} ${position.y + 8}`,
                          `Q ${position.x + 38} ${position.y + geometry.height / 2}`,
                          `${position.x + 17} ${position.y + geometry.height - 8}`,
                          `Q ${position.x + 55} ${position.y + geometry.height - 8}`,
                          `${position.x + 75} ${position.y + geometry.height / 2}`,
                          `Q ${position.x + 55} ${position.y + 8}`,
                          `${position.x + 17} ${position.y + 8}`,
                          "Z",
                        ].join(" ")}
                        className="logic-symbol-body"
                      />
                      <line
                        x1={position.x + 75}
                        y1={position.y + geometry.height / 2}
                        x2={position.x + geometry.width}
                        y2={position.y + geometry.height / 2}
                        className="logic-symbol-lead"
                      />
                      <text
                        x={position.x + 45}
                        y={position.y + geometry.height / 2 + 4}
                        textAnchor="middle"
                        className="compact-symbol-label"
                      >
                        OR
                      </text>
                    </g>
                  ) : symbolKind === "xor" ? (
                    <g
                      className={[
                        "compact-symbol",
                        "logic-symbol",
                        "xor-symbol",
                        selected ? "selected" : "",
                      ].join(" ")}
                    >
                      <path
                        d={[
                          `M ${position.x + 21} ${position.y + 8}`,
                          `Q ${position.x + 42} ${position.y + geometry.height / 2}`,
                          `${position.x + 21} ${position.y + geometry.height - 8}`,
                          `Q ${position.x + 57} ${position.y + geometry.height - 8}`,
                          `${position.x + 77} ${position.y + geometry.height / 2}`,
                          `Q ${position.x + 57} ${position.y + 8}`,
                          `${position.x + 21} ${position.y + 8}`,
                          "Z",
                        ].join(" ")}
                        className="logic-symbol-body"
                      />
                      <path
                        d={[
                          `M ${position.x + 14} ${position.y + 8}`,
                          `Q ${position.x + 35} ${position.y + geometry.height / 2}`,
                          `${position.x + 14} ${position.y + geometry.height - 8}`,
                        ].join(" ")}
                        className="logic-symbol-accent"
                      />
                      <line
                        x1={position.x + 77}
                        y1={position.y + geometry.height / 2}
                        x2={position.x + geometry.width}
                        y2={position.y + geometry.height / 2}
                        className="logic-symbol-lead"
                      />
                      <text
                        x={position.x + 49}
                        y={position.y + geometry.height / 2 + 4}
                        textAnchor="middle"
                        className="compact-symbol-label"
                      >
                        XOR
                      </text>
                    </g>
                  ) : symbolKind === "mux" ? (
                    <g
                      className={[
                        "compact-symbol",
                        "mux-symbol",
                        selected ? "selected" : "",
                      ].join(" ")}
                    >
                      <path
                        d={[
                          `M ${position.x + 18} ${position.y + 7}`,
                          `L ${position.x + 72} ${position.y + 14}`,
                          `L ${position.x + 72} ${position.y + geometry.height - 14}`,
                          `L ${position.x + 18} ${position.y + geometry.height - 7}`,
                          "Z",
                        ].join(" ")}
                        className="mux-symbol-body"
                      />
                      <line
                        x1={position.x + 72}
                        y1={position.y + geometry.height / 2}
                        x2={position.x + geometry.width}
                        y2={position.y + geometry.height / 2}
                        className="logic-symbol-lead"
                      />
                      <text
                        x={position.x + 46}
                        y={position.y + geometry.height / 2 + 4}
                        textAnchor="middle"
                        className="compact-symbol-label"
                      >
                        MUX
                      </text>
                    </g>
                  ) : (
                    <g
                      className={[
                        "compact-symbol",
                        "chip-symbol",
                        selected ? "selected" : "",
                      ].join(" ")}
                    >
                      <rect
                        x={position.x + 10}
                        y={position.y + 6}
                        width={geometry.width - 20}
                        height={geometry.height - 12}
                        rx="7"
                        className="chip-symbol-body"
                      />
                      <text
                        x={position.x + geometry.width / 2}
                        y={
                          position.y +
                          geometry.height / 2 +
                          (storedValue ? -4 : 4)
                        }
                        textAnchor="middle"
                        className="compact-symbol-label"
                      >
                        {symbolLabel}
                      </text>
                      {storedValue && storedValuePin ? (
                        <text
                          x={position.x + geometry.width / 2}
                          y={position.y + geometry.height / 2 + 15}
                          textAnchor="middle"
                          className={[
                            "compact-state-value",
                            signalValueClass(storedValue),
                          ].join(" ")}
                          data-testid={`component-state-value-${instance.id}`}
                        >
                          {storedValuePin.name}={storedValue}
                        </text>
                      ) : null}
                    </g>
                  )}

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
                          className={[
                            "pin",
                            pendingPin &&
                            endpointKey(pendingPin) === endpointKey(endpoint)
                              ? "wire-source"
                              : "",
                            wireHoverTarget &&
                            endpointKey(wireHoverTarget) === endpointKey(endpoint)
                              ? "wire-target"
                              : "",
                          ].join(" ")}
                          data-pin-id={pin.id}
                          data-wire-endpoint={endpointKey(endpoint)}
                          cx={point.x}
                          cy={point.y}
                          r="5.5"
                          onPointerDown={(event) =>
                            beginPinWireGesture(event, endpoint)
                          }
                          onPointerEnter={() => {
                            if (pendingPin && wireDragging) setWireHoverTarget(endpoint);
                          }}
                          onPointerLeave={() => {
                            if (
                              wireHoverTarget &&
                              endpointKey(wireHoverTarget) === endpointKey(endpoint)
                            ) {
                              setWireHoverTarget(null);
                            }
                          }}
                          onPointerUp={(event) => {
                            event.stopPropagation();
                            finishWireConnection(
                        endpoint,
                        event.clientX,
                        event.clientY,
                      );
                          }}
                          aria-label={`${componentDisplayName(spec)} input ${pin.name}`}
                          data-pin-direction="input"
                        />
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
                          className={[
                            "pin",
                            pendingPin &&
                            endpointKey(pendingPin) === endpointKey(endpoint)
                              ? "wire-source"
                              : "",
                            wireHoverTarget &&
                            endpointKey(wireHoverTarget) === endpointKey(endpoint)
                              ? "wire-target"
                              : "",
                          ].join(" ")}
                          data-pin-id={pin.id}
                          data-wire-endpoint={endpointKey(endpoint)}
                          cx={point.x}
                          cy={point.y}
                          r="5.5"
                          onPointerDown={(event) =>
                            beginPinWireGesture(event, endpoint)
                          }
                          onPointerEnter={() => {
                            if (pendingPin && wireDragging) setWireHoverTarget(endpoint);
                          }}
                          onPointerLeave={() => {
                            if (
                              wireHoverTarget &&
                              endpointKey(wireHoverTarget) === endpointKey(endpoint)
                            ) {
                              setWireHoverTarget(null);
                            }
                          }}
                          onPointerUp={(event) => {
                            event.stopPropagation();
                            finishWireConnection(
                        endpoint,
                        event.clientX,
                        event.clientY,
                      );
                          }}
                          aria-label={`${componentDisplayName(spec)} output ${pin.name}`}
                          data-pin-direction="output"
                        />
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
                  회로 output을 각 edge/clock step 뒤에 자동으로 기록합니다. Rewind는 이전 simulator state를 복원합니다.
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

            {traceFrames.length === 0 ? (
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
                  <div className="waveform-corner">output / frame</div>
                  {traceFrames.map((frame) => (
                    <div key={frame.index} className="waveform-frame-label">
                      <strong>{frame.index}</strong>
                      <small>c{frame.cycleAfter}</small>
                    </div>
                  ))}

                  {waveformOutputs.flatMap((output) => [
                    <div key={`${output.id}-name`} className="waveform-name">
                      <strong>{output.name}</strong>
                      <small>{output.width}b</small>
                    </div>,
                    ...traceFrames.map((frame) => {
                      const value = output.netId
                        ? frame.signalSamples[output.netId] ?? "·"
                        : "·";
                      return (
                        <div
                          key={`${output.id}-${frame.index}`}
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
                  ])}
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
                {passedVisualTests}/{visualVerificationItems.length} checks
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
                    <small>CURRENT</small>
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
            {visualSequenceChecks.map((sequenceStep, index) => {
              const state =
                testStates[sequenceStep.id] ?? { status: "idle" as const };
              const reveal =
                sequenceStep.visibility === "visible" ||
                state.status !== "idle";
              const isActive = activeTestId === sequenceStep.id;
              const step = sequenceStep.step;

              if (!("expect" in step)) return null;
              const expected = reveal
                ? formatSignals(step.expect)
                : "hidden until execution";

              const expanded = expandedVerificationChecks.has(
                sequenceStep.id,
              );

              return (
                <div
                  key={sequenceStep.id}
                  className={[
                    "sequence-check",
                    expanded ? "expanded" : "",
                  ].join(" ")}
                >
                  <div
                    className={[
                      "test-case-row",
                      "sequence-step-row",
                      state.status,
                      isActive ? "active" : "",
                    ].join(" ")}
                  >
                    <span className="test-case-number">
                      E{index + 1}
                    </span>
                    <div>
                      <small>EXPECTED VALUE</small>
                      <code>{expected}</code>
                    </div>
                    <div>
                      <small>CURRENT VALUE</small>
                      <code>
                        {state.error ? state.error : formatActual(state.actual)}
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
                    <button
                      type="button"
                      className="sequence-details-toggle"
                      data-testid={`sequence-details-toggle-${sequenceStep.id}`}
                      aria-expanded={expanded}
                      aria-label={
                        expanded ? "검증 입력과 동작 접기" : "검증 입력과 동작 펼치기"
                      }
                      onClick={() =>
                        setExpandedVerificationChecks((current) => {
                          const next = new Set(current);
                          if (next.has(sequenceStep.id)) {
                            next.delete(sequenceStep.id);
                          } else {
                            next.add(sequenceStep.id);
                          }
                          return next;
                        })
                      }
                    >
                      {expanded ? "▴" : "▾"}
                    </button>
                  </div>

                  {expanded ? (
                    <div
                      className="sequence-details"
                      data-testid={`sequence-details-${sequenceStep.id}`}
                    >
                      <div className="sequence-details-header">
                        <strong>이 검사까지 적용되는 입력 / 동작</strong>
                        <span>
                          {sequenceStep.setupSteps.length} step
                          {sequenceStep.setupSteps.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      {reveal ? (
                        <div className="sequence-operation-list">
                          {sequenceStep.setupSteps.map((setupStep, setupIndex) => {
                            const setup = setupStep.step;
                            let action = "STEP";
                            let value = "—";

                            if ("set" in setup) {
                              action = "INPUT";
                              value = Object.entries(setup.set)
                                .map(([pinId, literal]) => {
                                  const pin = challenge.interface.inputs.find(
                                    (candidate) => candidate.id === pinId,
                                  );
                                  if (!pin) {
                                    return `${pinId.toUpperCase()}=${literal}`;
                                  }
                                  const binary = literalToVector(
                                    literal,
                                    pin.width,
                                  ).toBinary();
                                  return `${pin.name}=${binary}`;
                                })
                                .join("  ");
                            } else if ("edge" in setup) {
                              action = "EDGE";
                              value = setup.edge.toUpperCase();
                            } else if ("clock" in setup) {
                              action = "CLOCK";
                              value = `${setup.clock} cycle${
                                setup.clock === 1 ? "" : "s"
                              }`;
                            }

                            return (
                              <div
                                key={setupStep.id}
                                className="sequence-operation-row"
                              >
                                <span>{setupIndex + 1}</span>
                                <strong>{action}</strong>
                                <code>{value}</code>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="muted sequence-details-hidden">
                          hidden until execution
                        </p>
                      )}
                    </div>
                  ) : null}
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
              핀에서 Wire를 시작한 뒤 빈 grid 지점에 놓으면 node가 생깁니다.
              node를 이어 원하는 경로를 만든 뒤 목적지 핀에 놓으면 연결됩니다.
              Wire 말단 핀을 드래그하면 연결 끝을 이동합니다. Wire 중간이나 junction은 드래그해야 branch가 시작되고, Alt+드래그하면 관절을 추가하거나 이동합니다. 단순 클릭은 배선을 바꾸지 않습니다.
            </p>
            {pendingPin ? (
              <p>
                {wireDragging ? "Wire 드래그 중" : "Wire 끝 대기"}:{" "}
                <code>{endpointKey(pendingPin)}</code>
                {wireHoverTarget ? (
                  <> → <code>{endpointKey(wireHoverTarget)}</code></>
                ) : null}
              </p>
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

        <h2>Wire signal</h2>
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
          <p className="muted">Wire 중간 클릭: branch 생성 · 말단 핀 드래그: endpoint 이동</p>
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
              <div
                className="component-io-panel"
                data-testid="component-io-panel"
              >
                {([
                  {
                    id: "inputs",
                    title: "입력 (Inputs)",
                    pins: componentPins(spec).filter(
                      (pin) =>
                        pin.direction === "input" ||
                        pin.direction === "inout",
                    ),
                  },
                  {
                    id: "outputs",
                    title: "출력 (Outputs)",
                    pins: componentPins(spec).filter(
                      (pin) =>
                        pin.direction === "output" ||
                        pin.direction === "inout",
                    ),
                  },
                ] as const).map((group) => (
                  <section
                    key={group.id}
                    className="component-io-group"
                    data-testid={`component-io-${group.id}`}
                  >
                    <div className="component-io-group-header">
                      <strong>{group.title}</strong>
                      <span>{group.pins.length}</span>
                    </div>
                    {group.pins.length === 0 ? (
                      <p className="muted component-io-empty">없음</p>
                    ) : (
                      <div className="component-io-list">
                        {group.pins.map((pin) => {
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
                            <div
                              key={pin.id}
                              className="component-io-row"
                              data-testid={`component-io-pin-${pin.id}`}
                            >
                              <div className="component-io-name">
                                <strong>{pin.name}</strong>
                                <small>
                                  {pin.id} · {pin.width} bit
                                </small>
                              </div>
                              <div className="component-io-value">
                                <code
                                  className={
                                    value.includes("X")
                                      ? "unknown-value"
                                      : ""
                                  }
                                >
                                  {value}
                                </code>
                                <small>{signalHex(value)}</small>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                ))}
              </div>
            </div>
          );
        })() : (
          <p className="muted">Click a component to select it.</p>
        )}

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

      {canvasContextMenu ? (
        <div
          className="canvas-context-menu"
          data-testid="canvas-context-menu"
          role="menu"
          style={{
            left: Math.min(canvasContextMenu.x, window.innerWidth - 190),
            top: Math.min(canvasContextMenu.y, window.innerHeight - 96),
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="canvas-context-menu-title">
            {canvasContextMenu.label}
          </div>
          <button
            type="button"
            role="menuitem"
            className="danger"
            data-testid={`context-delete-${canvasContextMenu.kind}`}
            onClick={() => {
              if (canvasContextMenu.kind === "wire") {
                removeConnection(canvasContextMenu.targetId);
              } else {
                removeInstances(new Set([canvasContextMenu.targetId]));
              }
            }}
          >
            Delete {canvasContextMenu.kind}
          </button>
        </div>
      ) : null}

      {stageCelebration ? (
        <StageCompletionReveal
          stageId={stageCelebration}
          completed={project.completed}
          onClose={() => setStageCelebration(null)}
          onOpenJourney={() => setAppMode("journey")}
        />
      ) : null}
    </div>
  );
}
