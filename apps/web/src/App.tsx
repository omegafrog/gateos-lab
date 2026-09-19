import {
  useEffect,
  useMemo,
  useRef,
  useState,
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
} from "@gateos/challenge-engine";

const STORAGE_KEY = "gateos-lab:v0.1";
const CANVAS_WIDTH = 920;
const CANVAS_HEIGHT = 560;

interface CurriculumManifest {
  schema: "gateos.curriculum/v1";
  id: string;
  title: string;
  challenges: readonly { id: string; file: string }[];
}

interface ProjectState {
  circuits: Record<string, CircuitDefinition>;
  published: Record<string, CircuitDefinition>;
  completed: string[];
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

interface PreviewState {
  error?: string;
  outputs: Record<string, string>;
  signals: Record<string, string>;
}

function emptyProject(): ProjectState {
  return { circuits: {}, published: {}, completed: [] };
}

function loadProject(): ProjectState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyProject();
    const parsed = JSON.parse(raw) as Partial<ProjectState>;
    return {
      circuits: parsed.circuits ?? {},
      published: parsed.published ?? {},
      completed: parsed.completed ?? [],
    };
  } catch {
    return emptyProject();
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
  challenge: ChallengeDefinition,
  pinId: string,
): Point {
  const inputIndex = challenge.interface.inputs.findIndex((pin) => pin.id === pinId);
  if (inputIndex >= 0) {
    return { x: 48, y: 100 + inputIndex * 74 };
  }

  const outputIndex = challenge.interface.outputs.findIndex((pin) => pin.id === pinId);
  return { x: CANVAS_WIDTH - 48, y: 100 + Math.max(outputIndex, 0) * 74 };
}

function getEndpointPoint(
  endpoint: CircuitEndpoint,
  challenge: ChallengeDefinition,
  circuit: CircuitDefinition,
  registry: ComponentRegistry,
): Point {
  if (endpoint.kind === "interface") {
    return interfacePinPoint(challenge, endpoint.pinId);
  }
  return componentPinPoint(
    circuit,
    registry,
    endpoint.instanceId,
    endpoint.pinId,
  );
}

function signalVertex(endpoint: CircuitEndpoint): string {
  return endpoint.kind === "interface"
    ? `root::self::${endpoint.pinId}`
    : `root::inst:${endpoint.instanceId}::${endpoint.pinId}`;
}

function componentDisplayName(spec: ComponentSpec): string {
  return spec.name || spec.id;
}

