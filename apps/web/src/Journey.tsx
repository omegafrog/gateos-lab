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
      { id: "ram", label: "RAM16", kind: "memory", requires: ["memory.ram16"] },
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

function MotionSignal({
  path,
  delay = 0,
}: {
  path: string;
  delay?: number;
}) {
  return (
    <circle r="4.5" className="journey-motion-signal" aria-hidden="true">
      <animateMotion
        path={path}
        begin={`${delay}s`}
        dur="2.4s"
        repeatCount="indefinite"
      />
    </circle>
  );
}

function MotionSceneDiagram({ scene }: { scene: JourneyScene }) {
  if (scene.id === "logic") {
    return (
      <>
        <text x="92" y="92" className="journey-motion-caption">PRIMITIVE</text>
        <g className="journey-motion-node" transform="translate(120 210)">
          <path d="M-58-42H-18Q42 0-18 42H-58Z" className="journey-motion-gate" />
          <circle cx="8" cy="0" r="7" className="journey-motion-gate" />
          <text x="-18" y="70" textAnchor="middle">NAND</text>
        </g>
        <path d="M172 210H286" className="journey-motion-wire" />
        <MotionSignal path="M172 210 H286" />
        <g className="journey-motion-cluster">
          <rect x="286" y="125" width="158" height="170" rx="20" className="journey-motion-card" />
          <text x="365" y="165" textAnchor="middle" className="journey-motion-title">BOOLEAN LOGIC</text>
          <text x="365" y="202" textAnchor="middle" className="journey-motion-chip">NOT · AND · OR · XOR</text>
          <path d="M314 235H416" className="journey-motion-miniwire" />
          <circle cx="330" cy="235" r="7" className="journey-motion-port" />
          <circle cx="400" cy="235" r="7" className="journey-motion-port" />
        </g>
        <path d="M444 210H558" className="journey-motion-wire" />
        <MotionSignal path="M444 210 H558" delay={0.7} />
        <g className="journey-motion-cluster" transform="translate(0 0)">
          <rect x="558" y="150" width="170" height="120" rx="18" className="journey-motion-card journey-motion-card--strong" />
          <text x="643" y="200" textAnchor="middle" className="journey-motion-title">FULL ADDER</text>
          <text x="643" y="229" textAnchor="middle" className="journey-motion-muted">SUM + CARRY</text>
        </g>
      </>
    );
  }

  if (scene.id === "state") {
    return (
      <>
        <text x="94" y="92" className="journey-motion-caption">FEEDBACK CREATES STATE</text>
        <g>
          <rect x="86" y="155" width="180" height="126" rx="18" className="journey-motion-card" />
          <text x="176" y="194" textAnchor="middle" className="journey-motion-title">SR LATCH</text>
          <path d="M126 229H226 M226 229C260 229 260 318 176 318C92 318 92 251 126 251" className="journey-motion-wire journey-motion-wire--feedback" />
          <MotionSignal path="M126 229 H226 C260 229 260 318 176 318 C92 318 92 251 126 251" />
        </g>
        <path d="M266 218H370" className="journey-motion-wire" />
        <g>
          <rect x="370" y="142" width="174" height="154" rx="20" className="journey-motion-card" />
          <text x="457" y="184" textAnchor="middle" className="journey-motion-title">D FLIP-FLOP</text>
          <path d="M399 236H514" className="journey-motion-clock" />
          <path d="M399 236v-22h22v44h22v-44h22v44h29" className="journey-motion-clock-pulse" />
          <text x="457" y="278" textAnchor="middle" className="journey-motion-muted">sample on ↑ edge</text>
        </g>
        <path d="M544 218H622" className="journey-motion-wire" />
        <MotionSignal path="M544 218 H622" delay={0.4} />
        <g>
          <rect x="622" y="155" width="138" height="126" rx="18" className="journey-motion-card journey-motion-card--strong" />
          <text x="691" y="204" textAnchor="middle" className="journey-motion-title">REGISTER</text>
          <text x="691" y="235" textAnchor="middle" className="journey-motion-muted">Q(t+1)</text>
        </g>
      </>
    );
  }

  if (scene.id === "multibit") {
    return (
      <>
        <text x="92" y="92" className="journey-motion-caption">BITS BECOME WORDS</text>
        {[0,1,2,3].map((bit) => (
          <g key={bit}>
            <path d={`M92 ${157 + bit * 42} H250`} className="journey-motion-wire journey-motion-wire--bus" />
            <circle cx="108" cy={157 + bit * 42} r="5" className="journey-motion-port" />
            <text x="72" y={162 + bit * 42} textAnchor="end" className="journey-motion-bit">B{bit}</text>
          </g>
        ))}
        <rect x="250" y="132" width="160" height="174" rx="20" className="journey-motion-card" />
        <text x="330" y="185" textAnchor="middle" className="journey-motion-title">ADDER4</text>
        <text x="330" y="219" textAnchor="middle" className="journey-motion-muted">carry ripples →</text>
        <path d="M282 253H378" className="journey-motion-miniwire" />
        <MotionSignal path="M282 253 H378" />
        <path d="M410 219H516" className="journey-motion-wire" />
        <rect x="516" y="148" width="138" height="142" rx="18" className="journey-motion-card" />
        <text x="585" y="199" textAnchor="middle" className="journey-motion-title">REG4</text>
        <text x="585" y="233" textAnchor="middle" className="journey-motion-muted">word state</text>
        <path d="M654 219H720" className="journey-motion-wire" />
        <rect x="720" y="165" width="92" height="108" rx="16" className="journey-motion-card journey-motion-card--strong" />
        <text x="766" y="207" textAnchor="middle" className="journey-motion-title">PC</text>
        <text x="766" y="236" textAnchor="middle" className="journey-motion-muted">+1</text>
      </>
    );
  }

  if (scene.id === "memory") {
    return (
      <>
        <text x="92" y="92" className="journey-motion-caption">ADDRESS SELECTS STATE</text>
        <g>
          <rect x="88" y="155" width="140" height="126" rx="18" className="journey-motion-card" />
          <text x="158" y="195" textAnchor="middle" className="journey-motion-title">DECODER</text>
          {[0,1,2,3].map((row) => (
            <path key={row} d={`M198 ${220 + row * 14} H244`} className="journey-motion-miniwire" />
          ))}
          <text x="158" y="250" textAnchor="middle" className="journey-motion-muted">one-hot write</text>
        </g>
        <path d="M228 218H342" className="journey-motion-wire" />
        <MotionSignal path="M228 218 H342" />
        <g>
          <rect x="342" y="112" width="294" height="218" rx="24" className="journey-motion-card journey-motion-card--strong" />
          {Array.from({length:4},(_,row)=>
            Array.from({length:4},(_,col)=>(
              <rect
                key={`${row}-${col}`}
                x={376+col*58}
                y={145+row*38}
                width="44"
                height="26"
                rx="6"
                className={`journey-motion-cell ${row===2&&col===1?"active":""}`}
              />
            ))
          )}
          <text x="489" y="313" textAnchor="middle" className="journey-motion-title">RAM16</text>
        </g>
        <path d="M636 218H756" className="journey-motion-wire" />
        <MotionSignal path="M636 218 H756" delay={0.8} />
        <text x="700" y="195" textAnchor="middle" className="journey-motion-muted">READ DATA</text>
      </>
    );
  }

  if (scene.id === "cpu") {
    return (
      <>
        <text x="92" y="92" className="journey-motion-caption">READ → EXECUTE → WRITE BACK</text>
        <rect x="82" y="142" width="190" height="170" rx="22" className="journey-motion-card" />
        <text x="177" y="184" textAnchor="middle" className="journey-motion-title">REGISTER FILE</text>
        <text x="177" y="218" textAnchor="middle" className="journey-motion-muted">2 read · 1 write</text>
        <path d="M272 188H406 M272 250H406" className="journey-motion-wire" />
        <MotionSignal path="M272 188 H406" />
        <MotionSignal path="M272 250 H406" delay={0.45} />
        <path d="M406 162L532 218L406 274Z" className="journey-motion-alu" />
        <text x="454" y="223" textAnchor="middle" className="journey-motion-title">ALU</text>
        <path d="M532 218H694" className="journey-motion-wire" />
        <MotionSignal path="M532 218 H694" delay={0.9} />
        <rect x="694" y="166" width="120" height="104" rx="16" className="journey-motion-card journey-motion-card--strong" />
        <text x="754" y="207" textAnchor="middle" className="journey-motion-title">RESULT</text>
        <text x="754" y="237" textAnchor="middle" className="journey-motion-muted">ZERO flag</text>
        <path d="M754 270V354H177V312" className="journey-motion-wire journey-motion-wire--feedback" />
        <MotionSignal path="M754 270 V354 H177 V312" delay={1.2} />
        <text x="470" y="377" textAnchor="middle" className="journey-motion-muted">write-back</text>
      </>
    );
  }

  if (scene.id === "computer") {
    return (
      <>
        <text x="92" y="92" className="journey-motion-caption">SYSTEM INTEGRATION</text>
        <rect x="98" y="150" width="176" height="126" rx="20" className="journey-motion-card journey-motion-card--strong" />
        <text x="186" y="202" textAnchor="middle" className="journey-motion-title">CPU</text>
        <rect x="604" y="150" width="176" height="126" rx="20" className="journey-motion-card" />
        <text x="692" y="202" textAnchor="middle" className="journey-motion-title">RAM16</text>
        <rect x="352" y="132" width="170" height="164" rx="22" className="journey-motion-card" />
        <text x="437" y="185" textAnchor="middle" className="journey-motion-title">SYSTEM BUS</text>
        <text x="437" y="219" textAnchor="middle" className="journey-motion-muted">address · data · control</text>
        <path d="M274 213H352 M522 213H604" className="journey-motion-wire journey-motion-wire--bus" />
        <MotionSignal path="M274 213 H352" />
        <MotionSignal path="M522 213 H604" delay={0.6} />
        <rect x="374" y="326" width="126" height="70" rx="16" className="journey-motion-card" />
        <text x="437" y="368" textAnchor="middle" className="journey-motion-title">I/O</text>
        <path d="M437 296V326" className="journey-motion-wire" />
      </>
    );
  }

  if (scene.id === "boot") {
    return (
      <>
        <text x="92" y="92" className="journey-motion-caption">RESET VECTOR → FIRST INSTRUCTION</text>
        <rect x="170" y="116" width="548" height="286" rx="28" className="journey-motion-monitor" />
        <rect x="196" y="142" width="496" height="226" rx="16" className="journey-motion-screen" />
        <text x="228" y="190" className="journey-motion-terminal">GateOS firmware monitor</text>
        <text x="228" y="228" className="journey-motion-terminal journey-motion-terminal--delay1">PC ← 0000</text>
        <text x="228" y="266" className="journey-motion-terminal journey-motion-terminal--delay2">FETCH  [0000]  1101 0010</text>
        <text x="228" y="304" className="journey-motion-terminal journey-motion-terminal--delay3">DECODE → EXECUTE</text>
        <text x="228" y="342" className="journey-motion-terminal journey-motion-terminal--cursor">kernel _</text>
      </>
    );
  }

  if (scene.id === "os") {
    return (
      <>
        <text x="92" y="92" className="journey-motion-caption">KERNEL SERVICES COME ONLINE</text>
        <circle cx="440" cy="220" r="82" className="journey-motion-kernel" />
        <text x="440" y="215" textAnchor="middle" className="journey-motion-title journey-motion-title--light">GateOS</text>
        <text x="440" y="242" textAnchor="middle" className="journey-motion-muted journey-motion-muted--light">KERNEL</text>
        {[
          ["SYSCALL",220,134],
          ["SCHED",660,134],
          ["MEMORY",220,326],
          ["FILES",660,326],
        ].map(([label,x,y],index)=>(
          <g key={String(label)}>
            <path d={`M440 220 L${x} ${y}`} className="journey-motion-wire" />
            <circle cx={Number(x)} cy={Number(y)} r="58" className="journey-motion-service" />
            <text x={Number(x)} y={Number(y)+5} textAnchor="middle" className="journey-motion-chip">{label}</text>
            <MotionSignal path={`M440 220 L${x} ${y}`} delay={index*0.35} />
          </g>
        ))}
      </>
    );
  }

  return (
    <>
      <text x="92" y="92" className="journey-motion-caption">THE WHOLE STACK BECOMES USEFUL</text>
      <rect x="128" y="102" width="624" height="316" rx="30" className="journey-motion-monitor" />
      <rect x="154" y="128" width="572" height="264" rx="18" className="journey-motion-screen" />
      <rect x="184" y="164" width="178" height="188" rx="16" className="journey-motion-app" />
      <text x="273" y="204" textAnchor="middle" className="journey-motion-title">EDITOR</text>
      <path d="M210 236H332 M210 262H308 M210 288H324 M210 314H276" className="journey-motion-code" />
      <rect x="390" y="164" width="306" height="82" rx="16" className="journey-motion-app" />
      <text x="420" y="196" className="journey-motion-terminal">$ ./hello</text>
      <text x="420" y="224" className="journey-motion-terminal">hello from GateOS _</text>
      <rect x="390" y="268" width="142" height="84" rx="16" className="journey-motion-app" />
      <rect x="554" y="268" width="142" height="84" rx="16" className="journey-motion-app" />
      <text x="461" y="317" textAnchor="middle" className="journey-motion-chip">RUNTIME</text>
      <text x="625" y="317" textAnchor="middle" className="journey-motion-chip">APP</text>
    </>
  );
}

