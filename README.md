# GateOS Lab

GateOS Lab은 **논리 게이트부터 CPU, 컴퓨터, 부트로더, 커널, OS까지 직접 만들어보며 학습하는 교육용 제작 플랫폼**이다.

이 프로젝트가 만드는 것은 CPU나 특정 컴퓨터가 아니다. GateOS Lab은 사용자가 직접 그것들을 만들 수 있도록 다음을 제공한다.

- 계층형 회로 에디터
- deterministic digital simulation engine
- 신호/파형/상태 디버거
- challenge 및 자동 검증 시스템
- 사용자 정의 component 시스템
- ISA 정의 및 assembler 생성
- machine / MMIO / device runtime
- bootloader 및 OS 개발 환경
- NAND부터 shell까지 이어지는 curriculum

## Core principle

> 학습적으로 한 번 직접 구현한 것은 이후부터 하나의 chip으로 접어 재사용할 수 있지만, 언제든 내부 구현을 다시 열어볼 수 있어야 한다.

예를 들어 사용자는 다음 계층을 자유롭게 오갈 수 있다.

```text
NAND
  ↑
Logic Gate
  ↑
Adder
  ↑
ALU
  ↑
CPU
  ↑
Computer
  ↑
Bootloader
  ↑
Kernel
  ↑
Process / Filesystem / Shell
```

## Platform vs. user world

GateOS Lab의 가장 중요한 경계는 다음과 같다.

```text
PLATFORM
- Circuit Editor
- Simulation Engine
- Challenge Engine
- Trace / Time Travel
- Debugger
- ISA / Assembler framework
- Machine / Device framework
- Curriculum runtime

----------------------------------------

USER-BUILT ARTIFACTS
- Logic gates
- MUX / Decoder / Adder
- Registers / RAM
- ALU
- CPU
- ISA
- Computer
- Bootloader
- Kernel
- OS
```

플랫폼은 특정 CPU를 정답으로 하드코딩하지 않는다. 기본 curriculum에는 guided reference track을 둘 수 있지만, 그것은 플랫폼이 아니라 하나의 학습 코스다.

## Quick start

Requirements:

- Node.js 22+
- npm

```bash
git clone https://github.com/omegafrog/gateos-lab.git
cd gateos-lab
npm install
npm run dev
```

`npm run dev` first builds the internal `@gateos/*` workspace packages and then starts Vite. The terminal will print the local URL, normally `http://localhost:5173`.

Useful commands:

```bash
npm test
npm run build
npm run typecheck
```

## Initial scope

### v0.1
NAND에서 Full Adder까지 실제로 플레이 가능한 최소 플랫폼.

- circuit canvas
- wire / pin / bus model
- NAND, Input, Output primitives
- composite components
- challenge runner
- visible / hidden tests
- component publishing
- basic inspector
- project save/load

### v0.2
Sequential logic와 memory.

- clock
- latch / flip-flop
- registers
- sequence validator
- waveform
- trace / rewind
- small RAM
- virtualized large RAM

### v0.3
CPU 제작.

- register file
- datapath
- control unit
- instruction decoder
- CPU debug metadata
- ISA format
- assembler

### v0.4
컴퓨터 제작.

- address/data bus
- RAM / ROM mapping
- MMIO
- console / keyboard / timer / disk
- interrupt model
- machine runtime

### v0.5+
부팅 및 OS curriculum.

- firmware
- boot sector
- bootloader
- kernel entry
- interrupts
- scheduler
- syscall
- process
- virtual memory
- filesystem
- executable loader
- shell

## Documentation

- [Architecture](docs/architecture.md)
- [File formats](docs/file-formats.md)
- [Curriculum](docs/curriculum.md)
- [Roadmap](docs/roadmap.md)
- [Design principles](docs/design-principles.md)

## Status

현재 guided curriculum은 NAND에서 시작해 logic gate, MUX, Adder, Latch/Flip-Flop, Register, Counter, Program Counter를 거쳐 Address Decoder, RAM4/RAM16, 4-bit Logic Unit, Zero Detector, ALU, dual-read Register File, Register-to-Register Transfer, Register → ALU → Register datapath까지 브라우저에서 진행할 수 있다. RAM16에서 bank hierarchy를 한 번 완성한 뒤에는 더 큰 RAM을 반복 제작하지 않고 CPU 쪽으로 넘어간다. 다음 단계는 Instruction Register, fetch path, opcode decoder와 control signal을 연결해 실제 CPU 실행 흐름으로 확장하는 것이다.
