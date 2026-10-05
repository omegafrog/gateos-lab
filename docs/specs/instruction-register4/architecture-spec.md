# Architecture Spec: Instruction Register (4-bit)

# 1. Design Scope

## 1.1 Target

| 항목 | 대상 |
|---|---|
| Product Spec | `docs/specs/instruction-register4/product-spec.md` |
| Use Cases | `UC-IR4-001` |
| Domain | Guided curriculum 콘텐츠와 기존 challenge 검증 |
| Bounded Contexts | `CONTEXT-MAP.md`에 등록된 경계 없음. 새 경계 추가 없음 |
| Existing Services | `apps/web`, `packages/circuit-compiler`, `packages/sim-core`, 기존 challenge runner |
| External Dependencies | 없음 |
| Affected Data | `curriculum/core/learning.json` 학습 콘텐츠 레코드 |

이번 변경은 Product Spec의 IR4 학습 목표를 기존 데이터 기반 curriculum과 challenge 경로에 연결한다. 구현 대상 동작은 4-bit instruction word의 `LOAD=1` 상승 에지 캡처와 `LOAD=0` 상승 에지 유지뿐이다. opcode 해석, fetch path, Memory Address Register, reset, 첫 캡처 전 값은 추가하지 않는다.

## 1.2 Product Spec Mapping

| Product Spec 항목 | Architecture 요소 |
|---|---|
| `UC-IR4-001` | 기존 web curriculum 화면, 회로 편집기, challenge runner의 end-to-end 흐름 |
| `AC-IR4-001` | `30-instruction-register4.challenge.json`의 순차 검증이 `LOAD=1` 상승 에지 캡처를 검사 |
| `AC-IR4-002` | 같은 challenge 순차 검증이 앞선 캡처 후 `LOAD=0` 상승 에지 유지 여부를 검사 |
| `AC-IR4-003` | 학습 콘텐츠가 입력, `LOAD`, 상승 에지, IR 출력의 관계를 설명 |
| `AC-IR4-004` | 학습 레코드와 challenge 계약은 제외 항목을 완료 조건으로 만들지 않음 |
| 4-bit 입력/출력 불변식 | 기존 challenge 인터페이스 `INSTRUCTION[4]`, `LOAD`, `CLK` → `IR[4]` 및 `user.register4` 제한 |
| 캡처/유지 전이 | 기존 `Register4` 시뮬레이션 의미를 그대로 사용 |
| 첫 캡처 이전 값/Reset 제외 | validator 시퀀스의 범위 밖. 초기값에 대한 기대를 추가하지 않음 |

# 2. Domain Flow

## 2.1 Event Storming Flow

해당 없음 — 이 변경은 새 업무 흐름이나 도메인 명령/이벤트/정책을 도입하지 않는 정적 curriculum 레코드 보완이다. 기존 학습 흐름과 simulator 동작을 재사용한다.

## 2.2 Commands

해당 없음 — 새 domain command가 없다. 학습자의 회로 실행과 제출은 기존 editor/challenge 동작이다.

## 2.3 Domain Events

해당 없음 — 새 domain event나 구독자가 없다.

## 2.4 Policies

해당 없음 — 새 policy 또는 후속 command가 없다.

## 2.5 Read Models

해당 없음 — 별도 read model이 없다. web 화면은 기존 정적 learning 데이터 로딩과 렌더링을 사용한다.

## 2.6 External Interactions

해당 없음 — 외부 시스템 연동이 없다.

## 2.7 Hotspots

| Hotspot | Options | Decision |
|---|---|---|
| Register 동작 구현 위치 | 신규 구현 또는 simulator primitive 재사용 | `packages/sim-core/src/primitives.ts`의 `Register4` 동작을 재사용한다. 초기 unknown, 상승 에지 캡처, LOAD 비활성 시 유지가 이미 요구 의미와 일치한다. |
| 학습 설명 누락 | UI 분기 추가 또는 기존 learning 데이터 보완 | `curriculum/core/learning.json`에 해당 chapter의 학습 항목을 추가한다. `apps/web/src/App.tsx`는 matching learning entry가 있을 때 상세 패널을 표시한다. |
| 검증 범위 | 구조 계약만 확인 또는 실제 구성 제출까지 확인 | 기존 contract test를 보존하고, 브라우저 E2E에서 허용된 `user.register4`를 실제 조립·제출하여 캡처/유지 성공을 확인한다. |

