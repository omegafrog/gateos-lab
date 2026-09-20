import {
  componentPins,
  type CircuitDefinition,
  type CircuitEndpoint,
  type CompiledNet,
  type CompiledNetlist,
  type CompiledNode,
  type ComponentRegistry,
  type ComponentSpec,
  type PinDefinition,
} from "@gateos/circuit-model";

class UnionFind {
  readonly #parent = new Map<string, string>();
  readonly #width = new Map<string, number>();

  add(key: string, width: number): void {
    const existing = this.#width.get(key);
    if (existing !== undefined && existing !== width) {
      throw new Error(`Endpoint width changed for ${key}: ${existing} -> ${width}`);
    }
    if (!this.#parent.has(key)) this.#parent.set(key, key);
    this.#width.set(key, width);
  }

  find(key: string): string {
    const parent = this.#parent.get(key);
    if (!parent) throw new Error(`Unknown endpoint: ${key}`);
    if (parent === key) return key;
    const root = this.find(parent);
    this.#parent.set(key, root);
    return root;
  }

  union(a: string, b: string): void {
    const widthA = this.widthOf(a);
    const widthB = this.widthOf(b);
    if (widthA !== widthB) {
      throw new Error(`Cannot connect ${widthA}-bit endpoint to ${widthB}-bit endpoint`);
    }

    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;

    const [root, child] = rootA < rootB ? [rootA, rootB] : [rootB, rootA];
    this.#parent.set(child, root);
  }

  widthOf(key: string): number {
    const width = this.#width.get(key);
    if (width === undefined) throw new Error(`Unknown endpoint width: ${key}`);
    return width;
  }

  entries(): readonly string[] {
    return [...this.#parent.keys()];
  }
}

interface PendingPrimitive {
  id: string;
  primitiveId: string;
  sourcePath: string;
  params: Readonly<Record<string, unknown>>;
  pins: readonly PinDefinition[];
  vertices: Readonly<Record<string, string>>;
}

function interfaceVertex(path: string, pinId: string): string {
  return `${path}::self::${pinId}`;
}

function instanceVertex(path: string, instanceId: string, pinId: string): string {
  return `${path}::inst:${instanceId}::${pinId}`;
}

function endpointVertex(path: string, endpoint: CircuitEndpoint): string {
  return endpoint.kind === "interface"
    ? interfaceVertex(path, endpoint.pinId)
    : instanceVertex(path, endpoint.instanceId, endpoint.pinId);
}

export function compileCircuit(
  circuit: CircuitDefinition,
  registry: ComponentRegistry,
): CompiledNetlist {
  const uf = new UnionFind();
  const primitives: PendingPrimitive[] = [];
  const recursionStack: string[] = [];

  function walk(current: CircuitDefinition, path: string): void {
    if (recursionStack.includes(current.id)) {
      const cycle = [...recursionStack, current.id].join(" -> ");
      throw new Error(`Recursive component dependency: ${cycle}`);
    }
    recursionStack.push(current.id);

    const interfacePins = new Map(current.pins.map((pin) => [pin.id, pin]));
    for (const pin of current.pins) {
      uf.add(interfaceVertex(path, pin.id), pin.width);
    }

    const instances = new Map(current.instances.map((instance) => [instance.id, instance]));
    const specs = new Map<string, ComponentSpec>();

    for (const instance of current.instances) {
      const spec = registry.get(instance.componentId);
      specs.set(instance.id, spec);
      for (const pin of componentPins(spec)) {
        uf.add(instanceVertex(path, instance.id, pin.id), pin.width);
      }
    }

    function assertEndpoint(endpoint: CircuitEndpoint): void {
      if (endpoint.kind === "interface") {
        if (!interfacePins.has(endpoint.pinId)) {
          throw new Error(`Unknown interface pin ${endpoint.pinId} in ${current.id}`);
        }
        return;
      }

      const instance = instances.get(endpoint.instanceId);
      if (!instance) {
        throw new Error(`Unknown instance ${endpoint.instanceId} in ${current.id}`);
      }
      const spec = specs.get(instance.id);
      if (!spec || !componentPins(spec).some((pin) => pin.id === endpoint.pinId)) {
        throw new Error(
          `Unknown pin ${endpoint.pinId} on instance ${endpoint.instanceId}`,
        );
      }
    }

    for (const connection of current.connections) {
      assertEndpoint(connection.from);
      assertEndpoint(connection.to);
      uf.union(
        endpointVertex(path, connection.from),
        endpointVertex(path, connection.to),
      );
    }

    for (const instance of current.instances) {
      const spec = specs.get(instance.id);
      if (!spec) throw new Error(`Missing spec for instance ${instance.id}`);

      if (spec.kind === "primitive") {
        const vertices: Record<string, string> = {};
        for (const pin of spec.pins) {
          vertices[pin.id] = instanceVertex(path, instance.id, pin.id);
        }
        primitives.push({
          id: `${path}/${instance.id}`,
          primitiveId: spec.primitiveId,
          sourcePath: `${path}/${instance.id}`,
          params: instance.params ?? {},
          pins: spec.pins,
          vertices,
        });
        continue;
      }

      // Published registers are validated sequential abstractions. Reusing them
      // in Counter/PC/RAM should preserve their edge-triggered state boundary
      // instead of exposing their internal feedback network to the parent
      // zero-delay combinational solver.
      if (
        spec.id === "user.enable-register" ||
        spec.id === "user.register4"
      ) {
        const pins = new Map(spec.circuit.pins.map((pin) => [pin.id, pin]));
        const d = pins.get("d");
        const load = pins.get("load");
        const clk = pins.get("clk");
        const q = pins.get("q");
        if (
          !d ||
          d.direction !== "input" ||
          !load ||
          load.direction !== "input" ||
          load.width !== 1 ||
          !clk ||
          clk.direction !== "input" ||
          clk.width !== 1 ||
          !q ||
          q.direction !== "output" ||
          q.width !== d.width
        ) {
          throw new Error(
            `Published ${spec.id} must expose D[width], 1-bit LOAD, 1-bit CLK and matching Q[width]`,
          );
        }

        const vertices: Record<string, string> = {};
        for (const pin of spec.circuit.pins) {
          vertices[pin.id] = instanceVertex(path, instance.id, pin.id);
        }
        primitives.push({
          id: `${path}/${instance.id}`,
          primitiveId: "builtin.user-register",
          sourcePath: `${path}/${instance.id}`,
          params: {
            ...(instance.params ?? {}),
            width: d.width,
          },
          pins: spec.circuit.pins,
          vertices,
        });
        continue;
      }

      // Once the learner has published the DFF challenge, reuse it as an
      // edge-triggered state boundary instead of flattening its latch gates
      // into the parent combinational graph. The original composite circuit is
      // still retained in the registry for inspection/editing.
      if (spec.id === "user.dff") {
        const requiredPins = new Map(spec.circuit.pins.map((pin) => [pin.id, pin]));
        const d = requiredPins.get("d");
        const clk = requiredPins.get("clk");
        const q = requiredPins.get("q");
        if (
          !d ||
          d.direction !== "input" ||
          d.width !== 1 ||
          !clk ||
          clk.direction !== "input" ||
          clk.width !== 1 ||
          !q ||
          q.direction !== "output" ||
          q.width !== 1
        ) {
          throw new Error(
            "Published user.dff must expose 1-bit D, CLK inputs and 1-bit Q output",
          );
        }

        const vertices: Record<string, string> = {};
        for (const pin of spec.circuit.pins) {
          vertices[pin.id] = instanceVertex(path, instance.id, pin.id);
        }
        primitives.push({
          id: `${path}/${instance.id}`,
          primitiveId: "builtin.user-dff",
          sourcePath: `${path}/${instance.id}`,
          params: instance.params ?? {},
          pins: spec.circuit.pins,
          vertices,
        });
        continue;
      }

      const childPath = `${path}/${instance.id}`;
      walk(spec.circuit, childPath);

      for (const pin of spec.circuit.pins) {
        uf.union(
          instanceVertex(path, instance.id, pin.id),
          interfaceVertex(childPath, pin.id),
        );
      }
    }

    recursionStack.pop();
  }

  walk(circuit, "root");

  const verticesByRoot = new Map<string, string[]>();
  for (const vertex of [...uf.entries()].sort()) {
    const root = uf.find(vertex);
    const group = verticesByRoot.get(root) ?? [];
    group.push(vertex);
    verticesByRoot.set(root, group);
  }

  const roots = [...verticesByRoot.keys()].sort();
  const netIdByRoot = new Map<string, string>();
  const nets: CompiledNet[] = roots.map((root, index) => {
    const id = `net:${index}`;
    netIdByRoot.set(root, id);
    const sourceVertices = verticesByRoot.get(root) ?? [];
    return {
      id,
      width: uf.widthOf(root),
      sourceVertices,
    };
  });

  function netFor(vertex: string): string {
    const net = netIdByRoot.get(uf.find(vertex));
    if (!net) throw new Error(`No net generated for ${vertex}`);
    return net;
  }

  const nodes: CompiledNode[] = primitives
    .map((primitive) => {
      const inputs: Record<string, string> = {};
      const outputs: Record<string, string> = {};

      for (const pin of primitive.pins) {
        const vertex = primitive.vertices[pin.id];
        if (!vertex) throw new Error(`Missing vertex for ${primitive.id}.${pin.id}`);
        const net = netFor(vertex);

        if (pin.direction === "input" || pin.direction === "inout") {
          inputs[pin.id] = net;
        }
        if (pin.direction === "output" || pin.direction === "inout") {
          outputs[pin.id] = net;
        }
      }

      return {
        id: primitive.id,
        primitiveId: primitive.primitiveId,
        sourcePath: primitive.sourcePath,
        params: primitive.params,
        inputs,
        outputs,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const rootInputs: Record<string, string> = {};
  const rootOutputs: Record<string, string> = {};

  for (const pin of circuit.pins) {
    const net = netFor(interfaceVertex("root", pin.id));
    if (pin.direction === "input" || pin.direction === "inout") {
      rootInputs[pin.id] = net;
    }
    if (pin.direction === "output" || pin.direction === "inout") {
      rootOutputs[pin.id] = net;
    }
  }

  return {
    schema: "gateos.netlist/v1",
    circuitId: circuit.id,
    nets,
    nodes,
    rootInputs,
    rootOutputs,
  };
}
