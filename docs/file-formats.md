# File Formats

모든 format은 versioned schema identifier를 가진다.

초기 format은 JSON을 사용한다. 향후 binary cache를 추가하더라도 source format은 사람이 읽을 수 있어야 한다.

## 1. Circuit

Extension:

```text
*.circuit.json
```

편집 가능한 회로와 layout을 저장한다.

최소 구조:

```json
{
  "schema": "gateos.circuit/v1",
  "id": "project.full-adder",
  "name": "Full Adder",
  "pins": [],
  "instances": [],
  "connections": [],
  "layout": {}
}
```

## 2. Chip

Extension:

```text
*.chip.json
```

검증 후 reusable component로 publish된 회로다.

예:

```json
{
  "schema": "gateos.chip/v1",
  "id": "user.full_adder",
  "name": "Full Adder",
  "pins": [
    { "id": "a", "name": "A", "direction": "input", "width": 1 },
    { "id": "b", "name": "B", "direction": "input", "width": 1 },
    { "id": "cin", "name": "Cin", "direction": "input", "width": 1 },
    { "id": "sum", "name": "Sum", "direction": "output", "width": 1 },
    { "id": "cout", "name": "Cout", "direction": "output", "width": 1 }
  ],
  "instances": [],
  "connections": [],
  "layout": {}
}
```

## 3. Challenge

Extension:

```text
*.challenge.json
```

예:

```json
{
  "schema": "gateos.challenge/v1",
  "id": "logic.mux2",
  "title": "2-to-1 Multiplexer",
  "description": "SEL에 따라 A 또는 B를 출력한다.",
  "interface": {
    "inputs": [
      { "name": "A", "width": 1 },
      { "name": "B", "width": 1 },
      { "name": "SEL", "width": 1 }
    ],
    "outputs": [
      { "name": "OUT", "width": 1 }
    ]
  },
  "allowedComponents": [
    "user.not",
    "user.and",
    "user.or"
  ],
  "validators": [
    {
      "type": "truthTable",
      "cases": [
        {
          "in": { "A": 0, "B": 0, "SEL": 0 },
          "out": { "OUT": 0 }
        }
      ]
    }
  ],
  "unlocks": ["logic.demux"]
}
```

## 4. Sequence validator

순차회로는 시간 순서를 검증해야 한다.

```json
{
  "type": "sequence",
  "steps": [
    {
      "set": { "D": 42, "ENABLE": 1 }
    },
    {
      "clock": 1
    },
    {
      "expect": { "Q": 42 }
    }
  ]
}
```

## 5. Structural validator

구현 방식 자체가 학습 목표일 때만 사용한다.

```json
{
  "type": "structural",
  "rules": {
    "allowed": ["builtin.nand"],
    "maxComponents": 4
  }
}
```

일반 과제에서 gate count optimization은 기본 completion 조건으로 두지 않는다.

## 6. ISA

Extension:

```text
*.isa.json
```

플랫폼 assembler가 읽는 CPU-neutral description이다.

```json
{
  "schema": "gateos.isa/v1",
  "name": "My16",
  "wordSize": 16,
  "registers": ["R0", "R1", "R2", "R3"],
  "instructions": [
    {
      "mnemonic": "ADD",
      "format": "0001 ddd sss 000000",
      "operands": [
        {
          "name": "dst",
          "type": "register",
          "field": "ddd"
        },
        {
          "name": "src",
          "type": "register",
          "field": "sss"
        }
      ]
    }
  ]
}
```

ISA schema는 실제 CPU와 별개이며 assembler/disassembler/debugger용 metadata다.

## 7. Machine

Extension:

```text
*.machine.json
```

```json
{
  "schema": "gateos.machine/v1",
  "name": "My Computer",
  "cpu": "user.cpu",
  "clockHz": 1000000,
  "addressWidth": 16,
  "memoryMap": [
    { "start": "0x0000", "end": "0xBFFF", "type": "ram" },
    { "start": "0xC000", "end": "0xC0FF", "device": "builtin.console" },
    { "start": "0xD000", "end": "0xD0FF", "device": "builtin.timer" },
    { "start": "0xE000", "end": "0xE0FF", "device": "builtin.disk" },
    { "start": "0xF000", "end": "0xFFFF", "type": "rom" }
  ]
}
```

이 memory map은 예시일 뿐 플랫폼 표준 주소가 아니다.

## 8. Project layout

사용자 프로젝트의 권장 구조:

```text
my-computer/
├── project.json
├── progress.json
├── circuits/
├── chips/
├── isa/
├── machines/
├── programs/
├── disks/
└── traces/
```

## 9. Compatibility rules

- 모든 top-level format에는 `schema`가 있어야 한다.
- parser는 알 수 없는 optional field를 무시할 수 있어야 한다.
- breaking change는 schema version을 올린다.
- layout 정보와 functional circuit information은 논리적으로 구분한다.
- generated cache는 source artifact로 간주하지 않는다.
