import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChallengeDefinition } from "@gateos/challenge-engine";

type JourneyPartKind = "gate" | "chip" | "memory" | "computer" | "software";

interface JourneyPart {
  id: string;
  label: string;
  kind: JourneyPartKind;
  challengeId?: string;
  requires?: readonly string[];
}

export interface JourneyScene {
  id: string;
  eyebrow: string;
  title: string;
  statement: string;
  explanation: string;
  payoff: string;
  artifact: string;
  challengeIds: readonly string[];
  parts: readonly JourneyPart[];
  future?: boolean;
}

export const JOURNEY_SCENES: readonly JourneyScene[] = [
  {
    id: "logic",
    eyebrow: "FROM ONE NAND",
    title: "논리가 태어납니다",
    statement: "NAND 하나를 복제하고 다시 연결하면 계산의 기본 언어가 생깁니다.",
    explanation:
      "NOT, AND, OR, XOR, MUX를 직접 만든 뒤 Full Adder까지 도달합니다. 뒤에서 보게 될 CPU의 복잡한 회로도 결국 이 작은 결정들의 조합입니다.",
    payoff: "이제 0과 1을 비교하고, 선택하고, 더할 수 있습니다.",
    artifact: "Logic Toolkit",
    challengeIds: [
      "logic.not",
      "logic.and",
      "logic.or",
      "logic.xor",
      "routing.mux2",
      "arithmetic.half-adder",
      "arithmetic.full-adder",
    ],
    parts: [
      { id: "nand", label: "NAND", kind: "gate" },
      { id: "xor", label: "XOR", kind: "gate", challengeId: "logic.xor" },
      { id: "mux", label: "MUX", kind: "chip", challengeId: "routing.mux2" },
      {
        id: "fa",
        label: "FULL ADDER",
        kind: "chip",
        challengeId: "arithmetic.full-adder",
      },
    ],
  },
  {
    id: "state",
    eyebrow: "LOGIC + FEEDBACK",
    title: "회로가 기억하기 시작합니다",
    statement: "출력을 다시 입력으로 돌리면 순간적인 신호가 상태가 됩니다.",
    explanation:
      "SR Latch에서 feedback을 만나고, D Latch와 D Flip-Flop을 거쳐 clock edge에서만 갱신되는 Register를 만듭니다.",
    payoff: "이제 회로는 과거 값을 기억하고 원하는 순간에만 바꿀 수 있습니다.",
    artifact: "Register Core",
    challengeIds: [
      "state.sr-latch",
      "state.d-latch",
      "state.dff",
      "state.enable-register",
    ],
    parts: [
      {
        id: "sr",
        label: "SR LATCH",
        kind: "gate",
        challengeId: "state.sr-latch",
      },
      {
        id: "dff",
        label: "DFF",
        kind: "chip",
        challengeId: "state.dff",
      },
      {
        id: "mux",
        label: "MUX",
        kind: "chip",
        requires: ["routing.mux2"],
      },
      {
        id: "reg",
        label: "REGISTER",
        kind: "chip",
        challengeId: "state.enable-register",
      },
    ],
  },
  {
    id: "multibit",
    eyebrow: "BITS BECOME WORDS",
    title: "상태가 4-bit 데이터 경로가 됩니다",
    statement: "1-bit 부품을 병렬로 묶고 계층화하면 word 단위 시스템이 됩니다.",
    explanation:
      "MUX4, Adder4, Register4를 만든 뒤 현재 상태와 다음 상태를 연결해 Counter와 Program Counter를 완성합니다.",
    payoff: "이제 컴퓨터는 다음 주소를 계산하고 4-bit 상태를 한 번에 다룰 수 있습니다.",
    artifact: "Program Counter Subsystem",
    challengeIds: [
      "routing.mux4",
      "arithmetic.adder4",
      "arithmetic.incrementer4",
      "state.register4",
      "state.counter4",
      "state.program-counter4",
    ],
    parts: [
      {
        id: "add",
        label: "ADDER4",
        kind: "chip",
        challengeId: "arithmetic.adder4",
      },
      {
        id: "reg",
        label: "REGISTER4",
        kind: "chip",
        challengeId: "state.register4",
      },
      {
        id: "inc",
        label: "INC4",
        kind: "chip",
        challengeId: "arithmetic.incrementer4",
      },
      {
        id: "pc",
        label: "PC4",
        kind: "chip",
        challengeId: "state.program-counter4",
      },
    ],
  },
  {
    id: "memory",
    eyebrow: "STATE + ADDRESS",
    title: "Register들이 메모리가 됩니다",
    statement: "주소가 저장 위치를 선택하면 여러 Register가 하나의 RAM처럼 동작합니다.",
    explanation:
      "Decoder가 write 대상을 고르고 MUX가 read 대상을 고릅니다. RAM4를 bank로 묶어 RAM16을 만들면, 더 큰 RAM도 같은 계층 원리의 반복이라는 점까지 이해할 수 있습니다.",
    payoff: "이제 CPU가 읽고 쓸 수 있는 주소 공간이 생겼습니다.",
    artifact: "RAM16 Memory Subsystem",
    challengeIds: [
      "routing.decoder2to4",
      "memory.ram4",
      "memory.ram16",
    ],
    parts: [
      {
        id: "decoder",
        label: "DECODER",
        kind: "chip",
        challengeId: "routing.decoder2to4",
      },
      {
        id: "ram4",
        label: "RAM4",
        kind: "memory",
        challengeId: "memory.ram4",
      },
      {
        id: "ram16",
        label: "RAM16",
        kind: "memory",
        challengeId: "memory.ram16",
      },
    ],
  },
  {
    id: "cpu",
    eyebrow: "READ → EXECUTE → WRITE BACK",
    title: "부품들이 CPU가 됩니다",
    statement: "PC, ALU, Register File과 데이터 선택 회로가 하나의 순환 경로로 합쳐집니다.",
    explanation:
      "ALU가 여러 word-level 논리·산술 결과를 OP로 선택합니다. Register File에서 읽은 값은 계산 후 write-back 경로로 다시 저장됩니다.",
    payoff: "여기서부터 소자 모음이 아니라 실제로 계산을 수행하는 CPU가 보이기 시작합니다.",
    artifact: "CPU Core",
    challengeIds: [
      "logic.zero4",
      "arithmetic.alu4",
      "memory.register-file4",
      "cpu.register-transfer4",
      "cpu.alu-datapath4",
    ],
    parts: [
      {
        id: "pc",
        label: "PC",
        kind: "chip",
        requires: ["state.program-counter4"],
      },
      {
        id: "alu",
        label: "ALU",
        kind: "chip",
        challengeId: "arithmetic.alu4",
      },
      {
        id: "rf",
        label: "REGISTER FILE",
        kind: "memory",
        challengeId: "memory.register-file4",
      },
      {
        id: "datapath",
        label: "DATAPATH",
        kind: "chip",
        challengeId: "cpu.alu-datapath4",
      },
    ],
  },
  {
    id: "computer",
    eyebrow: "CPU + MEMORY + I/O",
    title: "CPU가 컴퓨터가 됩니다",
    statement: "CPU 혼자서는 컴퓨터가 아닙니다. RAM, bus, clock, reset, I/O가 시스템 경계를 만듭니다.",
    explanation:
      "이 단계에서는 앞에서 만든 CPU와 RAM이 보드 위에 올라가고 공통 bus와 I/O를 통해 외부 세계와 연결됩니다.",
    payoff: "프로그램을 적재하고 실행할 수 있는 하나의 완전한 기계가 됩니다.",
    artifact: "Working Computer",
    challengeIds: [],
    future: true,
    parts: [
      { id: "cpu", label: "CPU", kind: "chip", requires: ["cpu.alu-datapath4"] },
      { id: "ram", label: "RAM", kind: "memory", requires: ["memory.ram64"] },
      { id: "bus", label: "SYSTEM BUS", kind: "chip" },
      { id: "io", label: "I/O", kind: "chip" },
    ],
  },
  {
    id: "boot",
    eyebrow: "HARDWARE MEETS SOFTWARE",
    title: "컴퓨터가 스스로 첫 명령을 읽습니다",
    statement: "ISA, machine code와 boot ROM이 회로를 프로그램 가능한 기계로 바꿉니다.",
    explanation:
      "전원을 켜면 PC가 정해진 시작 주소를 가리키고 ROM의 첫 instruction부터 fetch, decode, execute가 시작됩니다.",
    payoff: "이제 전원을 켜면 코드가 스스로 실행되는 bootable machine이 됩니다.",
    artifact: "Bootable Machine",
    challengeIds: [],
    future: true,
    parts: [
      { id: "isa", label: "ISA", kind: "software" },
      { id: "asm", label: "ASSEMBLER", kind: "software" },
      { id: "rom", label: "BOOT ROM", kind: "memory" },
      { id: "machine", label: "MACHINE CODE", kind: "software" },
    ],
  },
  {
    id: "os",
    eyebrow: "BOOT → KERNEL",
    title: "직접 만든 OS가 부팅됩니다",
    statement: "Kernel이 하드웨어를 추상화하고 프로그램의 실행과 자원을 관리합니다.",
    explanation:
      "Syscall, scheduler, memory management, file system, driver가 차례로 올라오며 bare metal 컴퓨터가 운영체제를 가진 시스템으로 바뀝니다.",
    payoff: "직접 만든 하드웨어 위에서 직접 만든 GateOS가 실행됩니다.",
    artifact: "GateOS",
    challengeIds: [],
    future: true,
    parts: [
      { id: "kernel", label: "KERNEL", kind: "software" },
      { id: "syscall", label: "SYSCALL", kind: "software" },
      { id: "sched", label: "SCHEDULER", kind: "software" },
      { id: "fs", label: "FILE SYSTEM", kind: "software" },
    ],
  },
  {
    id: "app",
    eyebrow: "THE TOP OF THE STACK",
    title: "마지막에는 앱이 실행됩니다",
    statement: "OS가 제공하는 추상화 위에서 사용자가 실제로 만지는 프로그램을 만듭니다.",
    explanation:
      "Shell, editor, runtime과 작은 application을 만들면서 NAND에서 시작한 모든 계층을 위에서 아래까지 연결합니다.",
    payoff: "하나의 NAND에서 시작해 사용자 프로그램까지 도달합니다.",
    artifact: "NAND → App",
    challengeIds: [],
    future: true,
    parts: [
      { id: "shell", label: "SHELL", kind: "software" },
      { id: "editor", label: "EDITOR", kind: "software" },
      { id: "runtime", label: "RUNTIME", kind: "software" },
      { id: "app", label: "APP", kind: "software" },
    ],
  },
];