# 3. DDD Architecture

## 3.1 Bounded Contexts

| Bounded Context | Responsibility | Ubiquitous Language | Owned Model | Owned Data |
|---|---|---|---|---|
| 해당 없음 — 등록된 bounded context 없음 | 기존 플랫폼의 curriculum 데이터 표시 및 challenge 검증 capability | chapter, challenge, learning entry, register | 기존 curriculum manifest/learning 및 challenge 정의 | 기존 정적 curriculum 파일 |

## 3.1.1 Boundary Decisions

| Capability | Owner Context | Candidate Boundary | Chosen Boundary | Why Not Weaker? | Why Not Stronger? |
|---|---|---|---|---|---|
| IR4 학습 설명 제공 | 해당 없음 — 기존 web/curriculum capability 내부 | 데이터 레코드 / 내부 capability / bounded context / service | 기존 curriculum 정적 데이터의 레코드 | 별도 로직 경계를 만들 필요 없이 기존 데이터 계약에서 항목을 로드할 수 있다. | 자체 언어, 독립 규칙/상태 수명, 데이터 소유권, 일관성 또는 배포 요구가 없다. |
| 캡처/유지 검증 | 해당 없음 — 기존 challenge/simulator capability 내부 | 기존 validator 설정 / 신규 validator 또는 domain boundary | 기존 sequence/structural validator와 `Register4` primitive | 이 동작을 표현하는 입력·상태 전이 검증이 이미 있다. | 새 validator, 모듈, context, 서비스는 동작 중복과 유지 비용만 만든다. |

## 3.2 Context Map

해당 없음 — 새 bounded context 또는 context 간 통합 관계가 없다. 기존 web 앱은 curriculum 정적 파일과 challenge 정의를 읽고 기존 compiler/simulator/validator 흐름을 사용한다.

## 3.3 Aggregates

해당 없음 — 독립적인 business invariant와 transaction boundary를 가진 aggregate가 추가되지 않는다. 회로 시뮬레이션 상태는 기존 simulator의 기술적 runtime state이며 새로운 aggregate로 승격하지 않는다.

## 3.4 Entities

해당 없음 — 신규 identity와 lifecycle을 가진 entity가 없다. chapter 식별자는 기존 manifest/challenge 참조 계약을 따른다.

## 3.4.1 Class Diagram

해당 없음 — 새 클래스, 인터페이스, 책임 관계가 도입되지 않는다. 기존 클래스/컴포넌트 구조를 수정하는 설계가 아니다.

## 3.5 Value Objects

해당 없음 — 새 값 의미 타입을 만들지 않는다. `INSTRUCTION[4]`, `LOAD`, `CLK`, `IR[4]`는 기존 challenge 데이터 계약으로 표현한다.

## 3.6 Domain Services

해당 없음 — 신규 도메인 규칙이나 domain service가 없다.

## 3.7 Business Rule Ownership

| 규칙 | 소유/집행 지점 |
|---|---|
| chapter 학습 설명이 상세 패널에 제공됨 | `curriculum/core/learning.json` 레코드와 기존 `apps/web/src/App.tsx` learning entry 로딩/표시 계약 |
| `LOAD=1` 상승 에지에서 입력을 캡처하고 `LOAD=0`에서 보존 | 기존 `packages/sim-core/src/primitives.ts` `Register4` primitive 및 challenge sequence validator |
| 게시된 `user.register4`의 순차 primitive 컴파일 | 기존 `packages/circuit-compiler/src/compiler.ts` |
| 인터페이스, 허용 component, 구조 제한 | `curriculum/core/manifest.json` 참조 challenge와 `30-instruction-register4.challenge.json` 계약 |

## 3.8 Aggregate State Transitions

새 aggregate state transition은 해당 없음. 학습 대상인 simulator 상태 전이는 Product Spec의 상태표 그대로이며 기존 `Register4` primitive가 이미 구현한다.

| 조건 | 다음 IR 값 | 소유 |
|---|---|---|
| 상승 에지, `LOAD=1` | 해당 시점의 4-bit 입력 | 기존 `Register4` simulator primitive |
| 상승 에지, `LOAD=0`, 앞선 캡처 존재 | 직전 캡처 값 유지 | 기존 `Register4` simulator primitive |
| 첫 캡처 전 | 명세하지 않음 | 학습/검증 기대값을 추가하지 않음 |

