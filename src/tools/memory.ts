/**
 * Memory Endpoint Handlers
 * Persistent key-value storage for AI agents
 *
 * Requirements: 7.1, 7.3, 7.5, 7.8
 * - POST /memory/set - Store a value
 * - GET /memory/get/:key - Retrieve a value
 * - DELETE /memory/:key - Delete a value
 * - GET /memory/list - List all keys
 */

import type { Context } from "hono";
import type { z } from "zod/v4";
import type { MemorySetRequestSchema } from "../schemas";
import {
  setMemory,
  getMemory,
  deleteMemory,
  listMemoryKeys,
  validateKey,
  validateValue,
} from "../services/memory";
import type {
  Env,
  MemorySetResponse,
  MemoryGetResponse,
  MemoryListResponse,
  PaymentPayload,
} from "../types";

/**
 * Extract wallet address from payment context
 * In x402, the paying wallet is available after payment verification
 */
function getWalletAddress(c: Context<{ Bindings: Env }>): string | null {
  // Try to get from x402 v2 payment context.
  const paymentHeader = c.req.header("Payment-Signature");
  if (paymentHeader) {
    try {
      const decoded = JSON.parse(atob(paymentHeader)) as PaymentPayload;
      if (decoded.payload?.authorization?.from) {
        return decoded.payload.authorization.from;
      }
    } catch {
      // Fall through
    }
  }

  // Try credit wallet header
  const creditWallet = c.req.header("X-CREDIT-WALLET");
  if (creditWallet?.startsWith("0x")) {
    return creditWallet;
  }

  return null;
}

/**
 * Memory Set endpoint handler
 * POST /memory/set
 * Requirement 7.1: Store value and return confirmation
 */
export async function memorySetHandler(c: Context<{ Bindings: Env }>) {
  const requestId = c.get("requestId");

  try {
    // Check if KV is available
    if (!c.env.MEMORY) {
      return c.json(
        {
          error: "SERVICE_UNAVAILABLE",
          code: "SERVICE_UNAVAILABLE",
          message: "Memory service not configured",
          requestId,
        },
        503
      );
    }

    const { key, value, ttl } = c.get("validatedBody") as z.infer<typeof MemorySetRequestSchema>;

    // Validate key
    const keyValidation = validateKey(key);
    if (!keyValidation.valid) {
      return c.json(
        {
          error: "INVALID_REQUEST",
          code: "INVALID_REQUEST",
          message: keyValidation.error,
          requestId,
        },
        400
      );
    }

    // Validate value size
    const valueValidation = validateValue(value);
    if (!valueValidation.valid) {
      return c.json(
        {
          error: "MEMORY_VALUE_TOO_LARGE",
          code: "MEMORY_VALUE_TOO_LARGE",
          message: valueValidation.error,
          requestId,
        },
        400
      );
    }

    const walletAddress = getWalletAddress(c);
    if (!walletAddress) {
      return c.json({ error: "UNAUTHORIZED", code: "UNAUTHORIZED", message: "Valid payment or credit wallet header required for memory operations", requestId }, 401);
    }

    const result = await setMemory(
      { kv: c.env.MEMORY, walletAddress },
      key,
      value,
      ttl
    );

    const response: MemorySetResponse = {
      key,
      stored: result.stored,
      expiresAt: result.expiresAt,
      requestId,
    };

    return c.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json(
      {
        error: "INTERNAL_ERROR",
        code: "INTERNAL_ERROR",
        message,
        requestId,
      },
      500
    );
  }
}

/**
 * Memory Get endpoint handler
 * GET /memory/get/:key
 * Requirement 7.3: Return stored value if exists
 * Requirement 7.7: Return 404 if key does not exist
 */