interface JourneyViewProps {
  completed: readonly string[];
  challenges: readonly ChallengeDefinition[];
  onOpenChallenge: (challengeId: string) => void;
  onEnterLab: () => void;
}

function isChallengeUnlocked(
  challengeId: string,
  challenges: readonly ChallengeDefinition[],
  completed: ReadonlySet<string>,
): boolean {
  const index = challenges.findIndex((challenge) => challenge.id === challengeId);
  if (index < 0) return false;
  if (index === 0) return true;
  const previous = challenges[index - 1];
  return previous ? completed.has(previous.id) : false;
}

function partStatus(
  part: JourneyPart,
  completed: ReadonlySet<string>,
): "built" | "available" | "blueprint" {
  if (!part.challengeId && !part.requires?.length) return "built";
  const requirements = part.requires ?? (part.challengeId ? [part.challengeId] : []);
  if (requirements.every((id) => completed.has(id))) return "built";
  return "blueprint";
}

function PartGlyph({
  part,
  x,
  y,
  status,
  index,
}: {
  part: JourneyPart;
  x: number;
  y: number;
  status: "built" | "available" | "blueprint";
  index: number;
}) {
  const targets = [
    { x: 248, y: 230 },
    { x: 326, y: 230 },
    { x: 404, y: 230 },
    { x: 326, y: 292 },
  ];
  const target = targets[index] ?? targets[0]!;
  const begin = 0.35 + index * 0.28;
  const className = `journey-piece journey-piece--${status}`;

  return (
    <g className={className} transform={`translate(${x} ${y})`}>
      <animateTransform
        attributeName="transform"
        type="translate"
        from={`${x} ${y}`}
        to={`${target.x} ${target.y}`}
        begin={`${begin}s`}
        dur="2.25s"
        calcMode="spline"
        keyTimes="0;1"
        keySplines="0.2 0.8 0.2 1"
        fill="freeze"
      />
      <animate
        attributeName="opacity"
        values="1;1;0.08"
        keyTimes="0;0.78;1"
        begin={`${begin}s`}
        dur="2.25s"
        fill="freeze"
      />
      {part.kind === "gate" ? (
        <>
          <path
            d="M -42 -24 L -12 -24 Q 26 0 -12 24 L -42 24 Z"
            className="journey-part-body"
          />
          <circle cx="2" cy="0" r="5" className="journey-part-body" />
          <path d="M -58 -12 H -42 M -58 12 H -42 M 7 0 H 54" className="journey-part-lead" />
        </>
      ) : part.kind === "memory" ? (
        <>
          <rect x="-48" y="-34" width="96" height="68" rx="8" className="journey-part-body" />
          <path d="M-34-18H34 M-34 0H34 M-34 18H34 M-14-27V27 M10-27V27" className="journey-part-grid" />
        </>
      ) : part.kind === "software" ? (
        <>
          <rect x="-50" y="-33" width="100" height="66" rx="9" className="journey-part-body" />
          <circle cx="-36" cy="-19" r="3" className="journey-window-dot" />
          <circle cx="-26" cy="-19" r="3" className="journey-window-dot" />
          <path d="M-36-5H22 M-36 7H31 M-36 19H10" className="journey-part-grid" />
        </>
      ) : (
        <>
          <rect x="-48" y="-31" width="96" height="62" rx="9" className="journey-part-body" />
          <path
            d="M-58-20H-48 M-58-7H-48 M-58 7H-48 M-58 20H-48 M48-20H58 M48-7H58 M48 7H58 M48 20H58"
            className="journey-part-lead"
          />
        </>
      )}
      <text x="0" y="5" textAnchor="middle" className="journey-part-label">
        {part.label}
      </text>
      {status === "built" ? (
        <circle cx="42" cy="-27" r="8" className="journey-built-dot" />
      ) : null}
    </g>
  );
}