## 3.8.1 State Diagram

해당 없음 — 독립적인 설계 책임 상태 모델이 없고, IR의 업무/학습 상태 도식은 Product Spec 범위의 캡처/유지 의미와 동일하므로 중복하지 않는다.

## 3.9 Repository Boundaries

해당 없음 — 데이터는 기존 정적 JSON 자산이며 신규 repository 또는 persistence boundary가 없다. 사용자 프로젝트와 완료 상태는 기존 browser-local state 경로를 따른다.

# 4. Program Design

## 4.1 Program Structure

기존 구조를 유지한다. web 앱은 `/core/manifest.json`과 `/core/learning.json`을 로드하고 manifest가 가리키는 challenge 파일을 연다. Circuit compiler는 게시된 `user.register4`를 기존 sequential user-register primitive로 컴파일하고, simulator가 그 primitive의 상태 전이를 실행한다.

## 4.2 Major Components and Responsibilities

| 구성요소 | 책임 및 변경 |
|---|---|
| `curriculum/core/manifest.json` | 기존 `cpu.instruction-register4` chapter와 challenge 파일 참조 유지. 변경 불필요. |
| `curriculum/core/learning.json` | 현재 누락된 IR4 학습 콘텐츠 레코드를 제공하는 데이터 변경 지점. |
| `30-instruction-register4.challenge.json` | 기존 interface, validator sequence, allowed component, structural limit을 유지. |
| `apps/web/src/App.tsx` | static curriculum/challenge 로딩 및 learning entry가 있는 상세 패널 렌더링. 새 UI 분기/플랫폼 동작 불필요. |
| `apps/web/src/Journey.tsx` | CPU Journey 항목과 IR scene part가 이미 있음. 변경 불필요. |
| `packages/circuit-compiler/src/compiler.ts` | `user.register4`를 기존 sequential primitive로 컴파일. 변경 불필요. |
| `packages/sim-core/src/primitives.ts` | 기존 Register4 캡처/유지 의미를 제공. 변경 불필요. |
| `tests/extended-curriculum.test.ts` | 기존 manifest/interface/validator/learning 계약 확인. 학습 레코드 계약 유지 또는 필요한 assertion만 보강. |
| `e2e/v01-flow.e2e.ts` | 기존 chapter 이동/콘텐츠 확인에 더해 회로 조립, 제출, sequence acceptance를 실제 브라우저에서 검증하도록 확장. |

## 4.3 Application Flow

1. 앱이 정적 manifest와 learning 데이터를 읽는다.
2. 사용자가 CPU Journey의 `cpu.instruction-register4`를 연다.
3. manifest가 지정한 challenge 정의가 로드되고 learning entry가 있으면 상세 학습 안내가 표시된다.
4. 학습자가 challenge에 허용된 `user.register4`로 IR 경로를 구성한다.
5. 기존 compiler가 해당 component를 sequential user-register primitive로 컴파일한다.
6. 기존 challenge runner가 visible/hidden sequence 및 구조 validator를 실행한다.
7. simulator는 상승 에지에서 LOAD 조건에 따라 캡처 또는 유지하고, challenge runner는 기대 시퀀스와 결과를 비교해 기존 성공/실패 피드백을 제공한다.

첫 캡처 전 초기값, reset, opcode 해석, fetch 동작은 flow에 포함하지 않는다.

## 4.4 Component Call Contracts

새 call contract는 해당 없음. 기존 데이터/validator contracts:

| 경계 | 기존 계약 |
|---|---|
| Manifest → challenge loader | chapter ID가 `30-instruction-register4.challenge.json`을 가리킴 |
| Challenge → circuit editor/validator | 입력 `INSTRUCTION[4]`, `LOAD`, `CLK`; 출력 `IR[4]`; allowed `user.register4`; structural max 1 |
| Compiler → simulator | 게시된 `user.register4`가 sequential user-register primitive로 컴파일됨 |
| Sequence validator → simulator trace/output | visible/hidden 시퀀스에서 상승 에지 캡처와 앞선 값의 유지 검증 |

## 4.5 Major Types

신규 타입은 해당 없음. 기존 curriculum JSON의 chapter, learning entry, challenge, validator 데이터 형식을 재사용한다.

## 4.6 Type Design

해당 없음 — 신규 타입/모델이 없으며 기존 JSON 형식과 simulator primitive가 계약을 담당한다.

