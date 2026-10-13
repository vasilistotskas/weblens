import { describe, it, expect } from 'vitest';
import { hashContent } from '../../src/services/crypto';

describe('hashContent', () => {
    it('should generate consistent SHA-256 hashes', async () => {
        const content = "Hello World";
        const hash1 = await hashContent(content);
        const hash2 = await hashContent(content);

        expect(hash1).toBe(hash2);
        expect(hash1).toBe('a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e');
    });

    it('should generate different hashes for different content', async () => {
        const hash1 = await hashContent("Content A");
        const hash2 = await hashContent("Content B");
        expect(hash1).not.toBe(hash2);
    });
});
