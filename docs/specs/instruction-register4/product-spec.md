# Product Spec: Instruction Register (4-bit)

## 1. Problem and Context

CPU Datapath에서 명령어를 다루려면 현재 처리할 instruction word를 보관할 수 있어야 한다. 학습자는 앞선 register 및 enable register 학습을 바탕으로, 4-bit 값을 조건에 따라 저장하고 유지하는 Instruction Register(IR)의 동작을 만들고 검증한다. 이 챕터는 명령어 저장 동작을 다루며, 저장된 값의 opcode 의미를 해석하지 않는다.

## 2. Goals and Desired Outcomes

학습자는 4-bit instruction word가 `LOAD` 조건과 Clock의 상승 에지에 따라 IR에 캡처되는 원리를 설명하고, 캡처 이후 입력이 바뀌어도 보존되는지 검증할 수 있다.

완료 시 학습자는 다음을 할 수 있다.

- `LOAD=1`인 상태에서 Clock이 상승하면 입력의 4-bit instruction word가 IR에 저장됨을 확인한다.
- `LOAD=0`인 상태에서는 Clock 상승 에지가 발생해도 앞서 캡처된 IR 값을 유지함을 확인한다.
- 입력 값, `LOAD`, Clock 상승 에지, 저장된 출력 사이의 관계를 설명한다.

## 3. Users and Actors

- **학습자**: Instruction Register를 구성하고, 지정된 입력 및 Clock 순서로 동작을 검증한다.
- **학습 콘텐츠**: 목표 동작과 검증 조건을 한국어로 안내한다.

## 4. Ubiquitous Language and Terminology

| 용어 | 정의 |
|---|---|
| Instruction Register (IR) | 현재 처리할 4-bit instruction word를 저장하는 register. 이 챕터에서는 저장과 유지 동작만 다룬다. |
| instruction word | IR에 입력되는 4-bit 값. 이 챕터에서는 비트 패턴의 의미를 해석하지 않는다. |
| `LOAD` | 상승 에지에서 입력을 캡처할지 결정하는 enable 조건. `1`이면 캡처하고 `0`이면 기존 값을 유지한다. |
| 상승 에지 (rising edge) | Clock이 낮은 상태에서 높은 상태로 바뀌는 순간. 이 챕터에서 IR 상태가 갱신되거나 유지되는 시점이다. |
| 캡처 | 상승 에지에서 입력 instruction word를 IR의 저장 값으로 반영하는 동작. |

## 5. Core Use Cases

### UC-IR4-001 — 4-bit instruction word를 캡처하고 유지한다

**시작 조건:** 학습자가 Instruction Register 챕터를 시작하고 4-bit 입력, `LOAD`, Clock 동작을 설정할 수 있다. 첫 캡처 이전의 IR 값은 이 챕터의 학습 또는 검증 결과로 요구하지 않는다.

**주 흐름:**

1. 학습자는 4-bit instruction word를 입력한다.
2. 학습자는 `LOAD=1`로 설정한다.
3. 학습자는 Clock의 상승 에지를 발생시킨다.
4. 학습자는 IR 출력이 상승 에지에서 입력한 4-bit 값과 같은지 확인한다.
5. 학습자는 새 입력 값을 설정하고 `LOAD=0`으로 둔다.
6. 학습자는 Clock의 상승 에지를 발생시킨다.
7. 학습자는 IR 출력이 앞서 캡처된 값을 유지하는지 확인한다.

**종료 조건:** 학습자는 `LOAD=1`의 상승 에지에서 입력이 캡처되고 `LOAD=0`의 상승 에지에서는 이전 값이 보존됨을 확인한다.

## 6. Business Rules and Invariants

- IR에 저장되는 instruction word와 입력은 모두 4-bit 값이다.
- IR 값은 Clock의 상승 에지에서만 이 챕터의 규칙에 따라 갱신 여부가 결정된다.
- 상승 에지에서 `LOAD=1`이면 IR은 그 시점의 입력 instruction word를 캡처한다.
- 상승 에지에서 `LOAD=0`이면 IR은 직전에 캡처한 값을 유지한다.
- instruction word의 opcode 해석은 이 챕터의 규칙에 포함되지 않는다.
- 첫 캡처 전 초기 IR 값은 요구되는 학습 결과나 검증 조건이 아니다.