function JourneyMotionStage({
  activeIndex,
  playing,
}: {
  activeIndex: number;
  playing: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (playing) svg.unpauseAnimations();
    else svg.pauseAnimations();
  }, [playing]);

  return (
    <div
      className={`journey-motion-stage ${playing ? "playing" : "paused"}`}
      data-testid="journey-assembly"
    >
      <svg
        ref={svgRef}
        viewBox="0 0 880 480"
        role="img"
        aria-label="GateOS 전체 계층 모션 그래픽"
      >
        <defs>
          <pattern id="journey-motion-grid" width="28" height="28" patternUnits="userSpaceOnUse">
            <path d="M28 0H0V28" className="journey-motion-grid-line" />
          </pattern>
          <radialGradient id="journey-motion-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="880" height="480" fill="url(#journey-motion-grid)" className="journey-motion-grid" />
        <circle cx="440" cy="230" r="250" fill="url(#journey-motion-glow)" className="journey-motion-ambient" />
        {JOURNEY_SCENES.map((scene, index) => (
          <g
            key={scene.id}
            className={`journey-motion-layer ${index === activeIndex ? "active" : ""}`}
            data-motion-scene={scene.id}
            aria-hidden={index === activeIndex ? undefined : true}
          >
            <MotionSceneDiagram scene={scene} />
          </g>
        ))}
      </svg>
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
  const currentSceneIndex = useMemo(() => {
    const found = JOURNEY_SCENES.findIndex((scene) => {
      if (scene.future || scene.challengeIds.length === 0) return false;
      return scene.challengeIds.some((id) => !completedSet.has(id));
    });
    return found >= 0 ? found : JOURNEY_SCENES.findIndex((scene) => scene.id === "cpu");
  }, [completedSet]);

  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(currentSceneIndex, 0),
  );
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );
  const [playing, setPlaying] = useState(() => !reducedMotion);
  const [sceneProgress, setSceneProgress] = useState(0);
  const sceneStartedAtRef = useRef<number>(performance.now());
  const activeScene = JOURNEY_SCENES[activeIndex] ?? JOURNEY_SCENES[0]!;
  const sceneDurationMs = 6800;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = () => {
      setReducedMotion(media.matches);
      if (media.matches) setPlaying(false);
    };
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    sceneStartedAtRef.current = performance.now();
    setSceneProgress(0);
  }, [activeIndex]);

  useEffect(() => {
    if (!playing || reducedMotion) return;
    const timer = window.setInterval(() => {
      const progress = Math.min(
        (performance.now() - sceneStartedAtRef.current) / sceneDurationMs,
        1,
      );
      setSceneProgress(progress);
      if (progress >= 1) {
        setActiveIndex((index) => (index + 1) % JOURNEY_SCENES.length);
      }
    }, 80);
    return () => window.clearInterval(timer);
  }, [playing, reducedMotion]);

  const overallPercent =
    challenges.length === 0
      ? 0
      : Math.round((completed.length / challenges.length) * 100);

  function selectScene(index: number): void {
    setActiveIndex(index);
    sceneStartedAtRef.current = performance.now();
    setSceneProgress(0);
  }

  function previousScene(): void {
    selectScene((activeIndex - 1 + JOURNEY_SCENES.length) % JOURNEY_SCENES.length);
  }

  function nextScene(): void {
    selectScene((activeIndex + 1) % JOURNEY_SCENES.length);
  }

  function sceneAction() {
    if (activeScene.future) {
      return (
        <button type="button" className="journey-scene-action" disabled>
          Future layer
        </button>
      );
    }

    const nextChallenge = activeScene.challengeIds.find(
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
          {challenge?.title ?? "계속 만들기"} 실습 →
        </button>
      );
    }

    const lastChallenge = [...activeScene.challengeIds].reverse().find((id) =>
      completedSet.has(id),
    );
    return lastChallenge ? (
      <button
        type="button"
        className="journey-scene-action"
        onClick={() => onOpenChallenge(lastChallenge)}
      >
        완성한 레이어 Lab에서 보기
      </button>
    ) : (
      <button type="button" className="journey-scene-action" disabled>
        이전 레이어를 먼저 완성하세요
      </button>
    );
  }

  const completedInScene = activeScene.challengeIds.filter((id) =>
    completedSet.has(id),
  ).length;
  const sceneBuildPercent =
    activeScene.challengeIds.length === 0
      ? 0
      : Math.round(
          (completedInScene / activeScene.challengeIds.length) * 100,
        );

  return (
    <main className="journey-page journey-motion-page" data-testid="journey-page">
      <header className="journey-header journey-motion-header">
        <button
          type="button"
          className="journey-brand"
          onClick={() => selectScene(0)}
        >
          <strong>GateOS</strong>
          <span>Motion Journey</span>
        </button>
        <div className="journey-header-actions">
          <span className="journey-progress-label">
            {completed.length}/{challenges.length} built
          </span>
          <button
            type="button"
            className="journey-open-lab"
            data-testid="journey-enter-lab"
            onClick={onEnterLab}
          >
            Open Lab
          </button>
        </div>
      </header>

      <section className="journey-motion-shell">
        <div className="journey-motion-copy">
          <p className="journey-kicker">FROM NAND TO APP · MOTION JOURNEY</p>
          <h1>
            컴퓨터의 모든 층을
            <br />
            하나의 흐름으로 봅니다.
          </h1>
          <p className="journey-hero-description">
            NAND에서 시작한 신호가 state와 memory가 되고, CPU의 datapath를 지나
            컴퓨터를 부팅하고 OS와 application까지 올라가는 과정을 하나의
            모션 그래픽으로 이어서 보여줍니다.
          </p>

          <div className="journey-motion-scene-copy" aria-live="polite">
            <span>{activeScene.eyebrow}</span>
            <h2>{activeScene.title}</h2>
            <p>{activeScene.statement}</p>
            <small>{activeScene.explanation}</small>
          </div>

          <div className="journey-motion-actions">
            {sceneAction()}
            <button type="button" className="journey-secondary-cta" onClick={onEnterLab}>
              전체 Lab 열기
            </button>
          </div>

          <div className="journey-motion-build-progress">
            <div>
              <span>{activeScene.future ? "Future layer" : activeScene.artifact}</span>
              <strong>
                {activeScene.future
                  ? "planned"
                  : `${completedInScene}/${activeScene.challengeIds.length} · ${sceneBuildPercent}%`}
              </strong>
            </div>
            <i>
              <b style={{ width: `${sceneBuildPercent}%` }} />
            </i>
          </div>
        </div>

        <div className="journey-motion-visual">
          <JourneyMotionStage activeIndex={activeIndex} playing={playing} />
          <div className="journey-motion-playback">
            <button type="button" onClick={previousScene} aria-label="이전 장면">
              ←
            </button>
            <button
              type="button"
              data-testid="journey-play-toggle"
              className="journey-motion-play"
              aria-pressed={playing}
              onClick={() => {
                if (reducedMotion) return;
                if (!playing) sceneStartedAtRef.current = performance.now() - sceneProgress * sceneDurationMs;
                setPlaying((value) => !value);
              }}
              disabled={reducedMotion}
            >
              {reducedMotion ? "Reduced motion" : playing ? "Pause" : "Play"}
            </button>
            <button type="button" onClick={nextScene} aria-label="다음 장면">
              →
            </button>
            <div className="journey-motion-time" aria-hidden="true">
              <span style={{ width: `${sceneProgress * 100}%` }} />
            </div>
          </div>
        </div>

        <nav className="journey-motion-rail" aria-label="Journey 장면">
          {JOURNEY_SCENES.map((scene, index) => {
            const built =
              scene.challengeIds.length > 0 &&
              scene.challengeIds.every((id) => completedSet.has(id));
            return (
              <button
                key={scene.id}
                type="button"
                data-testid={`journey-scene-${scene.id}`}
                className={[
                  index === activeIndex ? "active" : "",
                  built ? "built" : "",
                  scene.future ? "future" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => selectScene(index)}
                aria-current={index === activeIndex ? "step" : undefined}
              >
                <i aria-hidden="true" />
                <span>
                  <small>{String(index + 1).padStart(2, "0")}</small>
                  <strong>{scene.artifact}</strong>
                </span>
              </button>
            );
          })}
        </nav>
      </section>

      <footer className="journey-motion-footer">
        <div>
          <span>CURRICULUM BUILD</span>
          <strong>{overallPercent}%</strong>
        </div>
        <div className="journey-overall-progress" aria-label={`현재 전체 진행률 ${overallPercent}%`}>
          <span style={{ width: `${overallPercent}%` }} />
        </div>
        <p>{activeScene.payoff}</p>
      </footer>
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
