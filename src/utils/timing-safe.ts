/**
 * Constant-time string comparison. Runs the full loop over the longer input
 * regardless of length mismatch: an early `a.length !== b.length` short-circuit
 * leaks "wrong length" vs "right length wrong value" via observable timing.
 */
export function timingSafeEqualText(a: string, b: string): boolean {
    const maxLen = a.length > b.length ? a.length : b.length;
    let mismatch = a.length ^ b.length;
    for (let i = 0; i < maxLen; i++) {
        const ca = i < a.length ? a.charCodeAt(i) : 0;
        const cb = i < b.length ? b.charCodeAt(i) : 0;
        mismatch |= ca ^ cb;
    }
    return mismatch === 0;
}
