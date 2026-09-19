import {
  BitVector,
  resolveLogicDrivers,
  type CompiledNetlist,
  type CompiledNode,
} from "@gateos/circuit-model";
import type {
  ClockEdge,
  PrimitiveInputs,
  PrimitiveRegistry,
} from "./primitives.js";

export interface SimulatorSnapshot {
  schema: "gateos.sim-state/v1";
  cycle: number;
  sequential: Record<
    string,
    {
      primitiveId: string;
      state: unknown;
    }
  >;
}

export class OscillationError extends Error {
  constructor(readonly iterations: number) {
    super(
      `Combinational circuit did not settle after ${iterations} evaluations. Possible oscillation.`,
    );
    this.name = "OscillationError";
  }
}

export class Simulator {
  readonly #netlist: CompiledNetlist;
  readonly #primitives: PrimitiveRegistry;
  readonly #netWidths = new Map<string, number>();
  readonly #netValues = new Map<string, BitVector>();
  readonly #drivers = new Map<string, Map<string, BitVector>>();
  readonly #consumers = new Map<string, Set<string>>();
  readonly #nodes = new Map<string, CompiledNode>();
  readonly #sequentialState = new Map<string, unknown>();
  readonly #queue: string[] = [];
  readonly #queued = new Set<string>();
  #cycle = 0;

  constructor(netlist: CompiledNetlist, primitives: PrimitiveRegistry) {
    this.#netlist = netlist;
    this.#primitives = primitives;

    for (const net of netlist.nets) {
      this.#netWidths.set(net.id, net.width);
      this.#netValues.set(net.id, BitVector.unknown(net.width));
      this.#drivers.set(net.id, new Map());
      this.#consumers.set(net.id, new Set());
    }

    for (const [pinId, netId] of Object.entries(netlist.rootInputs)) {
      this.setDriver(
        netId,
        `root-input:${pinId}`,
        BitVector.unknown(this.widthOf(netId)),
      );
    }

    for (const node of netlist.nodes) {
      this.#nodes.set(node.id, node);

      if (this.#primitives.isSequential(node.primitiveId)) {
        const definition = this.#primitives.getSequential(node.primitiveId);
        const state = definition.createState(node.params, node);
        this.#sequentialState.set(node.id, state);

        const outputs = definition.outputs(state, node.params, node);
        for (const [pinId, netId] of Object.entries(node.outputs)) {
          const value = outputs[pinId];
          if (!value) {
            throw new Error(
              `Sequential primitive ${node.primitiveId} did not initialize output ${pinId}`,
            );
          }
          this.assertWidth(netId, value);
          this.setDriver(netId, `node:${node.id}:${pinId}`, value);
        }
        continue;
      }

      for (const netId of Object.values(node.inputs)) {
        this.#consumers.get(netId)?.add(node.id);
      }

      for (const [pinId, netId] of Object.entries(node.outputs)) {
        this.setDriver(
          netId,
          `node:${node.id}:${pinId}`,
          BitVector.unknown(this.widthOf(netId)),
        );
      }

      this.enqueue(node.id);
    }

    // Sequential outputs may feed combinational nodes that were registered later.
    // Every combinational node is already enqueued once, so the first settle()
    // computes a complete stable state.
  }

  get cycle(): number {
    return this.#cycle;
  }

  setInput(pinId: string, value: BitVector): void {
    const netId = this.#netlist.rootInputs[pinId];
    if (!netId) throw new Error(`Unknown root input: ${pinId}`);
    this.assertWidth(netId, value);
    this.setDriver(netId, `root-input:${pinId}`, value);
  }

  readOutput(pinId: string): BitVector {
    const netId = this.#netlist.rootOutputs[pinId];
    if (!netId) throw new Error(`Unknown root output: ${pinId}`);
    return this.readNet(netId);
  }

  readNet(netId: string): BitVector {
    const value = this.#netValues.get(netId);
    if (!value) throw new Error(`Unknown net: ${netId}`);
    return value;
  }

  settle(maxEvaluations = 10_000): number {
    let evaluations = 0;

    while (this.#queue.length > 0) {
      if (evaluations >= maxEvaluations) {
        throw new OscillationError(evaluations);
      }

      const nodeId = this.#queue.shift();
      if (!nodeId) break;
      this.#queued.delete(nodeId);

      const node = this.#nodes.get(nodeId);
      if (!node) throw new Error(`Unknown node: ${nodeId}`);
      if (this.#primitives.isSequential(node.primitiveId)) {
        continue;
      }

      const inputs = this.readNodeInputs(node);
      const outputs = this.#primitives.get(node.primitiveId)(
        inputs,
        node.params,
        node,
      );

      for (const [pinId, value] of Object.entries(outputs)) {
        const netId = node.outputs[pinId];
        if (!netId) {
          throw new Error(
            `Primitive ${node.primitiveId} produced undeclared output ${pinId}`,
          );
        }
        this.assertWidth(netId, value);
        this.setDriver(netId, `node:${node.id}:${pinId}`, value);
      }

      evaluations += 1;
    }

