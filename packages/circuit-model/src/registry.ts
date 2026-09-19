import type { ComponentSpec } from "./types.js";

export class ComponentRegistry {
  readonly #components = new Map<string, ComponentSpec>();

  constructor(initial: readonly ComponentSpec[] = []) {
    for (const component of initial) this.register(component);
  }

  register(component: ComponentSpec): void {
    if (this.#components.has(component.id)) {
      throw new Error(`Component already registered: ${component.id}`);
    }
    this.#components.set(component.id, component);
  }

  get(id: string): ComponentSpec {
    const component = this.#components.get(id);
    if (!component) throw new Error(`Unknown component: ${id}`);
    return component;
  }

  has(id: string): boolean {
    return this.#components.has(id);
  }

  values(): readonly ComponentSpec[] {
    return [...this.#components.values()];
  }
}

export function componentPins(component: ComponentSpec) {
  return component.kind === "primitive" ? component.pins : component.circuit.pins;
}
