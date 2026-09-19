export type PinDirection = "input" | "output" | "inout";

export interface PinDefinition {
  id: string;
  name: string;
  direction: PinDirection;
  width: number;
}

export type CircuitEndpoint =
  | {
      kind: "interface";
      pinId: string;
    }
  | {
      kind: "instance";
      instanceId: string;
      pinId: string;
    };

export interface WireRoutePoint {
  x: number;
  y: number;
}

export interface CircuitConnection {
  id: string;
  from: CircuitEndpoint;
  to: CircuitEndpoint;
  route?: readonly WireRoutePoint[];
  /**
   * Optional visual-only start point for a branch. The compiler still treats
   * `from` as the electrical source, so multiple branches share one net.
   */
  branchStart?: WireRoutePoint;
}

export interface ComponentInstance {
  id: string;
  componentId: string;
  params?: Readonly<Record<string, unknown>>;
  position?: {
    x: number;
    y: number;
  };
}

export interface CircuitDefinition {
  schema: "gateos.circuit/v1";
  id: string;
  name: string;
  pins: readonly PinDefinition[];
  instances: readonly ComponentInstance[];
  connections: readonly CircuitConnection[];
  layout?: Readonly<Record<string, unknown>>;
}

export interface PrimitiveComponentSpec {
  kind: "primitive";
  id: string;
  name: string;
  primitiveId: string;
  pins: readonly PinDefinition[];
}

export interface CompositeComponentSpec {
  kind: "composite";
  id: string;
  name: string;
  circuit: CircuitDefinition;
}

export type ComponentSpec = PrimitiveComponentSpec | CompositeComponentSpec;

export interface CompiledNet {
  id: string;
  width: number;
  sourceVertices: readonly string[];
}

export interface CompiledNode {
  id: string;
  primitiveId: string;
  sourcePath: string;
  params: Readonly<Record<string, unknown>>;
  inputs: Readonly<Record<string, string>>;
  outputs: Readonly<Record<string, string>>;
}

export interface CompiledNetlist {
  schema: "gateos.netlist/v1";
  circuitId: string;
  nets: readonly CompiledNet[];
  nodes: readonly CompiledNode[];
  rootInputs: Readonly<Record<string, string>>;
  rootOutputs: Readonly<Record<string, string>>;
}
