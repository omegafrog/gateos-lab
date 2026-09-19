# Platform Architecture

## Overview

GateOS Lab은 UI와 simulation core를 분리한다.

```text
UI / Editor
    |
    v
Circuit Model
    |
    v
Circuit Compiler
    |
    v
Simulation Core
    |
    +--> Trace / Time Travel
    +--> Challenge Engine
    +--> Machine Runtime
    |
    v
State snapshots / events
    |
    v
UI / Inspectors
```

CLI와 GUI는 동일한 simulation core를 사용할 수 있어야 한다.

## Suggested repository layout

```text
gateos-lab/
├── apps/
│   └── web/
├── packages/
│   ├── circuit-model/
│   ├── circuit-compiler/
│   ├── sim-core/
│   ├── trace-engine/
│   ├── challenge-engine/
│   ├── isa/
│   ├── assembler/
│   ├── machine-runtime/
│   └── debugger/
├── curriculum/
├── schemas/
└── tests/
```

초기 구현은 TypeScript를 기준으로 한다. UI는 React 계열을 사용할 수 있지만 simulation core는 framework-independent package로 유지한다.

---

## Circuit editor UX

기본 레이아웃:

```text
┌─────────────────────────────────────────────────────────┐
│ Project      breadcrumb                step/run controls │
├──────────────┬───────────────────────────┬──────────────┤
│ Components   │                           │ Inspector    │
│              │      Circuit Canvas       │              │
│ Built-ins    │                           │ pin/state    │
│ My Chips     │                           │ values       │
├──────────────┴───────────────────────────┴──────────────┤
│ Challenge | Signals | Waveform | Memory | CPU | Console│
└─────────────────────────────────────────────────────────┘
```

필수 editor action:

- drag/drop component
- connect/disconnect wire
- pan/zoom
- multi-select
- move/delete
- copy/paste
- undo/redo
- wire label
- bus connection
- enter/leave composite component
- probe signal
- run challenge tests

breadcrumb 예:

```text
Computer > CPU > ALU > Adder16 > FullAdder
```

---

## Signal model

내부 신호는 최소 4-state logic을 사용한다.

- 0: LOW
- 1: HIGH
- X: UNKNOWN
- Z: HIGH IMPEDANCE

초기 v0.1 UI에서는 Z 사용이 제한적일 수 있지만 data model은 지원하도록 설계한다.

pin은 width를 가진다.

```ts
type PinDirection = "input" | "output" | "inout";

interface Pin {
  id: string;
  name: string;
  direction: PinDirection;
  width: number;
}
```

width mismatch는 editor validation error다.

---

## Component model

component는 세 범주다.

### Primitive

simulation core가 직접 evaluate한다.

예:

- Input
- Output
- Constant
- NAND
- Clock
- Probe

### Composite

사용자가 만든 회로.

예:

- XOR
- MUX
- FullAdder
- ALU
- CPU

### Virtualized

학습적으로 내부 원리를 이미 경험한 뒤 대형 state를 효율적으로 다루기 위한 behavior-compatible component.

예:

- RAM64K
- ROM
- framebuffer
- disk backing store

virtualized component는 커리큘럼을 건너뛰기 위한 shortcut이 아니라 scale 문제를 해결하기 위한 도구다.

---

## Circuit compilation

편집 데이터와 simulation netlist를 분리한다.

```text
hierarchical circuit
      |
      v
validate
      |
      v
flatten / compile
      |
      v
simulation netlist
```

flatten 과정에서도 source mapping을 유지한다.

예:

```text
node 431
source:
CPU/ALU/Add16/FA[7]/XOR[1]
```

이를 통해 실행은 평탄화된 netlist로 빠르게 수행하고, inspector는 원래 hierarchy를 보여줄 수 있다.

---

## Simulation model

GateOS Lab은 deterministic synchronous digital simulation을 기본으로 한다.

한 clock step:

```text
external input changes
      |
      v
settle combinational logic
      |
      v
sample sequential components
      |
      v
commit sequential state
      |
      v
settle combinational logic
      |
      v
capture trace frame
```

개념적 API:

```ts
function stepClock() {
  settleCombinational();
  sampleSequential();
  commitSequential();
  settleCombinational();
  trace.capture();
}
```

### Dirty queue

전체 회로를 매번 재평가하지 않고 변경된 signal의 downstream만 dirty queue에 넣는다.

```text
input changed
  -> NAND dirty
  -> NAND output changed
  -> downstream MUX dirty
  -> ...
```

### Oscillation detection

combinational loop가 안정화되지 않으면 propagation limit 이후 명시적 simulation error를 발생시킨다.

오류에는 가능한 loop path를 표시한다.

---

## Sequential state

stateful component는 sample과 commit을 분리한다.

```ts
interface SequentialComponent {
  sample(): void;
  commit(): void;
}
```

같은 clock edge에서 여러 flip-flop이 순서 의존적으로 갱신되지 않게 한다.

---

## Trace and time travel

매 cycle 전체 memory snapshot을 저장하지 않는다.

delta 기반 frame을 사용한다.

```ts
interface TraceFrame {
  cycle: number;
  signalChanges: SignalChange[];
  stateChanges: StateChange[];
  memoryChanges: MemoryChange[];
}
```

rewind는 delta를 역적용한다.

초기 v0.2 목표는 clock-step 단위 rewind다. 향후 instruction-level bookmark를 추가할 수 있다.

---

## Challenge engine

challenge는 UI 코드에 하드코딩하지 않고 data-driven format으로 로드한다.

validator 예:

- truthTable
- sequence
- clocked
- structural
- memory
- instruction
- program
- machine
- boot
- os

visible tests와 hidden tests를 지원한다.

challenge 완료 시 사용자가 만든 circuit을 reusable chip으로 publish할 수 있다.

---

## CPU inspection without CPU hardcoding

플랫폼은 R0, PC, SP 같은 이름을 미리 알지 않는다.

사용자가 debug metadata를 지정하면 CPU inspector가 이를 렌더링한다.

예:

```json
{
  "cpuDebug": {
    "programCounter": "cpu.pc.Q",
    "stackPointer": "cpu.regs.r7.Q",
    "registers": {
      "R0": "cpu.regs.r0.Q",
      "R1": "cpu.regs.r1.Q"
    },
    "flags": {
      "Z": "cpu.flags.z.Q"
    }
  }
}
```

---

## Machine runtime

CPU 이후 machine은 address map과 devices로 구성한다.

device interface 예:

```ts
interface Device {
  read(address: number): BitVector;
  write(address: number, value: BitVector): void;
  tick(): void;
  reset(): void;
}
```

초기 device:

- console
- keyboard
- timer
- disk
- framebuffer

이 layer에서도 특정 CPU ISA를 가정하지 않는다.

---

## Non-goals for early versions

- transistor/analog simulation
- propagation delay accurate silicon modeling
- FPGA synthesis
- high-performance general-purpose emulation
- x86/RISC-V compatibility
- production OS execution

목표는 교육적 투명성과 확장 가능한 학습 흐름이다.