## 4.7 Interfaces and Function Signatures

해당 없음 — 신규 함수, API, interface signature가 없다.

## 4.8 Error Propagation

신규 오류 분류/전파 경로는 해당 없음. 입력 인터페이스 위반, 허용되지 않은 구조 또는 시퀀스 불일치는 기존 challenge validator가 기존 실패 결과/피드백으로 보고한다. 콘텐츠 파일 로딩 오류는 기존 static curriculum 로딩 동작을 따른다. 별도 오류 코드나 재시도 정책을 만들지 않는다.

## 4.9 State Transition Implementation

기존 `Register4` primitive는 초기 상태를 unknown으로 두고, rising edge에서 LOAD가 활성일 때 D를 캡처하며 비활성일 때 현재 값을 유지한다. 이 변경은 primitive 구현을 변경하지 않는다. 검증 시퀀스는 먼저 캡처한 뒤 LOAD=0 유지 단계를 실행하여 초기값을 관찰하지 않는다.

## 4.10 Dependency Rules

### Allowed Dependencies

- 정적 learning 데이터는 기존 web curriculum loader/renderer가 읽는다.
- 기존 chapter manifest와 challenge loader/runner 관계를 유지한다.
- compiler와 simulator는 기존 패키지 경계와 primitive contract를 유지한다.
- 테스트는 기존 curriculum contract 및 브라우저 E2E seam을 사용한다.

### Forbidden Dependencies

- curriculum 학습 콘텐츠 또는 challenge를 UI 코드에 chapter 전용으로 하드코딩하지 않는다.
- simulator/compiler에 `INSTRUCTION`, opcode 의미, IR 전용 CPU/fetch 동작을 플랫폼 로직으로 추가하지 않는다.
- IR4 전용 validator, 저장소, 서비스, context를 신설하지 않는다.
- 첫 캡처 전 값 또는 reset을 테스트/학습 완료 요건으로 추가하지 않는다.

# 5. Technical Architecture

## 5.1 Boundary Mapping

| Domain capability | Code/runtime boundary |
|---|---|
| 학습 콘텐츠 제공 | `curriculum/core/learning.json` → 기존 `apps/web/src/App.tsx` loader/view |
| IR 캡처/유지 행동 실행 | 기존 challenge runner → compiler → sim-core `Register4` primitive |
| 콘텐츠 및 회로 검증 | `tests/extended-curriculum.test.ts`, `e2e/v01-flow.e2e.ts`, 기존 challenge validators |

## 5.2 Boundary Promotion Decisions

신규 code module, bounded context, deployable service 또는 별도 runtime boundary는 없다. 정적 데이터 레코드와 기존 validator가 요구 동작을 담기에 충분하며 더 강한 경계는 독립 소유권이나 격리를 제공하지 않는다.

## 5.3 System Interaction Flow

해당 없음 — 신규 시스템 상호작용은 없다. 기존 web → curriculum/challenge data → compiler/simulator/challenge runner 흐름을 재사용한다.

## 5.4 Synchronous Communication

새 통신 계약은 해당 없음. 브라우저 내 기존 동기 compiler/challenge 실행 흐름을 변경하지 않는다.

## 5.5 API Contracts

해당 없음 — 신규 HTTP, RPC 또는 공개 API가 없다.

## 5.6 Asynchronous Communication

해당 없음 — 메시지 브로커나 비동기 서비스 통신이 없다.

## 5.7 Message Contracts

해당 없음 — 신규 message/event contract가 없다.

## 5.8 Data Ownership

`curriculum/core/learning.json`은 이 chapter의 학습 설명을 소유한다. chapter/challenge 연결과 시퀀스/구조 검증 데이터는 기존 curriculum manifest 및 challenge 파일 계약의 소유다. 시뮬레이션 상태와 사용자 프로젝트/완료 정보는 기존 runtime/browser-local 경계를 유지한다. 서버 저장소를 추가하지 않는다.

## 5.9 Schema Changes

새 schema version이나 저장 스키마 변경은 없다. `learning.json`의 기존 형식에 `cpu.instruction-register4`의 누락된 레코드를 추가한다. 기존 challenge 형식과 필드 의미를 바꾸지 않는다.

## 5.10 Consistency Model

정적 curriculum 자산의 일관성은 manifest의 chapter 참조, learning entry, challenge 파일 사이의 기존 식별자 계약으로 확인한다. 동작 판정은 기존 결정적 simulator와 challenge sequence validator가 담당한다. 분산 트랜잭션 또는 복제 일관성은 해당 없음.

