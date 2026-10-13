/**
 * Narrowing parsed JSON (`unknown`) without casts: every upstream response
 * and request document goes through these before a field is read.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The object elements of an array; anything else yields an empty list. */
export function asRecords(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}

export const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

export const num = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined);