function ArtifactGraphic({
  scene,
  complete,
}: {
  scene: JourneyScene;
  complete: boolean;
}) {
  const commonClass = `journey-artifact-shape ${complete ? "complete" : "blueprint"}`;

  if (scene.id === "memory") {
    return (
      <g className="journey-final-artifact">
        <rect x="236" y="170" width="180" height="140" rx="16" className={commonClass} />
        {Array.from({ length: 4 }, (_, row) =>
          Array.from({ length: 4 }, (_, col) => (
            <rect
              key={`${row}-${col}`}
              x={258 + col * 36}
              y={191 + row * 25}
              width="28"
              height="17"
              rx="3"
              className="journey-memory-cell"
            />
          )),
        )}
        <text x="326" y="338" textAnchor="middle" className="journey-artifact-title">
          RAM16
        </text>
      </g>
    );
  }

  if (scene.id === "cpu") {
    return (
      <g className="journey-final-artifact">
        <rect x="220" y="158" width="212" height="164" rx="20" className={commonClass} />
        <rect x="251" y="189" width="150" height="92" rx="12" className="journey-artifact-inner" />
        <text x="326" y="228" textAnchor="middle" className="journey-artifact-title large">
          CPU
        </text>
        <text x="326" y="252" textAnchor="middle" className="journey-artifact-subtitle">
          PC · ALU · REG FILE
        </text>
        <path d="M202 184H220 M202 212H220 M202 240H220 M202 268H220 M432 184H450 M432 212H450 M432 240H450 M432 268H450" className="journey-chip-pins" />
      </g>
    );
  }

  if (scene.id === "computer" || scene.id === "boot") {
    return (
      <g className="journey-final-artifact">
        <rect x="202" y="135" width="248" height="158" rx="16" className={commonClass} />
        <rect x="223" y="157" width="206" height="112" rx="7" className="journey-screen" />
        {scene.id === "boot" ? (
          <>
            <text x="244" y="190" className="journey-terminal-text">GateOS Boot ROM</text>
            <text x="244" y="215" className="journey-terminal-text">fetch 0000...</text>
            <text x="244" y="240" className="journey-terminal-text">kernel _</text>
          </>
        ) : (
          <>
            <text x="326" y="205" textAnchor="middle" className="journey-artifact-title">COMPUTER</text>
            <text x="326" y="231" textAnchor="middle" className="journey-artifact-subtitle">CPU + RAM + I/O</text>
          </>
        )}
        <path d="M298 293V320 H354 V293" className="journey-monitor-stand" />
      </g>
    );
  }

  if (scene.id === "os" || scene.id === "app") {
    return (
      <g className="journey-final-artifact">
        <rect x="198" y="127" width="256" height="178" rx="18" className={commonClass} />
        <rect x="217" y="148" width="218" height="137" rx="9" className="journey-screen" />
        <circle cx="234" cy="163" r="4" className="journey-window-dot" />
        <circle cx="247" cy="163" r="4" className="journey-window-dot" />
        <circle cx="260" cy="163" r="4" className="journey-window-dot" />
        {scene.id === "os" ? (
          <>
            <text x="326" y="211" textAnchor="middle" className="journey-artifact-title large">GateOS</text>
            <text x="326" y="239" textAnchor="middle" className="journey-artifact-subtitle">kernel online</text>
            <text x="239" y="267" className="journey-terminal-text">$ _</text>
          </>
        ) : (
          <>
            <rect x="239" y="185" width="72" height="79" rx="7" className="journey-app-panel" />
            <rect x="323" y="185" width="90" height="31" rx="7" className="journey-app-panel" />
            <rect x="323" y="226" width="90" height="38" rx="7" className="journey-app-panel" />
            <text x="326" y="330" textAnchor="middle" className="journey-artifact-title">YOUR APP</text>
          </>
        )}
      </g>
    );
  }

  return (
    <g className="journey-final-artifact">
      <rect x="222" y="169" width="208" height="142" rx="20" className={commonClass} />
      <rect x="249" y="195" width="154" height="88" rx="12" className="journey-artifact-inner" />
      <text x="326" y="232" textAnchor="middle" className="journey-artifact-title">
        {scene.artifact}
      </text>
      <text x="326" y="258" textAnchor="middle" className="journey-artifact-subtitle">
        {scene.id === "logic"
          ? "logic · route · add"
          : scene.id === "state"
            ? "sample · hold · update"
            : "4-bit state · next address"}
      </text>
    </g>
  );
}

