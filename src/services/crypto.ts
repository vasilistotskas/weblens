const subtle = crypto.subtle;

/**
 * Calculate SHA-256 hash of the content (DOM/Text)
 * @param content based on which to calculate hash
 * @returns Hex string of the hash
 */
export async function hashContent(content: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await subtle.digest("SHA-256", data);

    // Convert buffer to hex string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    return hashHex;
}
