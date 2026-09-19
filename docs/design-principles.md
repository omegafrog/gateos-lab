# Design Principles

## 1. We build the platform, not the CPU

GateOS Lab의 코드베이스는 CPU, 컴퓨터, OS를 대신 구현하는 것이 아니라 사용자가 직접 만들 수 있는 환경을 제공해야 한다.

플랫폼 코드에 특정 register 이름, 특정 opcode, 특정 memory map을 전제로 한 로직을 넣지 않는다.

## 2. Start at digital logic, not electronics

학습 범위는 transistor/CMOS/analog timing이 아니라 digital logic부터 시작한다.

최소 primitive는 기본적으로 다음 정도다.

- Input
- Output
- Constant
- NAND
- Clock
- Probe

AND, OR, XOR, MUX 등은 curriculum에서 사용자가 직접 만든다.

## 3. Build once, reuse hierarchically

사용자가 만든 회로는 challenge를 통과하면 reusable component가 된다.

```text
NAND -> XOR -> HalfAdder -> FullAdder -> Adder16 -> ALU
```

대형 회로를 매번 gate 수준으로 펼치지 않는다.

## 4. Never make abstraction irreversible

component를 접어서 사용하더라도 내부 구현을 다시 inspect할 수 있어야 한다.

CPU -> ALU -> Adder16 -> FullAdder -> XOR -> NAND처럼 계층을 내려갈 수 있어야 한다.

## 5. Deterministic simulation first

교육 도구의 목표는 transistor-level accuracy가 아니라 이해 가능한 상태 전이다.

동일한 회로와 동일한 입력은 항상 동일한 결과와 trace를 만들어야 한다.

## 6. Observable by default

가능한 모든 state는 inspect 가능해야 한다.

- pins
- wires
- buses
- clock
- register state
- memory
- control signals
- device registers
- instruction trace

OS 단계에서도 하드웨어 내부 상태를 숨기지 않는다.

## 7. Tests define requirements, not solutions

challenge는 interface와 behavior를 정의한다.

가능하면 내부 구현을 강제하지 않는다. 구조 제한은 해당 학습 목표에 필요한 경우에만 사용한다.

예: NAND만으로 NOT을 만드는 과제에서는 NAND 사용만 허용할 수 있다.

## 8. Gradually increase freedom

초반에는 강하게 guided한다.

```text
early: exact interface
middle: constrained architecture
late: user architecture choices
OS: engineering tasks
```

CPU 단계에서는 사용자가 ISA나 datapath를 일부 직접 설계할 수 있어야 한다.

## 9. Scale by virtualization after understanding

RAM64K를 flip-flop 수십만 개로 렌더링하지 않는다.

작은 RAM을 직접 구성하여 원리를 학습한 이후에는 동일한 behavior를 보존하는 virtualized component를 사용할 수 있다.

## 10. One continuous learning environment

논리회로 시뮬레이터와 OS emulator를 별도 제품처럼 분리하지 않는다.

같은 프로젝트 안에서 사용자가 만든 CPU와 컴퓨터가 실제 bootloader와 kernel을 실행해야 한다.