function JourneyAssembly({
  scene,
  completed,
  replayToken,
}: {
  scene: JourneyScene;
  completed: ReadonlySet<string>;
  replayToken: number;
}) {
  const stageComplete =
    scene.challengeIds.length > 0 &&
    scene.challengeIds.every((id) => completed.has(id));
  const origins = [
    { x: 108, y: 120 },
    { x: 326, y: 84 },
    { x: 544, y: 120 },
    { x: 326, y: 410 },
  ];

  return (
    <div
      key={`${scene.id}-${replayToken}`}
      className="journey-assembly journey-assembly--running"
      data-testid="journey-assembly"
    >
      <svg viewBox="0 0 652 470" role="img" aria-label={`${scene.title} 조립 연출`}>
        <defs>
          <pattern id={`grid-${scene.id}-${replayToken}`} width="22" height="22" patternUnits="userSpaceOnUse">
            <path d="M22 0H0V22" className="journey-grid-line" />
          </pattern>
        </defs>
        <rect
          x="0"
          y="0"
          width="652"
          height="470"
          fill={`url(#grid-${scene.id}-${replayToken})`}
          className="journey-grid"
        />

        <g className="journey-assembly-wires">
          {origins.map((origin, index) => (
            <path
              key={index}
              d={`M ${origin.x} ${origin.y} C ${origin.x} 220, 326 170, 326 238`}
              className="journey-assembly-wire"
            >
              <animate
                attributeName="stroke-dashoffset"
                from="260"
                to="0"
                begin={`${0.75 + index * 0.18}s`}
                dur="1.55s"
                fill="freeze"
              />
            </path>
          ))}
        </g>

        <g className="journey-assembly-parts">
          {scene.parts.slice(0, 4).map((part, index) => {
            const origin = origins[index]!;
            return (
              <PartGlyph
                key={part.id}
                part={part}
                x={origin.x}
                y={origin.y}
                status={partStatus(part, completed)}
                index={index}
              />
            );
          })}
        </g>

        <ArtifactGraphic scene={scene} complete={stageComplete} />
      </svg>

      <div className={`journey-artifact-caption ${stageComplete ? "complete" : ""}`}>
        <span>{stageComplete ? "ASSEMBLED" : scene.future ? "FUTURE LAYER" : "UNDER CONSTRUCTION"}</span>
        <strong>{scene.artifact}</strong>
      </div>
    </div>
  );
}

