// Node's TypeScript stripper does not apply Next's server-only virtual package. The smoke pass
// imports server loaders directly, so resolve that marker to an empty module while preserving
// the extensionless .ts resolution used by the existing operational scripts.
export function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return {
      url: "data:text/javascript,export default undefined;",
      shortCircuit: true,
    };
  }
  if (specifier.startsWith(".") && !specifier.endsWith(".ts") && !specifier.endsWith(".js")) {
    try {
      return nextResolve(`${specifier}.ts`, context);
    } catch {
      // Let Node report the original resolution error when the .ts sibling is absent.
    }
  }
  return nextResolve(specifier, context);
}
