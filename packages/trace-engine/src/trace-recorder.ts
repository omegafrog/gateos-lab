import {
  type Simulator,
  type SimulatorSnapshot,
} from "@gateos/sim-core";

export interface TraceValueChange<T> {
  before: T;
  after: T;
}

export interface TraceSequentialChange {
  nodeId: string;
  primitiveId: string;
  before: unknown;
  after: unknown;
}

export interface TraceInputChange {
  pinId: string;
  before: string;
  after: string;
}

export interface TraceFrame {
  index: number;
  label?: string;
  cycleBefore: number;
  cycleAfter: number;
  inputChanges: readonly TraceInputChange[];
  stateChanges: readonly TraceSequentialChange[];
  signalSamples: Readonly<Record<string, string>>;
  memoryChanges: readonly [];
}

export interface TraceRecorderOptions {
  maxFrames?: number;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneSnapshot(snapshot: SimulatorSnapshot): SimulatorSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as SimulatorSnapshot;
}

export class TraceRecorder {
  readonly #simulator: Simulator;
  readonly #watched = new Set<string>();
  readonly #frames: TraceFrame[] = [];
  readonly #maxFrames: number;
  #snapshot: SimulatorSnapshot;
  #nextIndex = 1;

  constructor(
    simulator: Simulator,
    options: TraceRecorderOptions = {},
  ) {
    this.#simulator = simulator;
    this.#maxFrames = options.maxFrames ?? 256;

    if (!Number.isInteger(this.#maxFrames) || this.#maxFrames < 1) {
      throw new Error(`Invalid trace maxFrames: ${this.#maxFrames}`);
    }

    this.#snapshot = cloneSnapshot(simulator.snapshot());
  }

  get frames(): readonly TraceFrame[] {
    return this.#frames;
  }

  get canRewind(): boolean {
    return this.#frames.length > 0;
  }

  watch(netId: string): void {
    this.#watched.add(netId);
  }

  unwatch(netId: string): void {
    this.#watched.delete(netId);
  }

  clearWatches(): void {
    this.#watched.clear();
  }

  clear(): void {
    this.#frames.length = 0;
    this.#snapshot = cloneSnapshot(this.#simulator.snapshot());
    this.#nextIndex = 1;
  }

  capture(label?: string): TraceFrame {
    const next = cloneSnapshot(this.#simulator.snapshot());

    const inputChanges: TraceInputChange[] = [];
    const inputIds = new Set([
      ...Object.keys(this.#snapshot.inputs),
      ...Object.keys(next.inputs),
    ]);

    for (const pinId of [...inputIds].sort()) {
      const before = this.#snapshot.inputs[pinId];
      const after = next.inputs[pinId];
      if (before === undefined || after === undefined || before === after) continue;
      inputChanges.push({ pinId, before, after });
    }

    const stateChanges: TraceSequentialChange[] = [];
    const nodeIds = new Set([
      ...Object.keys(this.#snapshot.sequential),
      ...Object.keys(next.sequential),
    ]);

    for (const nodeId of [...nodeIds].sort()) {
      const before = this.#snapshot.sequential[nodeId];
      const after = next.sequential[nodeId];
      if (!before || !after) continue;

      if (
        before.primitiveId !== after.primitiveId ||
        !jsonEqual(before.state, after.state)
      ) {
        stateChanges.push({
          nodeId,
          primitiveId: after.primitiveId,
          before: before.state,
          after: after.state,
        });
      }
    }

    const signalSamples: Record<string, string> = {};
    for (const netId of [...this.#watched].sort()) {
      signalSamples[netId] = this.#simulator.readNet(netId).toBinary();
    }

    const frame: TraceFrame = {
      index: this.#nextIndex,
      ...(label === undefined ? {} : { label }),
      cycleBefore: this.#snapshot.cycle,
      cycleAfter: next.cycle,
      inputChanges,
      stateChanges,
      signalSamples,
      memoryChanges: [],
    };

    this.#nextIndex += 1;
    this.#frames.push(frame);
    if (this.#frames.length > this.#maxFrames) {
      this.#frames.shift();
    }

    this.#snapshot = next;
    return frame;
  }

  rewind(): TraceFrame | null {
    const frame = this.#frames.pop();
    if (!frame) return null;

    const previous = cloneSnapshot(this.#snapshot);
    previous.cycle = frame.cycleBefore;

    for (const change of frame.inputChanges) {
      previous.inputs[change.pinId] = change.before;
    }

    for (const change of frame.stateChanges) {
      const entry = previous.sequential[change.nodeId];
      if (!entry) {
        throw new Error(
          `Cannot rewind missing sequential node ${change.nodeId}`,
        );
      }
      entry.primitiveId = change.primitiveId;
      entry.state = change.before;
    }

    this.#simulator.restore(previous);
    this.#snapshot = cloneSnapshot(previous);
    return frame;
  }
}