export function JourneyView({
  completed,
  challenges,
  onOpenChallenge,
  onEnterLab,
}: JourneyViewProps) {
  const completedSet = useMemo(() => new Set(completed), [completed]);
  const currentScene = useMemo(() => {
    const found = JOURNEY_SCENES.find((scene) => {
      if (scene.future || scene.challengeIds.length === 0) return false;
      const incomplete = scene.challengeIds.some((id) => !completedSet.has(id));
      if (!incomplete) return false;
      const firstIncomplete = scene.challengeIds.find((id) => !completedSet.has(id));
      return firstIncomplete
        ? isChallengeUnlocked(firstIncomplete, challenges, completedSet)
        : false;
    });
    return found ?? JOURNEY_SCENES.find((scene) => scene.id === "cpu") ?? JOURNEY_SCENES[0]!;
  }, [challenges, completedSet]);

  const [activeSceneId, setActiveSceneId] = useState(currentScene.id);
  const [replayToken, setReplayToken] = useState(0);
  const sectionsRef = useRef(new Map<string, HTMLElement>());
  const activeSceneRef = useRef(currentScene.id);
  const pendingSceneTimerRef = useRef<number | null>(null);
  const activeScene =
    JOURNEY_SCENES.find((scene) => scene.id === activeSceneId) ?? currentScene;

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter(
            (entry) =>
              entry.isIntersecting &&
              entry.intersectionRatio >= 0.36,
          )
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        const id = visible?.target.getAttribute("data-journey-scene");
        if (!id || id === activeSceneRef.current) return;

        if (pendingSceneTimerRef.current !== null) {
          window.clearTimeout(pendingSceneTimerRef.current);
        }

        pendingSceneTimerRef.current = window.setTimeout(() => {
          activeSceneRef.current = id;
          setActiveSceneId(id);
          setReplayToken((value) => value + 1);
          pendingSceneTimerRef.current = null;
        }, 260);
      },
      {
        rootMargin: "-27% 0px -27% 0px",
        threshold: [0.36, 0.48],
      },
    );

    for (const element of sectionsRef.current.values()) {
      observer.observe(element);
    }

    return () => {
      observer.disconnect();
      if (pendingSceneTimerRef.current !== null) {
        window.clearTimeout(pendingSceneTimerRef.current);
      }
    };
  }, []);

  const overallPercent =
    challenges.length === 0
      ? 0
      : Math.round((completed.length / challenges.length) * 100);

  function scrollToCurrent(): void {
    sectionsRef.current.get(currentScene.id)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  function renderSceneAction(scene: JourneyScene) {
    if (scene.future) {
      return (
        <button type="button" className="journey-scene-action" disabled>
          앞의 컴퓨터 계층을 완성하면 열립니다
        </button>
      );
    }

    const nextChallenge = scene.challengeIds.find(
      (id) =>
        !completedSet.has(id) &&
        isChallengeUnlocked(id, challenges, completedSet),
    );

    if (nextChallenge) {
      const challenge = challenges.find((item) => item.id === nextChallenge);
      return (
        <button
          type="button"
          className="journey-scene-action primary"
          onClick={() => onOpenChallenge(nextChallenge)}
        >
          {challenge ? `${challenge.title} 만들기` : "계속 만들기"} →
        </button>
      );
    }

    const stageComplete = scene.challengeIds.every((id) => completedSet.has(id));
    if (stageComplete && scene.challengeIds.length > 0) {
      return (
        <button
          type="button"
          className="journey-scene-action"
          onClick={() => setReplayToken((value) => value + 1)}
        >
          조립 연출 다시 보기
        </button>
      );
    }

    return (
      <button type="button" className="journey-scene-action" disabled>
        이전 부품을 먼저 완성하세요
      </button>
    );
  }

  return (
    <main className="journey-page" data-testid="journey-page">
      <header className="journey-header">
        <button type="button" className="journey-brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <strong>GateOS</strong>
          <span>Build every layer</span>
        </button>
        <div className="journey-header-actions">
          <span className="journey-progress-label">{completed.length}/{challenges.length} built</span>
          <button type="button" className="journey-open-lab" data-testid="journey-enter-lab" onClick={onEnterLab}>
            Open Lab
          </button>
        </div>
      </header>

      <section className="journey-hero">
        <div className="journey-hero-copy">
          <p className="journey-kicker">FROM NAND TO APP</p>
          <h1>
            컴퓨터의 모든 층을
            <br />
            직접 만들어 올라갑니다.
          </h1>
          <p className="journey-hero-description">
            소자를 만들고, 그 소자들이 다음 시스템의 재료가 됩니다.
            Gate에서 Register로, RAM과 CPU로, 컴퓨터와 OS를 거쳐 마지막에는
            직접 만든 기계 위에서 앱을 실행합니다.
          </p>
          <div className="journey-hero-actions">
            <button type="button" className="journey-primary-cta" data-testid="journey-continue" onClick={scrollToCurrent}>
              현재 빌드로 이동
            </button>
            <button type="button" className="journey-secondary-cta" onClick={onEnterLab}>
              회로 Lab 열기
            </button>
          </div>
          <div className="journey-overall-progress" aria-label={`현재 전체 진행률 ${overallPercent}%`}>
            <span style={{ width: `${overallPercent}%` }} />
          </div>
          <small>{overallPercent}% of the current hardware curriculum assembled</small>
        </div>

        <div className="journey-hero-machine" aria-hidden="true">
          <svg viewBox="0 0 620 450">
            <path d="M102 98 C190 98 198 190 272 190" className="journey-hero-wire" />
            <path d="M102 330 C190 330 198 250 272 250" className="journey-hero-wire delay" />
            <path d="M348 220 H508" className="journey-hero-wire later" />
            <g transform="translate(72 98)">
              <path d="M-40-24H-12Q28 0-12 24H-40Z" className="journey-hero-gate" />
              <circle cx="3" cy="0" r="5" className="journey-hero-gate" />
              <text x="-8" y="50" textAnchor="middle">NAND</text>
            </g>
            <g transform="translate(72 330)">
              <rect x="-45" y="-31" width="90" height="62" rx="9" className="journey-hero-chip" />
              <text x="0" y="5" textAnchor="middle">RAM</text>
            </g>
            <g transform="translate(310 220)">
              <rect x="-62" y="-50" width="124" height="100" rx="15" className="journey-hero-chip strong" />
              <text x="0" y="-2" textAnchor="middle" className="big">CPU</text>
              <text x="0" y="21" textAnchor="middle" className="small">ALU · REG · PC</text>
            </g>
            <g transform="translate(522 220)">
              <rect x="-65" y="-54" width="130" height="108" rx="12" className="journey-hero-screen-frame" />
              <rect x="-51" y="-40" width="102" height="75" rx="6" className="journey-hero-screen" />
              <text x="0" y="-3" textAnchor="middle" className="big">GateOS</text>
              <text x="0" y="19" textAnchor="middle" className="small">$ app _</text>
            </g>
          </svg>
        </div>
      </section>

      <section className="journey-story">
        <div className="journey-sticky-visual">
          <div className="journey-visual-meta">
            <span>{activeScene.eyebrow}</span>
            <strong>{activeScene.title}</strong>
          </div>
          <JourneyAssembly
            scene={activeScene}
            completed={completedSet}
            replayToken={replayToken}
          />
          <div className="journey-visual-payoff">{activeScene.payoff}</div>
        </div>

        <div className="journey-story-copy">
          {JOURNEY_SCENES.map((scene, index) => {
            const complete =
              scene.challengeIds.length > 0 &&
              scene.challengeIds.every((id) => completedSet.has(id));
            const completedInScene = scene.challengeIds.filter((id) =>
              completedSet.has(id),
            ).length;
            return (
              <section
                key={scene.id}
                ref={(element) => {
                  if (element) sectionsRef.current.set(scene.id, element);
                  else sectionsRef.current.delete(scene.id);
                }}
                data-journey-scene={scene.id}
                data-testid={`journey-scene-${scene.id}`}
                className={`journey-scene-copy ${scene.id === activeSceneId ? "active" : ""}`}
              >
                <div className="journey-scene-number">{String(index + 1).padStart(2, "0")}</div>
                <p className="journey-kicker">{scene.eyebrow}</p>
                <h2>{scene.title}</h2>
                <p className="journey-scene-statement">{scene.statement}</p>
                <p className="journey-scene-explanation">{scene.explanation}</p>

                <div className="journey-part-list" aria-label="조립 재료">
                  {scene.parts.map((part) => {
                    const status = partStatus(part, completedSet);
                    const canOpen =
                      Boolean(part.challengeId) &&
                      isChallengeUnlocked(part.challengeId!, challenges, completedSet);
                    return (
                      <button
                        key={part.id}
                        type="button"
                        className={`journey-part-pill ${status}`}
                        disabled={!canOpen}
                        onClick={() => part.challengeId && onOpenChallenge(part.challengeId)}
                        title={canOpen ? `${part.label} 과제 열기` : undefined}
                      >
                        <span aria-hidden="true">{status === "built" ? "✓" : "◇"}</span>
                        {part.label}
                      </button>
                    );
                  })}
                </div>

                {!scene.future && scene.challengeIds.length > 0 ? (
                  <div className="journey-scene-progress">
                    <span>
                      {complete
                        ? `${scene.artifact} 완성`
                        : `${completedInScene}/${scene.challengeIds.length} parts built`}
                    </span>
                    <i>
                      <b
                        style={{
                          width: `${(completedInScene / scene.challengeIds.length) * 100}%`,
                        }}
                      />
                    </i>
                  </div>
                ) : (
                  <div className="journey-future-label">Future curriculum layer</div>
                )}

                {renderSceneAction(scene)}
              </section>
            );
          })}
        </div>
      </section>

      <section className="journey-finale">
        <p className="journey-kicker">THE WHOLE STACK</p>
        <h2>It started with one NAND gate.</h2>
        <p>
          작은 논리 소자가 상태가 되고, 상태가 메모리와 CPU가 되고,
          컴퓨터가 부팅되어 OS와 앱으로 이어집니다.
        </p>
        <button type="button" className="journey-primary-cta" onClick={onEnterLab}>
          계속 만들기
        </button>
      </section>
    </main>
  );
}