export async function memoryGetHandler(c: Context<{ Bindings: Env }>) {
  const requestId = c.get("requestId");

  try {
    // Check if KV is available
    if (!c.env.MEMORY) {
      return c.json(
        {
          error: "SERVICE_UNAVAILABLE",
          code: "SERVICE_UNAVAILABLE",
          message: "Memory service not configured",
          requestId,
        },
        503
      );
    }

    const key = c.req.query("key");
    if (!key) {
      return c.json(
        {
          error: "INVALID_REQUEST",
          code: "INVALID_REQUEST",
          message: "Key parameter is required",
          requestId,
        },
        400
      );
    }

    const walletAddress = getWalletAddress(c);
    if (!walletAddress) {
      return c.json({ error: "UNAUTHORIZED", code: "UNAUTHORIZED", message: "Valid payment or credit wallet header required for memory operations", requestId }, 401);
    }

    const stored = await getMemory(
      { kv: c.env.MEMORY, walletAddress },
      key
    );

    if (!stored) {
      return c.json(
        {
          error: "MEMORY_KEY_NOT_FOUND",
          code: "MEMORY_KEY_NOT_FOUND",
          message: `Key '${key}' not found`,
          requestId,
        },
        404
      );
    }

    const response: MemoryGetResponse = {
      key,
      value: stored.value,
      storedAt: stored.storedAt,
      expiresAt: stored.expiresAt,
      requestId,
    };

    return c.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json(
      {
        error: "INTERNAL_ERROR",
        code: "INTERNAL_ERROR",
        message,
        requestId,
      },
      500
    );
  }
}

/**
 * Memory Delete endpoint handler
 * DELETE /memory/:key
 * Requirement 7.5: Remove stored value
 */
export async function memoryDeleteHandler(c: Context<{ Bindings: Env }>) {
  const requestId = c.get("requestId");

  try {
    // Check if KV is available
    if (!c.env.MEMORY) {
      return c.json(
        {
          error: "SERVICE_UNAVAILABLE",
          code: "SERVICE_UNAVAILABLE",
          message: "Memory service not configured",
          requestId,
        },
        503
      );
    }

    const key = c.req.query("key");
    if (!key) {
      return c.json(
        {
          error: "INVALID_REQUEST",
          code: "INVALID_REQUEST",
          message: "Key parameter is required",
          requestId,
        },
        400
      );
    }

    const walletAddress = getWalletAddress(c);
    if (!walletAddress) {
      return c.json({ error: "UNAUTHORIZED", code: "UNAUTHORIZED", message: "Valid payment or credit wallet header required for memory operations", requestId }, 401);
    }

    const deleted = await deleteMemory(
      { kv: c.env.MEMORY, walletAddress },
      key
    );

    if (!deleted) {
      return c.json(
        {
          error: "MEMORY_KEY_NOT_FOUND",
          code: "MEMORY_KEY_NOT_FOUND",
          message: `Key '${key}' not found`,
          requestId,
        },
        404
      );
    }

    return c.json({
      key,
      deleted: true,
      requestId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json(
      {
        error: "INTERNAL_ERROR",
        code: "INTERNAL_ERROR",
        message,
        requestId,
      },
      500
    );
  }
}

/**
 * Memory List endpoint handler
 * GET /memory/list
 * List all keys for the current wallet
 */
export async function memoryListHandler(c: Context<{ Bindings: Env }>) {
  const requestId = c.get("requestId");

  try {
    // Check if KV is available
    if (!c.env.MEMORY) {
      return c.json(
        {
          error: "SERVICE_UNAVAILABLE",
          code: "SERVICE_UNAVAILABLE",
          message: "Memory service not configured",
          requestId,
        },
        503
      );
    }

    const walletAddress = getWalletAddress(c);
    if (!walletAddress) {
      return c.json({ error: "UNAUTHORIZED", code: "UNAUTHORIZED", message: "Valid payment or credit wallet header required for memory operations", requestId }, 401);
    }

    const keys = await listMemoryKeys({ kv: c.env.MEMORY, walletAddress });

    const response: MemoryListResponse = {
      keys,
      count: keys.length,
      requestId,
    };

    return c.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json(
      {
        error: "INTERNAL_ERROR",
        code: "INTERNAL_ERROR",
        message,
        requestId,
      },
      500
    );
  }
}
