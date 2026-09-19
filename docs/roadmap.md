# Roadmap

## v0.1 — Combinational Learning Platform

목표: NAND부터 Full Adder까지 실제 curriculum을 플레이할 수 있다.

### Platform

- monorepo/bootstrap
- circuit data model
- pin/wire/net representation
- bit width validation
- 4-state BitVector
- NAND/Input/Output primitives
- combinational simulation
- dirty queue propagation
- oscillation detection
- hierarchical composite component
- circuit compiler / flattening
- editor canvas
- component palette
- inspector
- undo/redo
- project save/load
- challenge format loader
- truth-table validator
- structural validator
- visible/hidden tests
- challenge progression
- publish circuit as chip

### Curriculum

- NOT
- AND
- OR
- XOR
- MUX
- Half Adder
- Full Adder

### Definition of done

한 사용자가 새 프로젝트에서 시작하여 다음 흐름을 GUI에서 완료할 수 있다.

```text
open challenge
 -> construct circuit
 -> inspect signals
 -> run tests
 -> pass hidden tests
 -> publish reusable chip
 -> unlock next challenge
```

---

## v0.2 — Sequential Logic & Memory

- Clock primitive
- sample/commit sequential model
- latch / flip-flop support
- sequence validator
- waveform viewer
- delta trace
- clock-step rewind
- registers
- counters
- small RAM
- virtualized RAM

Curriculum reaches RAM/registers.

---

## v0.3 — CPU Construction

- register file scale support
- CPU-oriented inspectors based on metadata
- instruction validator
- ISA schema
- assembler
- disassembler
- program loading
- instruction trace
- breakpoint model

Curriculum reaches a working user-built CPU.

---

## v0.4 — Machine Construction

- machine schema
- memory map
- RAM/ROM runtime
- device interface
- console
- keyboard
- timer
- disk
- MMIO inspection
- interrupt testing

Curriculum reaches a boot-capable computer.

---

## v0.5 — Boot & Kernel

- disk image tooling
- source/binary view
- boot validator
- kernel debugger
- symbol map
- stack inspection
- software breakpoints where architecture allows
- bootloader and kernel curriculum

---

## Later

- scheduler and process curriculum
- user/kernel separation
- MMU exercises
- filesystem
- executable loader
- shell
- custom curriculum packs
- shareable user-created challenge packs
- performance profiling for very large circuits