## 5.11 Infrastructure Dependencies

신규 인프라 의존성 없음. 정적 자산 배포, 브라우저, 기존 compiler/simulator/test tooling을 사용한다.

## 5.12 External Dependency Isolation

외부 시스템이 없으므로 격리 어댑터/ACL은 해당 없음.

## 5.13 File and Module Structure

### Existing Structure

- `curriculum/core/manifest.json`: chapter 목록 및 challenge 참조
- `curriculum/core/learning.json`: chapter 학습 콘텐츠
- `curriculum/core/30-instruction-register4.challenge.json`: chapter validator/interface 정의
- `apps/web/src/App.tsx`: 정적 curriculum 로딩 및 상세 learning panel
- `apps/web/src/Journey.tsx`: 기존 CPU Journey 및 IR scene
- `packages/circuit-compiler/src/compiler.ts`: `user.register4` 컴파일
- `packages/sim-core/src/primitives.ts`: Register4 primitive 동작
- `tests/extended-curriculum.test.ts`: curriculum 계약 검증
- `e2e/v01-flow.e2e.ts`: 브라우저 사용자 흐름 검증

### Target Structure

동일한 구조를 유지한다. 누락된 learning entry를 기존 `learning.json`에 추가하고, curriculum contract를 유지하며, 기존 브라우저 E2E를 조립/제출 성공 확인까지 확장한다. challenge, manifest, Journey, compiler, simulator 변경은 요구되지 않는다.

### File Change Map

| 파일 | 변경 |
|---|---|
| `curriculum/core/learning.json` | IR4 학습 콘텐츠 추가 |
| `tests/extended-curriculum.test.ts` | 기존 learning/validator 계약 assertion 필요 시 보강 |
| `e2e/v01-flow.e2e.ts` | 허용된 Register4 조립 및 제출 후 캡처/유지 통과를 실제 브라우저에서 확인 |
| 그 외 명시 파일 | 변경하지 않음. 새 설계 근거가 발견될 때만 조건부 재검토 |

# 6. Runtime Design

## 6.1 Runtime Flow

기존 web app 정적 JSON 로딩 → chapter/challenge 표시 → 회로 편집 → compiler → deterministic simulator → sequence/structural validator 결과 흐름이다. Register4 상태 갱신 시점과 LOAD 조건은 기존 simulator 의미를 그대로 따른다.

## 6.2 Concurrent Access

해당 없음 — 새 공유 서버 상태나 동시 writer가 없다.

## 6.3 Concurrency Control

해당 없음 — 신규 동시성 제어가 필요하지 않다.

## 6.4 Ordering

validator sequence가 지정하는 순서가 중요하다. 먼저 LOAD=1로 한 값을 캡처한 다음 다른 입력과 LOAD=0을 적용해 rising edge를 발생시키고 앞선 값의 유지를 확인한다. 기존 deterministic simulator와 sequence validator를 사용한다.

## 6.5 Transaction Boundaries

해당 없음 — 데이터 레코드 편집 외에 신규 런타임 transaction/persistence 경계가 없다.

## 6.6 Idempotency

해당 없음 — 새 외부 명령이나 중복 처리 경로가 없다. 동일 회로 및 동일 입력 시뮬레이션 결과는 기존 결정성 원칙을 따른다.

## 6.7 Partial Failure

새 분산 부분 실패 모드는 해당 없음. 기존 challenge 실행 실패는 기존 validator 결과와 UI 피드백으로 귀결된다. 학습 데이터 누락/로드 실패는 기존 curriculum 로딩 실패 경로를 따른다.

# 7. Error Handling and Recovery

## 7.1 Failure and Recovery Flow

해당 없음 — 별도 복구 workflow가 없다. challenge 실패는 사용자가 회로를 수정하고 기존 방식으로 다시 검증하는 흐름을 따른다.

## 7.2 Error Classification

신규 error class 없음. 구조 조건 실패와 동작 시퀀스 실패는 기존 challenge 검증 결과로 분류된다.

## 7.3 Retry Policy

해당 없음 — backend retry가 없다. 재실행은 기존 challenge 제출 동작이다.

## 7.4 Compensation

해당 없음 — 보상 트랜잭션이 없다.

## 7.5 Recovery

