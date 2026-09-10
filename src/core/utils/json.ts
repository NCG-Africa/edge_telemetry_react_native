/**
 * `JSON.stringify` that returns `undefined` instead of throwing — a cycle, a `toJSON` that
 * threw, a `BigInt`. Shared by `user.custom.*`'s bag rule (§4.10) and `flattenWithPrefix`'s
 * depth cap: both exist so a bad consumer payload is a dropped key rather than an exception
 * raised inside the SDK, in the host app's own call stack.
 */
export function stringifyOrDrop(value: unknown): string | undefined {
  try {
    return JSON.stringify(value) ?? undefined;
  } catch {
    return undefined;
  }
}
