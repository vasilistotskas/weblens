/**
 * Helpers for buyer-supplied JSON documents that WebLens hashes and hosts
 * (ERC-8004 feedback). Pure functions with no runtime dependencies, so the
 * request schemas can use them without pulling in the services behind them.
 */

/**
 * Nesting cap for any document we hash. `canonicalJson` recurses, so a
 * buyer-supplied document nested thousands of levels deep exhausts the stack
 * — a 10KB body is enough to do it. Genuine ERC-8004 feedback is a flat
 * record with a little nesting, so this ceiling is far above real use.
 */
export const MAX_DOCUMENT_DEPTH = 32;

/**
 * True when `value` nests deeper than `limit`. Bounded by construction: it
 * stops descending the moment the limit is reached, so checking a hostile
 * document cannot itself overflow the stack.
 */
export function exceedsDepth(value: unknown, limit = MAX_DOCUMENT_DEPTH, depth = 0): boolean {
    if (value === null || typeof value !== "object") { return false; }
    if (depth >= limit) { return true; }
    const children = Array.isArray(value) ? value : Object.values(value);
    return children.some((child) => exceedsDepth(child, limit, depth + 1));
}

/**
 * Canonical JSON (sorted keys) so a hash is reproducible by the buyer.
 *
 * `depth` is internal. Callers pass one argument — note that recursion must
 * use an explicit callback rather than `array.map(canonicalJson)`, which
 * would hand the array index in as the depth.
 */
export function canonicalJson(value: unknown, depth = 0): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (depth >= MAX_DOCUMENT_DEPTH) {
        throw new Error(`Document nesting exceeds the ${String(MAX_DOCUMENT_DEPTH)} level limit`);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item, depth + 1)).join(",")}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v, depth + 1)}`).join(",")}}`;
}