별도 자동 복구는 없다. 사용자는 기존 편집/재제출 흐름으로 회로를 수정한다. 정적 파일 배포 복구는 기존 배포 절차에 속한다.

## 7.6 Rollback

애플리케이션 상태 rollback 설계 변경은 해당 없음. 파일 변경은 기존 버전 관리 절차로 되돌릴 수 있다.

# 8. Security

## 8.1 Authentication and Authorization

해당 없음 — 인증/인가 범위를 변경하지 않는다.

## 8.2 Input Validation

입력 폭과 포트 계약, 허용 component, 구조 제한 및 동작 시퀀스는 기존 challenge/validator 계약이 확인한다. 새 검증 경계는 도입하지 않는다.

## 8.3 Sensitive Data

해당 없음 — 개인정보나 민감정보가 추가되지 않는다.

## 8.4 Secrets

해당 없음 — secret이나 credential이 필요하지 않다.

# 9. Observability

## 9.1 Logs

신규 로그 요구사항 없음. 기존 challenge 실행의 사용자 피드백과 오류 표시를 재사용한다.

## 9.2 Metrics

신규 metric 없음.

## 9.3 Tracing

신규 distributed tracing 없음. 기존 시뮬레이션 trace 동작을 변경하지 않는다.

## 9.4 Alerts

신규 alert 없음.

# 10. Change Boundaries

## 10.1 Allowed Changes

- `curriculum/core/learning.json`에 `cpu.instruction-register4` 학습 레코드 추가
- 필요한 경우 `tests/extended-curriculum.test.ts`에서 이미 정해진 learning/challenge contract assertion 보강
- `e2e/v01-flow.e2e.ts`에서 실제 사용자 관점의 Register4 조립/제출 및 캡처·유지 성공 검증 추가

## 10.2 Forbidden Changes

- opcode decoding, fetch path, Memory Address Register, reset, 첫 캡처 이전 초기값 요구 추가
- 특정 CPU/instruction 의미를 플랫폼 compiler 또는 simulator에 하드코딩
- 새 bounded context, module, service, persistence/API/message boundary 추가
- chapter manifest, challenge interface/validator 의미, 기존 Journey 항목을 불필요하게 재설계
- 기존 `Register4` 동작을 변경하거나 정적 데이터 기반 콘텐츠를 chapter 전용 UI 코드로 하드코딩

## 10.3 Conditional Changes

허용된 회로를 브라우저에서 구성·제출하는 데 기존 editor/E2E helper가 부족한 것으로 확인될 경우에만 필요한 최소 test helper 조정을 허용한다. 제품/플랫폼 runtime 변경은 별도 근거와 결정 없이 허용하지 않는다.

# 11. Verification Requirements

## 11.1 Domain Verification

- `cpu.instruction-register4` learning entry의 존재와 기존 chapter 식별자 일치 확인
- challenge가 `INSTRUCTION[4]`, `LOAD`, `CLK` 입력과 `IR[4]` 출력을 유지하는지 확인
- 허용 component `user.register4` 및 structural max 1 유지 확인
- sequence validator가 최초 캡처 이후 LOAD=1 capture 및 LOAD=0 hold를 확인하는지 검증
- opcode, reset, 첫 캡처 전 값이 요구사항으로 추가되지 않았는지 확인

## 11.2 Program Verification

- curriculum contract test에서 manifest/interface/validator/learning 관계 검증
- browser E2E에서 CPU chapter 진입, learning heading/formula 표시, Register4 palette 확인
- E2E가 허용된 `user.register4`를 실제로 조립하고 challenge를 제출하여 capture/hold 성공 결과를 관찰

## 11.3 Technical Contract Verification

- learning entry는 기존 schema와 loader 계약 사용
- manifest/challenge 경로와 ID가 일치
- compiler/simulator/validator의 기존 책임 경계를 변경하지 않음
- 새 API, 메시지, 데이터베이스, module/context/service가 없음

## 11.4 Runtime Verification

- 동일 회로 및 validator 입력에서 결정적인 성공 결과 확인
- 시퀀스가 첫 캡처를 먼저 수행하고 유지 단계에서 입력 변경 후 이전 IR을 관찰하는지 확인

## 11.5 Recovery Verification

별도 recovery contract 해당 없음. 실패한 회로 제출이 기존 challenge 실패 피드백으로 반환되는 동작을 유지한다.

## 11.6 Agent Verifier Criteria

