---
schema_version: 2
kind: split-plan
issue: 2
parent_issue: 1
plan_id: ir4-learning-e2e
status: completed
plan_set_id: instruction-register4
---

# IR4 학습 자료와 실제 회로 E2E 보강

## 상태

completed

## 의존성

없음

## 구현 목적

빠진 상세 학습 설명을 학습자에게 노출하고, 실제 회로 조립부터 challenge 성공까지 브라우저에서 검증한다.

## 범위

- curriculum/core/learning.json에 cpu.instruction-register4의 capture/hold 설명, formal model, invariant, timing, application, common mistake, next-step 정보를 추가한다.
- tests/extended-curriculum.test.ts에서 새 learning entry와 Product Spec 범위 계약을 확인한다.
- e2e/v01-flow.e2e.ts에서 CPU Instruction Register 챕터를 열고 학습 설명을 확인한 뒤 user.register4를 실제로 배치·연결하고 challenge를 제출해 capture/hold 성공을 검증한다.

## 수용 기준

- **AC-IR4-001** — 조건: 학습자가 4-bit 값을 넣고 LOAD=1에서 rising edge를 발생시켜 challenge를 제출한다.; 기대 결과: IR이 그 4-bit 값을 캡처하며 visible/hidden sequence 검증이 통과한다.; 검증: 실제 브라우저 E2E에서 user.register4를 조립하고 제출한 뒤 challenge 성공 상태를 확인한다.
- **AC-IR4-002** — 조건: 첫 capture 뒤 instruction 입력을 바꾸고 LOAD=0에서 rising edge를 발생시킨다.; 기대 결과: IR이 직전 capture 값을 유지한다.; 검증: challenge sequence 계약 테스트와 브라우저 E2E 제출 성공으로 hold sequence를 검증한다.
- **AC-IR4-003** — 조건: 학습자가 챕터를 열어 상세 학습 패널을 확인한다.; 기대 결과: IR 저장 역할, LOAD capture/hold, rising-edge timing, decode 제외 안내가 표시된다.; 검증: curriculum contract test가 learning record fields를 확인하고 브라우저 E2E가 학습 설명의 표시를 확인한다.
- **AC-IR4-004** — 조건: 학습 콘텐츠와 검증 시퀀스가 chapter 범위에 포함된 동작을 정의한다.; 기대 결과: opcode decode, fetch path, Memory Address Register, reset, 첫 capture 전 초기값을 완료 조건으로 요구하지 않는다.; 검증: contract test와 challenge sequence 검토에서 제외 항목이 요구조건 또는 기대 출력으로 추가되지 않았음을 확인한다.

## 요구사항 참조

- AC-IR4-001
- AC-IR4-002
- AC-IR4-003
- AC-IR4-004

## 테스트 계약

- 단위/정책: npm test -- tests/extended-curriculum.test.ts — learning entry, chapter ID, interface/validator contract를 검증한다.
- `ui ~ entity` E2E: 설정된 e2e_test_runner가 docs/agents/EXEC.md 절차로 앱과 필요한 infra를 띄워 실제 브라우저에서 chapter를 열고 Register4를 구성·제출한다. capture/hold pass와 학습 패널 표시를 확인하고 artifact cleanup hook을 실행한다.

## 관련 명세

- Product Spec: docs/specs/instruction-register4/product-spec.md
- Architecture Spec: docs/specs/instruction-register4/architecture-spec.md

## 다이어그램

해당 없음 — 적용 가능한 ticket-scoped SVG가 없음