interface StageCompletionRevealProps {
  stageId: string;
  completed: readonly string[];
  onClose: () => void;
  onOpenJourney: () => void;
}

export function StageCompletionReveal({
  stageId,
  completed,
  onClose,
  onOpenJourney,
}: StageCompletionRevealProps) {
  const scene = JOURNEY_SCENES.find((candidate) => candidate.id === stageId);
  const [replayToken, setReplayToken] = useState(0);
  const completedSet = useMemo(() => new Set(completed), [completed]);

  if (!scene) return null;

  return (
    <div className="stage-reveal-backdrop" role="dialog" aria-modal="true" aria-labelledby="stage-reveal-title">
      <div className="stage-reveal-card" data-testid="stage-completion-reveal">
        <p className="journey-kicker">LAYER COMPLETE</p>
        <h2 id="stage-reveal-title">{scene.artifact} 완성</h2>
        <p>{scene.payoff}</p>
        <JourneyAssembly scene={scene} completed={completedSet} replayToken={replayToken} />
        <div className="stage-reveal-actions">
          <button type="button" onClick={() => setReplayToken((value) => value + 1)}>
            다시 조립
          </button>
          <button type="button" onClick={onClose}>
            계속 만들기
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              onClose();
              onOpenJourney();
            }}
          >
            전체 Journey 보기
          </button>
        </div>
      </div>
    </div>
  );
}