export function App() {
  const [manifest, setManifest] = useState<CurriculumManifest | null>(null);
  const [challenges, setChallenges] = useState<ChallengeDefinition[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [project, setProject] = useState<ProjectState>(() => loadProject());
  const [pendingPin, setPendingPin] = useState<CircuitEndpoint | null>(null);
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, 0 | 1>>({});
  const [testResult, setTestResult] = useState<ChallengeRunResult | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const svgRef = useRef<SVGSVGElement | null>(null);

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
    const values: Record<string, 0 | 1> = {};
    for (const pin of challenge.interface.inputs) values[pin.id] = 0;
    setInputValues(values);
    setPendingPin(null);
    setSelectedInstance(null);
    setTestResult(null);
  }, [challenge?.id]);

  const circuit = useMemo(() => {
    if (!challenge) return null;
    return project.circuits[challenge.id] ?? createSubmission(challenge);
  }, [challenge, project.circuits]);

  const registry = useMemo(() => buildRegistry(project), [project.published]);

  function updateCircuit(
    updater: (current: CircuitDefinition) => CircuitDefinition,
  ): void {
    if (!challenge) return;
    const current = project.circuits[challenge.id] ?? createSubmission(challenge);
    const next = updater(current);
    setProject((previous) => ({
      ...previous,
      circuits: {
        ...previous.circuits,
        [challenge.id]: next,
      },
    }));
    setTestResult(null);
  }

  const preview = useMemo<PreviewState>(() => {
    if (!challenge || !circuit) return { outputs: {}, signals: {} };

    try {
      const netlist = compileCircuit(circuit, registry);
      const simulator = new Simulator(
        netlist,
        createBuiltinPrimitiveRegistry(),
      );

      for (const pin of challenge.interface.inputs) {
        simulator.setInput(
          pin.id,
          BitVector.fromNumber(inputValues[pin.id] ?? 0, pin.width),
        );
      }

      simulator.settle();

      const outputs: Record<string, string> = {};
      for (const pin of challenge.interface.outputs) {
        outputs[pin.id] = simulator.readOutput(pin.id).toBinary();
      }

      const signals: Record<string, string> = {};
      for (const net of netlist.nets) {
        const value = simulator.readNet(net.id).toBinary();
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
  }, [challenge, circuit, registry, inputValues]);

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

  function addComponent(componentId: string): void {
    if (!circuit) return;
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
  }

  function onPinClick(endpoint: CircuitEndpoint): void {
    if (!circuit) return;
    if (!pendingPin) {
      setPendingPin(endpoint);
      return;
    }

    if (endpointKey(pendingPin) === endpointKey(endpoint)) {
      setPendingPin(null);
      return;
    }

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
    updateCircuit((current) => ({
      ...current,
      connections: current.connections.filter((connection) => connection.id !== id),
    }));
  }

  function removeSelectedInstance(): void {
    if (!selectedInstance) return;
    updateCircuit((current) => ({
      ...current,
      instances: current.instances.filter(
        (instance) => instance.id !== selectedInstance,
      ),
      connections: current.connections.filter(
        (connection) =>
          !(
            connection.from.kind === "instance" &&
            connection.from.instanceId === selectedInstance
          ) &&
          !(
            connection.to.kind === "instance" &&
            connection.to.instanceId === selectedInstance
          ),
      ),
    }));
    setSelectedInstance(null);
  }

  function canvasPoint(event: ReactPointerEvent<SVGSVGElement>): Point {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: event.clientX, y: event.clientY };
    return {
      x: ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
    };
  }

  function beginDrag(
    event: ReactPointerEvent<SVGGElement>,
    instanceId: string,
  ): void {
    if (!circuit) return;
    event.stopPropagation();
    const position = instancePosition(circuit, instanceId);
    const rect = svgRef.current?.getBoundingClientRect();
    const x = rect
      ? ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH
      : event.clientX;
    const y = rect
      ? ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT
      : event.clientY;

    setDrag({
      instanceId,
      offsetX: x - position.x,
      offsetY: y - position.y,
    });
    setSelectedInstance(instanceId);
  }

  function moveDrag(event: ReactPointerEvent<SVGSVGElement>): void {
    if (!drag) return;
    const point = canvasPoint(event);

    updateCircuit((current) => ({
      ...current,
      instances: current.instances.map((instance) =>
        instance.id === drag.instanceId
          ? {
              ...instance,
              position: {
                x: Math.max(90, Math.min(CANVAS_WIDTH - 230, point.x - drag.offsetX)),
                y: Math.max(30, Math.min(CANVAS_HEIGHT - 120, point.y - drag.offsetY)),
              },
            }
          : instance,
      ),
    }));
  }

  function runTests(): void {
    if (!challenge || !circuit) return;
    const result = runChallenge(
      challenge,
      circuit,
      registry,
      createBuiltinPrimitiveRegistry(),
    );
    setTestResult(result);
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
              <button key={spec.id} onClick={() => addComponent(spec.id)}>
                <strong>{componentDisplayName(spec)}</strong>
                <small>{spec.id}</small>
              </button>
            ))
          )}
        </div>
      </aside>

      <main className="workspace">
        <section className="challenge-header">
          <div>
            <p className="eyebrow">Challenge {currentIndex + 1}</p>
            <h1>{challenge.title}</h1>
            <p>{challenge.description}</p>
          </div>
          <div className="run-actions">
            <button className="primary" onClick={runTests}>
              Run tests
            </button>
            <button
              className="success"
              disabled={!testResult?.passed}
              onClick={publish}
            >
              Publish chip
            </button>
          </div>
        </section>

        <section className="io-strip">
          <div>
            <strong>Inputs</strong>
            {challenge.interface.inputs.map((pin) => (
              <button
                key={pin.id}
                className="io-value"
                onClick={() =>
                  setInputValues((current) => ({
                    ...current,
                    [pin.id]: current[pin.id] === 1 ? 0 : 1,
                  }))
                }
              >
                {pin.name}: {inputValues[pin.id] ?? 0}
              </button>
            ))}
          </div>
          <div>
            <strong>Outputs</strong>
            {challenge.interface.outputs.map((pin) => (
              <span key={pin.id} className="io-output">
                {pin.name}: {preview.outputs[pin.id] ?? "X"}
              </span>
            ))}
          </div>
          {preview.error ? <span className="error-text">{preview.error}</span> : null}
        </section>

        <section className="canvas-frame">
          <svg
            ref={svgRef}
            className="circuit-canvas"
            viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
            onPointerMove={moveDrag}
            onPointerUp={() => setDrag(null)}
            onPointerLeave={() => setDrag(null)}
            onClick={() => {
              setSelectedInstance(null);
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
            <rect width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="url(#grid)" />

            {circuit.connections.map((connection) => {
              const from = getEndpointPoint(
                connection.from,
                challenge,
                circuit,
                registry,
              );
              const to = getEndpointPoint(
                connection.to,
                challenge,
                circuit,
                registry,
              );
              const curve = Math.max(60, Math.abs(to.x - from.x) * 0.4);
              return (
                <path
                  key={connection.id}
                  className="wire"
                  d={`M ${from.x} ${from.y} C ${from.x + curve} ${from.y}, ${to.x - curve} ${to.y}, ${to.x} ${to.y}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    removeConnection(connection.id);
                  }}
                />
              );
            })}

            {challenge.interface.inputs.map((pin) => {
              const point = interfacePinPoint(challenge, pin.id);
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
                    cx={point.x}
                    cy={point.y}
                    r="8"
                    onClick={(event) => {
                      event.stopPropagation();
                      onPinClick(endpoint);
                    }}
                  />
                  <text x={point.x} y={point.y + 28} textAnchor="middle" className="signal-label">
                    {preview.signals[signalVertex(endpoint)] ?? "X"}
                  </text>
                </g>
              );
            })}

            {challenge.interface.outputs.map((pin) => {
              const point = interfacePinPoint(challenge, pin.id);
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
                    cx={point.x}
                    cy={point.y}
                    r="8"
                    onClick={(event) => {
                      event.stopPropagation();
                      onPinClick(endpoint);
                    }}
                  />
                  <text x={point.x} y={point.y + 28} textAnchor="middle" className="signal-label">
                    {preview.signals[signalVertex(endpoint)] ?? "X"}
                  </text>
                </g>
              );
            })}

            {circuit.instances.map((instance) => {
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
                  onPointerDown={(event) => beginDrag(event, instance.id)}
                >
                  <rect
                    x={position.x}
                    y={position.y}
                    width="140"
                    height={height}
                    rx="10"
                    className={
                      selectedInstance === instance.id
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
                      circuit,
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
                          {preview.signals[signalVertex(endpoint)] ?? "X"}
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
                      circuit,
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
                          {preview.signals[signalVertex(endpoint)] ?? "X"}
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </section>

        <section className="bottom-panel">
          <div>
            <strong>Wiring</strong>
            <p className="muted">
              핀 하나를 클릭한 뒤 연결할 다른 핀을 클릭하세요. 선을 클릭하면 제거됩니다.
            </p>
            {pendingPin ? (
              <p>Selected pin: <code>{endpointKey(pendingPin)}</code></p>
            ) : null}
          </div>
          <div>
            <strong>Selection</strong>
            <p className="muted">
              블록을 드래그해 이동합니다.
            </p>
            <button
              disabled={!selectedInstance}
              onClick={removeSelectedInstance}
            >
              Delete component
            </button>
          </div>
          <div className="test-results">
            <strong>Tests</strong>
            {!testResult ? (
              <p className="muted">Run tests to validate the circuit.</p>
            ) : (
              <>
                <p className={testResult.passed ? "pass" : "fail"}>
                  {testResult.passed ? "PASS" : "FAIL"}
                </p>
                <ul>
                  {testResult.tests.map((test, index) => (
                    <li key={`${test.validatorIndex}-${test.caseIndex ?? "x"}-${index}`}>
                      {test.passed ? "✓" : "✗"} {test.message}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>
      </main>

      <aside className="sidebar right-panel">
        <h2>Inspector</h2>
        <dl>
          <dt>Challenge</dt>
          <dd>{challenge.id}</dd>
          <dt>Circuit</dt>
          <dd>{circuit.id}</dd>
          <dt>Components</dt>
          <dd>{circuit.instances.length}</dd>
          <dt>Wires</dt>
          <dd>{circuit.connections.length}</dd>
          <dt>Published as</dt>
          <dd>
            {project.published[publishedId(challenge.id)]
              ? publishedId(challenge.id)
              : "—"}
          </dd>
        </dl>

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
