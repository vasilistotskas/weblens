/**
 * Memory Service - Agent Key-Value Storage
 * Persistent storage for AI agents, isolated by wallet address
 *
 * Requirements: 7.1, 7.6
 * - Store values associated with paying wallet address
 * - Isolate data by wallet address
 */

import { PRICING } from "../config";

export interface MemoryServiceConfig {
  kv: KVNamespace;
  walletAddress: string;
}

export interface StoredValue {
  value: unknown;
  storedAt: string;
  expiresAt: string;
  ttlHours: number;
}

/**
 * Generate a namespaced key for wallet isolation
 * Requirement 7.6: Associate data with paying wallet address
 */
function getNamespacedKey(walletAddress: string, key: string): string {
  return `memory:${walletAddress}:${key}`;
}

/**
 * Get the keys list key for a wallet
 */
function getKeysListKey(walletAddress: string): string {
  return `memory:${walletAddress}:__keys__`;
}

/**
 * Clamp TTL to valid bounds (1-720 hours)
 * Requirement 7.8: TTL between 1 hour and 30 days
 */
export function clampTtl(ttl: number | undefined): number {
  const { minTtl, maxTtl, defaultTtl } = PRICING.memory;
  if (ttl === undefined) return defaultTtl;
  return Math.max(minTtl, Math.min(maxTtl, ttl));
}

/**
 * Calculate expiration timestamp from TTL in hours
 */
function calculateExpiration(ttlHours: number): string {
  const expiresAt = new Date();
  expiresAt.setTime(expiresAt.getTime() + ttlHours * 60 * 60 * 1000);
  return expiresAt.toISOString();
}

/**
 * Store a value in memory
 * Requirement 7.1: POST /memory/set stores value and returns confirmation
 */
export async function setMemory(
  config: MemoryServiceConfig,
  key: string,
  value: unknown,
  ttlHours?: number
): Promise<{ stored: boolean; expiresAt: string }> {
  const { kv, walletAddress } = config;
  const clampedTtl = clampTtl(ttlHours);
  const expiresAt = calculateExpiration(clampedTtl);
  const storedAt = new Date().toISOString();

  const storedValue: StoredValue = {
    value,
    storedAt,
    expiresAt,
    ttlHours: clampedTtl,
  };

  const namespacedKey = getNamespacedKey(walletAddress, key);
  
  // Store the value with TTL (in seconds)
  await kv.put(namespacedKey, JSON.stringify(storedValue), {
    expirationTtl: clampedTtl * 60 * 60, // Convert hours to seconds
  });

  // Update the keys list for this wallet
  await addKeyToList(kv, walletAddress, key);

  return { stored: true, expiresAt };
}

/**
 * Retrieve a value from memory
 * Requirement 7.3: GET /memory/get/:key returns stored value
 */
export async function getMemory(
  config: MemoryServiceConfig,
  key: string
): Promise<StoredValue | null> {
  const { kv, walletAddress } = config;
  const namespacedKey = getNamespacedKey(walletAddress, key);

  const data = await kv.get(namespacedKey);
  if (!data) return null;

  try {
    return JSON.parse(data) as StoredValue;
  } catch {
    return null;
  }
}

/**
 * Delete a value from memory
 * Requirement 7.5: DELETE /memory/:key removes stored value
 */
export async function deleteMemory(
  config: MemoryServiceConfig,
  key: string
): Promise<boolean> {
  const { kv, walletAddress } = config;
  const namespacedKey = getNamespacedKey(walletAddress, key);

  // Check if key exists first
  const exists = await kv.get(namespacedKey);
  if (!exists) return false;

  await kv.delete(namespacedKey);
  
  // Remove from keys list
  await removeKeyFromList(kv, walletAddress, key);

  return true;
}

/**
 * List all keys for a wallet
 */
export async function listMemoryKeys(
  config: MemoryServiceConfig
): Promise<string[]> {
  const { kv, walletAddress } = config;
  const keysListKey = getKeysListKey(walletAddress);

  const data = await kv.get(keysListKey);
  if (!data) return [];

  try {
    return JSON.parse(data) as string[];
  } catch {
    return [];
  }
}

/**
 * Add a key to the wallet's keys list
 */
async function addKeyToList(
  kv: KVNamespace,
  walletAddress: string,
  key: string
): Promise<void> {
  const keysListKey = getKeysListKey(walletAddress);
  const data = await kv.get(keysListKey);
  
  let keys: string[] = [];
  if (data) {
    try {
      keys = JSON.parse(data) as string[];
    } catch {
      keys = [];
    }
  }

  if (!keys.includes(key)) {
    keys.push(key);
    await kv.put(keysListKey, JSON.stringify(keys));
  }
}

/**
 * Remove a key from the wallet's keys list
 */
async function removeKeyFromList(
  kv: KVNamespace,
  walletAddress: string,
  key: string
): Promise<void> {
  const keysListKey = getKeysListKey(walletAddress);
  const data = await kv.get(keysListKey);
  
  if (!data) return;

  try {
    const keys = JSON.parse(data) as string[];
    const filtered = keys.filter((k) => k !== key);
    await kv.put(keysListKey, JSON.stringify(filtered));
  } catch {
    // Ignore parse errors
  }
}

/**
 * Validate key format
 * Max 256 characters
 */
export function validateKey(key: string): { valid: boolean; error?: string } {
  if (!key || key.length === 0) {
    return { valid: false, error: "Key cannot be empty" };
  }
  if (key.length > 256) {
    return { valid: false, error: "Key cannot exceed 256 characters" };
  }
  if (key.startsWith("__")) {
    return { valid: false, error: "Keys starting with __ are reserved" };
  }
  return { valid: true };
}

/**
 * Validate value size
 * Max 100KB when serialized
 */
export function validateValue(value: unknown): { valid: boolean; error?: string } {
  try {
    const serialized = JSON.stringify(value);
    const sizeKB = new Blob([serialized]).size / 1024;
    if (sizeKB > 100) {
      return { valid: false, error: "Value cannot exceed 100KB when serialized" };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: "Value must be JSON-serializable" };
  }
}