    return evaluations;
  }

  stepEdge(edge: ClockEdge): void {
    this.settle();

    const nextStates = new Map<string, unknown>();

    for (const node of this.#netlist.nodes) {
      if (!this.#primitives.isSequential(node.primitiveId)) continue;

      const definition = this.#primitives.getSequential(node.primitiveId);
      const state = this.#sequentialState.get(node.id);
      if (state === undefined) {
        throw new Error(`Missing sequential state for ${node.id}`);
      }

      nextStates.set(
        node.id,
        definition.sample(
          this.readNodeInputs(node),
          state,
          edge,
          node.params,
          node,
        ),
      );
    }

    // Commit only after every sequential primitive sampled the same pre-edge
    // circuit state. This removes update-order dependence.
    for (const [nodeId, nextState] of nextStates) {
      const node = this.#nodes.get(nodeId);
      if (!node) throw new Error(`Unknown node: ${nodeId}`);

      const definition = this.#primitives.getSequential(node.primitiveId);
      this.#sequentialState.set(nodeId, nextState);

      const outputs = definition.outputs(nextState, node.params, node);
      for (const [pinId, value] of Object.entries(outputs)) {
        const netId = node.outputs[pinId];
        if (!netId) {
          throw new Error(
            `Sequential primitive ${node.primitiveId} produced undeclared output ${pinId}`,
          );
        }
        this.assertWidth(netId, value);
        this.setDriver(netId, `node:${node.id}:${pinId}`, value);
      }
    }

    this.settle();

    if (edge === "falling") {
      this.#cycle += 1;
    }
  }

  stepClock(): void {
    this.stepEdge("rising");
    this.stepEdge("falling");
  }

  snapshot(): SimulatorSnapshot {
    const sequential: SimulatorSnapshot["sequential"] = {};

    for (const node of this.#netlist.nodes) {
      if (!this.#primitives.isSequential(node.primitiveId)) continue;

      const state = this.#sequentialState.get(node.id);
      if (state === undefined) {
        throw new Error(`Missing sequential state for ${node.id}`);
      }

      const definition = this.#primitives.getSequential(node.primitiveId);
      sequential[node.id] = {
        primitiveId: node.primitiveId,
        state: definition.serializeState(state, node.params, node),
      };
    }

    return {
      schema: "gateos.sim-state/v1",
      cycle: this.#cycle,
      sequential,
    };
  }

  restore(snapshot: SimulatorSnapshot): void {
    if (snapshot.schema !== "gateos.sim-state/v1") {
      throw new Error(`Unsupported simulator snapshot: ${snapshot.schema}`);
    }
    if (!Number.isInteger(snapshot.cycle) || snapshot.cycle < 0) {
      throw new Error(`Invalid simulator cycle: ${snapshot.cycle}`);
    }

    for (const node of this.#netlist.nodes) {
      if (!this.#primitives.isSequential(node.primitiveId)) continue;

      const entry = snapshot.sequential[node.id];
      if (!entry) {
        throw new Error(`Snapshot is missing state for ${node.id}`);
      }
      if (entry.primitiveId !== node.primitiveId) {
        throw new Error(
          `Snapshot primitive mismatch for ${node.id}: ${entry.primitiveId} !== ${node.primitiveId}`,
        );
      }

      const definition = this.#primitives.getSequential(node.primitiveId);
      const state = definition.deserializeState(
        entry.state,
        node.params,
        node,
      );
      this.#sequentialState.set(node.id, state);

      const outputs = definition.outputs(state, node.params, node);
      for (const [pinId, value] of Object.entries(outputs)) {
        const netId = node.outputs[pinId];
        if (!netId) {
          throw new Error(
            `Sequential primitive ${node.primitiveId} produced undeclared output ${pinId}`,
          );
        }
        this.assertWidth(netId, value);
        this.setDriver(netId, `node:${node.id}:${pinId}`, value);
      }
    }

    this.#cycle = snapshot.cycle;
    this.settle();
  }

  private readNodeInputs(node: CompiledNode): PrimitiveInputs {
    const inputs: Record<string, BitVector> = {};
    for (const [pinId, netId] of Object.entries(node.inputs)) {
      inputs[pinId] = this.readNet(netId);
    }
    return inputs;
  }

  private enqueue(nodeId: string): void {
    if (this.#queued.has(nodeId)) return;
    this.#queued.add(nodeId);
    this.#queue.push(nodeId);
  }

  private widthOf(netId: string): number {
    const width = this.#netWidths.get(netId);
    if (width === undefined) throw new Error(`Unknown net width: ${netId}`);
    return width;
  }

  private assertWidth(netId: string, value: BitVector): void {
    const width = this.widthOf(netId);
    if (value.width !== width) {
      throw new Error(
        `Driver width mismatch for ${netId}: expected ${width}, got ${value.width}`,
      );
    }
  }

  private setDriver(netId: string, driverId: string, value: BitVector): void {
    const drivers = this.#drivers.get(netId);
    if (!drivers) throw new Error(`Unknown net: ${netId}`);

    const previousDriver = drivers.get(driverId);
    if (previousDriver?.equals(value)) return;

    drivers.set(driverId, value);
    const resolved = this.resolveNet(netId);
    const previousNet = this.#netValues.get(netId);

    if (previousNet?.equals(resolved)) return;

    this.#netValues.set(netId, resolved);
    for (const consumer of this.#consumers.get(netId) ?? []) {
      this.enqueue(consumer);
    }
  }

  private resolveNet(netId: string): BitVector {
    const width = this.widthOf(netId);
    const drivers = [...(this.#drivers.get(netId)?.values() ?? [])];

    if (drivers.length === 0) return BitVector.unknown(width);

    return BitVector.fromLSB(
      Array.from({ length: width }, (_, bit) =>
        resolveLogicDrivers(drivers.map((value) => value.get(bit))),
      ),
    );
  }
}