## 7. States and State Transitions

이 챕터에서 의미 있는 상태는 **캡처된 IR 값**이다. 상태는 입력 값이나 `LOAD`의 조합만으로 바뀌지 않으며, Clock의 상승 에지에서 아래 규칙으로 결정된다.

| 상승 에지 시점의 조건 | 다음 IR 값 |
|---|---|
| `LOAD=1` | 해당 상승 에지 시점의 4-bit 입력 값 |
| `LOAD=0` | 직전 캡처된 IR 값 유지 |

첫 캡처 이전 상태의 값은 명세하지 않는다. Reset 동작은 범위 밖이다.

## 8. Failures, Exceptions, and Boundary Conditions

추가 예외 흐름은 없다. 검증은 첫 캡처 이후에 수행하며, `LOAD=0` 유지 동작은 앞서 캡처된 값과 비교한다. 첫 캡처 이전 초기값과 reset 동작은 검증 경계에 포함하지 않는다.

## 9. Inputs and Outputs

**입력**

- 4-bit instruction word
- `LOAD` 값 (`0` 또는 `1`)
- Clock 상승 에지

**관찰 결과**

- IR의 현재 4-bit 저장 값
- `LOAD=1`인 상승 에지에서 입력이 반영되었는지 여부
- `LOAD=0`인 상승 에지에서 직전 캡처 값이 유지되었는지 여부

## 10. Scope and Non-goals

**범위**

- 다음 guided curriculum 챕터인 CPU Datapath의 Instruction Register 항목
- 4-bit instruction word의 상승 에지 캡처 및 `LOAD=0`일 때의 값 유지
- 학습자가 Instruction Register를 구성하고 해당 동작을 검증하는 경험

**범위 제외**

- opcode decoding 및 instruction 의미 해석
- fetch path
- Memory Address Register
- reset 동작
- 다른 curriculum chapter 및 플랫폼 사용자 흐름 변경
- 첫 캡처 이전 IR 초기값의 정의 또는 검증

## 11. Priorities and Trade-offs

필수 학습 결과는 `LOAD`에 따른 상승 에지 캡처 및 보존 동작을 관찰하고 설명하는 것이다. 이 동작의 명확한 검증이 우선이며, opcode 해석이나 주변 datapath 기능은 이번 챕터에 추가하지 않는다. 첫 캡처 전 초기값과 reset은 학습 목표에 필요하지 않으므로 다루지 않는다.

## 12. Success Conditions and Acceptance Criteria

- **AC-IR4-001:** 학습자는 4-bit 입력을 설정하고 `LOAD=1`에서 Clock 상승 에지를 발생시킨 뒤, IR 출력이 해당 입력과 일치함을 확인할 수 있다.
- **AC-IR4-002:** 앞서 값이 캡처된 상태에서 입력을 다른 4-bit 값으로 바꾸고 `LOAD=0`에서 Clock 상승 에지를 발생시킨 뒤, IR 출력이 이전에 캡처된 값과 같음을 확인할 수 있다.
- **AC-IR4-003:** 학습자는 IR 값의 갱신 여부가 Clock 상승 에지에서 결정되며, `LOAD`가 캡처 또는 유지 동작을 선택한다는 점을 설명할 수 있다.
- **AC-IR4-004:** 학습 콘텐츠와 검증은 opcode decoding, fetch path, Memory Address Register, reset 또는 첫 캡처 이전 IR 초기값을 완료 조건으로 요구하지 않는다.

## Product 다이어그램

- 유스케이스 다이어그램: 해당 없음 — 기존 학습자 흐름 안의 curriculum 콘텐츠이며 플랫폼 사용자 흐름을 신설하거나 변경하지 않는다.
- 액티비티 다이어그램: 해당 없음 — 기존 학습자 흐름 안의 curriculum 콘텐츠이며 플랫폼 사용자 흐름을 신설하거나 변경하지 않는다.
- 업무 상태 다이어그램: 해당 없음 — 별도의 업무 상태를 검토할 목적이 없다.