### Domain

- [ ] `UC-IR4-001`, `AC-IR4-001`–`AC-IR4-004`가 그대로 반영됨
- [ ] 첫 캡처 전 IR 값과 reset을 검증하지 않음
- [ ] opcode 의미 및 주변 datapath 기능을 추가하지 않음

### Program Design

- [ ] 누락된 학습 콘텐츠가 정적 learning 데이터에 추가됨
- [ ] 실제 브라우저 E2E가 허용 회로를 조립하고 제출함
- [ ] 캡처와 유지 validator 결과를 확인함

### Technical Architecture

- [ ] 신규 context/module/service/API/message/persistence 경계 없음
- [ ] 기존 compiler/simulator/challenge runner 책임 재사용
- [ ] 데이터와 challenge 계약이 chapter ID로 일치

### Runtime

- [ ] 캡처 후 hold 순서 검증
- [ ] 결정적 시뮬레이션 원칙 준수

### Scope

- [ ] 허용 파일/변경만 수행
- [ ] Journey, manifest, challenge 및 runtime 동작을 불필요하게 바꾸지 않음

### Evidence

- 실행 명령: contract test 및 설정된 E2E runner/`docs/agents/EXEC.md`에 따른 실제 브라우저 E2E
- 테스트 결과: 구현 후 기록
- 변경 파일: `curriculum/core/learning.json`, 필요한 contract test, `e2e/v01-flow.e2e.ts`
- Architecture 위반: 없음이어야 함
- Contract 위반: 없음이어야 함
- 미검증 항목: 없음이어야 함
- Human Review 항목: 없음

# 12. Alternatives and Trade-offs

| Decision | Option | Advantages | Disadvantages | Result |
|---|---|---|---|---|
| 학습 설명 제공 | 기존 정적 learning entry | 현재 loader/view 계약을 재사용하고 구조 변경이 작음 | chapter 데이터 레코드를 추가해야 함 | Adopt |
| 학습 설명 제공 | chapter 전용 UI 로직 | 해당 chapter에 직접 결합 | 데이터 기반 curriculum 패턴을 깨고 UI 하드코딩 증가 | Reject |
| IR 동작 검증 | 기존 `Register4`와 sequence validator 재사용 | 제품 동작을 기존 simulator 및 validator 경계에서 검사 | E2E에 회로 조립/제출 단계를 추가해야 함 | Adopt |
| IR 동작 구현 | IR 전용 primitive/validator/context 추가 | 격리된 이름 공간을 제공할 수 있음 | 동일 동작 중복, 불필요한 구조와 유지비, 플랫폼 CPU 하드코딩 위험 | Reject |

# 13. Risks and Open Questions

## 13.1 Risks

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| 학습 JSON entry와 chapter ID가 불일치 | 상세 학습 패널이 나타나지 않거나 잘못 연결됨 | Medium | contract test에서 manifest/learning/challenge 식별자 일치 확인 |
| E2E가 화면 안내만 확인하고 동작 제출을 생략 | 회로 편집부터 validator까지 사용자 경험이 확인되지 않음 | Medium | 실제 Register4 구성 및 제출 성공을 E2E acceptance에 포함 |
| 초기 IR 상태를 잘못된 기대값으로 고정 | Product Spec 범위 밖 초기값 계약이 생김 | Low | 첫 캡처 이후 시퀀스만 비교하고 unknown 초기값을 검사하지 않음 |

## 13.2 Open Questions

| Question | Blocking | Resolution |
|---|---|---|
| 없음 | No | Product behavior 및 최소 아키텍처 경계가 제공된 입력으로 확정됨 |

# Architecture 다이어그램 계약

- Event-storming flow: 해당 없음 — 새 도메인 command/event/policy 흐름이 없음.
- Bounded-context/context-map 다이어그램: 해당 없음 — 신규 context나 context 간 관계가 없음.
- Class diagram: 해당 없음 — 신규 구조 모델 또는 클래스 책임이 없음.
- Design-state diagram: 해당 없음 — 설계 상태 모델이 없으며 기존 Register4 업무/학습 전이는 Product Spec과 동일한 목적임.
- System-interaction diagram: 해당 없음 — 신규 시스템/외부 연동이 없음.
- Architecture `.puml`/SVG inventory: 없음. 기존 simulator state behavior를 변경 없이 재사용하므로 ticket-scoped architecture diagram을 만들지 않는다.
