# Curriculum

## Philosophy

GateOS Lab curriculum의 목적은 정답 회로를 복사하는 것이 아니라, **이전 단계에서 만든 component를 다음 단계의 재료로 사용하여 컴퓨터 전체 계층을 직접 쌓는 경험**을 제공하는 것이다.

자유도는 점진적으로 증가한다.

```text
guided logic
    ->
guided components
    ->
semi-guided CPU
    ->
architecture choices
    ->
computer integration
    ->
software engineering
    ->
OS engineering
```

기본 curriculum은 guided track을 제공하지만 플랫폼은 별도의 custom track도 지원해야 한다.

---

## Part 1 — Boolean Logic

1. Signal: 0 / 1 / X
2. NAND
3. NOT
4. AND
5. OR
6. XOR
7. XNOR

결과: 기본 logic chip library

---

## Part 2 — Data Routing

8. 2:1 Multiplexer
9. 4:1 Multiplexer
10. Demultiplexer
11. Decoder
12. Encoder
13. Bus
14. Bus splitter
15. Multi-bit selector

결과: CPU datapath에 필요한 routing primitives

---

## Part 3 — Arithmetic

16. Half Adder
17. Full Adder
18. 4-bit Adder
19. 16-bit Adder
20. Incrementer
21. Two's complement
22. Negator
23. Subtractor
24. Equality comparator
25. Magnitude comparator
26. Left/right shifter
27. ALU

ALU 과제에서는 최소한 다음 기능을 요구한다.

- ADD
- SUB
- AND
- OR
- XOR
- shift
- zero flag

---

## Part 4 — State

28. Feedback and state
29. SR Latch
30. D Latch
31. D Flip-Flop
32. 1-bit Register
33. Multi-bit Register
34. Enable Register
35. Counter
36. Program Counter

여기서 combinational logic과 sequential logic의 차이를 확실히 학습한다.

---

## Part 5 — Memory

37. Address decoder
38. RAM4
39. RAM16
40. hierarchical RAM
41. larger virtualized RAM
42. ROM
43. Register File

작은 RAM은 사용자가 직접 만든다. 충분히 원리를 학습한 이후 대형 RAM은 virtualized component를 허용한다.

---

## Part 6 — CPU Datapath

44. Register-to-register transfer
45. Register -> ALU -> Register
46. Instruction Register
47. Memory Address Register concept
48. Fetch path
49. Opcode decoder
50. Control signals
51. First MOV instruction
52. Arithmetic instructions
53. LOAD / STORE
54. JMP
55. Conditional branch
56. Stack pointer
57. PUSH / POP
58. CALL / RET
59. Working CPU

CPU completion requirement는 특정 내부 설계가 아니라 capability로 정의한다.

- register arithmetic
- memory load/store
- conditional branch
- function call/return

---

## Part 7 — ISA & Toolchain

60. Encode instructions
61. Define ISA metadata
62. Labels and symbols
63. Assemble a simple program
64. Disassemble machine code
65. Instruction trace

이 단계에서 사용자가 만든 CPU와 assembler가 연결된다.

---

## Part 8 — Computer Architecture

66. Address bus
67. Data bus
68. RAM mapping
69. ROM mapping
70. Address decoder
71. MMIO concept
72. Console device
73. Keyboard device
74. Timer device
75. Interrupt request
76. Interrupt controller
77. CPU interrupt entry
78. Interrupt return
79. Disk controller
80. Complete machine
81. Reset behavior

---

## Part 9 — Boot

82. Firmware concept
83. Reset vector
84. Read boot sector
85. Transfer control
86. First bootloader
87. Load a second-stage program
88. Kernel image loading
89. Kernel entry

최종 흐름:

```text
power on
 -> reset
 -> ROM/firmware
 -> boot sector
 -> bootloader
 -> kernel
```

---

## Part 10 — Kernel Foundations

90. Kernel stack
91. Kernel console output
92. Panic
93. Interrupt handler
94. Timer tick
95. Keyboard input
96. Simple allocator

---

## Part 11 — Multitasking

97. CPU context
98. Save context
99. Restore context
100. Context switch
101. Task structure
102. Round-robin scheduler
103. Idle task

---

## Part 12 — User / Kernel Boundary

104. Privilege concept
105. User program
106. Trap/syscall mechanism
107. System call ABI
108. Kernel entry from user code
109. Return to user code
110. Process abstraction

실제 privilege hardware를 curriculum CPU에 어떻게 도입할지는 guided track 별도 명세에서 결정한다.

---

## Part 13 — Memory Management

111. Kernel heap
112. Physical page/frame abstraction
113. Page allocator
114. Address translation concept
115. MMU extension
116. Page table
117. Per-process address space
118. Page fault
119. User memory protection

---

## Part 14 — Storage & Filesystem

120. Kernel disk driver
121. Block abstraction
122. On-disk layout
123. Free block tracking
124. File metadata
125. Directory
126. Path lookup
127. open
128. read
129. write
130. close

---

## Part 15 — Program Loading

131. Executable image format
132. Loader
133. argv-like startup data
134. Create process from file
135. launch first user program

---

## Part 16 — Shell

136. Console input loop
137. Command parser
138. Built-in commands
139. Launch executable
140. Final boot-to-shell system

최종 목표:

```text
POWER ON

user-built logic
  -> user-built CPU
  -> user-built computer
  -> bootloader
  -> kernel
  -> scheduler
  -> filesystem
  -> executable loader

$ _
```

그리고 shell이 실행되는 시점에도 사용자는 CPU -> ALU -> gate 계층으로 내려가 state를 inspect할 수 있어야 한다.

---

## Tracks

### Guided track

처음 학습하는 사용자를 위한 reference architecture를 제공한다.

- 권장 bit width
- 권장 register file
- 권장 instruction formats
- 권장 interrupt model
- 권장 machine devices

### Custom track

capability contract만 만족하면 사용자가 다른 CPU/ISA를 설계할 수 있다.

향후 예:

- simple8
- stack machine
- accumulator CPU
- RISC-like 16-bit CPU
- microcoded CPU

reference architecture는 플랫폼의 hardcoded architecture가 아니다.
