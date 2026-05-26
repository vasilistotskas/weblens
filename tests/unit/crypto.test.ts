
import { describe, it, expect } from 'vitest';
import { hashContent, signContext, createProofOfContext } from '../../src/services/crypto';
import type { Env } from '../../src/types';

function createMockEnv(overrides: Partial<Env> = {}): Env {
    return {
        PAY_TO_ADDRESS: "0xTestAddress",
        CDP_API_KEY_SECRET: "test-secret-key-for-signing",
        ...overrides,
    } as Env;
}

describe('Crypto Service (ACV)', () => {
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

    describe('signContext', () => {
        it('should produce a consistent MAC for the same input', async () => {
            const env = createMockEnv();
            const result1 = await signContext("https://example.com", "abc123", "2024-01-01T00:00:00Z", env);
            const result2 = await signContext("https://example.com", "abc123", "2024-01-01T00:00:00Z", env);

            expect(result1.mac).toBe(result2.mac);
            expect(result1.keyId).toBe("weblens-oracle-v1");
            expect(result1.alg).toBe("HMAC-SHA256");
        });

        it('should produce different MACs for different URLs', async () => {
            const env = createMockEnv();
            const timestamp = "2024-01-01T00:00:00Z";
            const hash = "abc123";

            const result1 = await signContext("https://example.com", hash, timestamp, env);
            const result2 = await signContext("https://other.com", hash, timestamp, env);

            expect(result1.mac).not.toBe(result2.mac);
        });

        it('should produce different MACs for different content hashes', async () => {
            const env = createMockEnv();
            const timestamp = "2024-01-01T00:00:00Z";

            const result1 = await signContext("https://example.com", "hash1", timestamp, env);
            const result2 = await signContext("https://example.com", "hash2", timestamp, env);

            expect(result1.mac).not.toBe(result2.mac);
        });

        it('should produce different MACs for different timestamps', async () => {
            const env = createMockEnv();
            const hash = "abc123";

            const result1 = await signContext("https://example.com", hash, "2024-01-01T00:00:00Z", env);
            const result2 = await signContext("https://example.com", hash, "2024-02-01T00:00:00Z", env);

            expect(result1.mac).not.toBe(result2.mac);
        });

        it('should produce different MACs with different secrets', async () => {
            const env1 = createMockEnv({ CDP_API_KEY_SECRET: "secret-a" });
            const env2 = createMockEnv({ CDP_API_KEY_SECRET: "secret-b" });
            const timestamp = "2024-01-01T00:00:00Z";

            const result1 = await signContext("https://example.com", "abc123", timestamp, env1);
            const result2 = await signContext("https://example.com", "abc123", timestamp, env2);

            expect(result1.mac).not.toBe(result2.mac);
        });

        it('should prefer SIGNING_PRIVATE_KEY over CDP_API_KEY_SECRET', async () => {
            const envCdp = createMockEnv({ CDP_API_KEY_SECRET: "shared", SIGNING_PRIVATE_KEY: undefined });
            const envSigning = createMockEnv({ CDP_API_KEY_SECRET: "shared", SIGNING_PRIVATE_KEY: "dedicated" });
            const ts = "2024-01-01T00:00:00Z";

            const fromCdp = await signContext("https://example.com", "abc123", ts, envCdp);
            const fromSigning = await signContext("https://example.com", "abc123", ts, envSigning);

            // Different keys → different MACs, proving SIGNING_PRIVATE_KEY took precedence.
            expect(fromCdp.mac).not.toBe(fromSigning.mac);
        });

        it('should return a 64-char hex MAC', async () => {
            const env = createMockEnv();
            const result = await signContext("https://example.com", "abc123", "2024-01-01T00:00:00Z", env);

            expect(result.mac).toMatch(/^[0-9a-f]+$/);
            // HMAC-SHA256 produces 64 hex chars (32 bytes)
            expect(result.mac).toHaveLength(64);
        });

        it('should throw when no signing secret is configured', async () => {
            const env = createMockEnv({ CDP_API_KEY_SECRET: undefined, SIGNING_PRIVATE_KEY: undefined });

            await expect(
                signContext("https://example.com", "abc123", "2024-01-01T00:00:00Z", env)
            ).rejects.toThrow("Missing signing secret");
        });

        it('should not leak secret values in error messages', async () => {
            const secretValue = "super-secret-key-12345";
            const env = createMockEnv({ CDP_API_KEY_SECRET: undefined, SIGNING_PRIVATE_KEY: undefined });

            try {
                await signContext("https://example.com", "abc123", "2024-01-01T00:00:00Z", env);
            } catch (e) {
                const message = (e as Error).message;
                expect(message).not.toContain(secretValue);
            }
        });
    });

    describe('createProofOfContext', () => {
        it('should return a complete proof envelope', async () => {
            const env = createMockEnv();
            const proof = await createProofOfContext("https://example.com", "Hello World", env);

            expect(proof.hash).toBe('a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e');
            expect(proof.timestamp).toBeTruthy();
            expect(proof.mac).toMatch(/^[0-9a-f]{64}$/);
            expect(proof.keyId).toBe("weblens-oracle-v1");
            expect(proof.alg).toBe("HMAC-SHA256");
        });

        it('should produce different proofs for different content', async () => {
            const env = createMockEnv();
            const proof1 = await createProofOfContext("https://example.com", "Content A", env);
            const proof2 = await createProofOfContext("https://example.com", "Content B", env);

            expect(proof1.hash).not.toBe(proof2.hash);
            expect(proof1.mac).not.toBe(proof2.mac);
        });
    });
});
