# Learning content sources and writing principles

GateOS의 설명은 특정 글을 요약 복사하는 방식이 아니라, 아래 공개 강의와 교재형 자료에서 공통적으로 강조하는 개념 구조를 기준으로 다시 작성한다.

## Core references

- Nand2Tetris — Boolean Logic, Boolean Arithmetic, Memory, Computer Architecture projects
  - https://www.nand2tetris.org/project01
  - https://www.nand2tetris.org/project02
  - https://www.nand2tetris.org/project03
  - https://www.nand2tetris.org/project05
- MIT Computation Structures
  - Sequential Logic notes: https://computationstructures.org/notes/sequential_logic/notes.html
  - Building the Beta: https://computationstructures.org/lectures/beta/beta.html
  - Course lecture notes: https://computationstructures.org/lectures/lectures.pdf
- UC Berkeley CS 61C course notes
  - Logic gates / combinational logic: https://notes.cs61c.org/content/sds-combinational-logic/
  - Multiplexers and combinational blocks: https://notes.cs61c.org/content/sds-blocks/
  - Register / clocked state: https://notes.cs61c.org/content/sds-state/register/
  - Datapath state elements: https://notes.cs61c.org/content/datapath/elements/
  - Datapath vs. control: https://notes.cs61c.org/content/datapath/
  - R-type datapath / ALU: https://notes.cs61c.org/content/datapath/r-type/
  - Control logic: https://notes.cs61c.org/content/datapath/control/

## Writing rules

1. **Start from the abstraction, not the recipe.** Explain what problem the block solves before showing how to wire it.
2. **Separate data, control, and state.** A signal should be introduced by role: data value, selection/enable control, or stored state.
3. **Make timing explicit.** For stateful circuits, distinguish combinational settling from the clock edge that commits state.
4. **State the invariant.** Each block gets one sentence that must remain true regardless of implementation: e.g. “a MUX selects one data path,” “a register samples D at an edge,” “RAM write changes exactly one addressed word.”
5. **Use hierarchy deliberately.** Reusing a previously built chip is a lesson about abstraction, not a shortcut to hide unexplained behavior.
6. **Avoid repetitive labor as pedagogy.** If widening a 1-bit operation to 4 bits teaches no new dependency or control idea, provide it as a primitive and spend the challenge on a new concept.
7. **Connect each challenge forward.** The final paragraph must explain exactly where this block appears in the next architectural layer.
8. **Hints are progressive.** Hint 1 gives the invariant, Hint 2 gives the block decomposition, Hint 3 gives concrete wiring guidance.
9. **Do not confuse physical implementation with the simulator contract.** When GateOS simplifies timing, active-low behavior, or asynchronous read, say so explicitly.
10. **Prefer causal explanations.** “Q changes because the rising edge samples D” is better than “click clock to update Q.”

All prose in the curriculum is original, source-informed explanatory writing rather than copied course text.
