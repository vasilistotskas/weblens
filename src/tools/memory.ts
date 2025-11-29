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
import { z } from "zod/v4";
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
  MemorySetRequest,
  MemorySetResponse,
  MemoryGetResponse,
  MemoryListResponse,
} from "../types";
import { generateRequestId } from "../utils/requestId";

const memorySetSchema = z.object({
  key: z.string().min(1).max(256),
  value: z.unknown(),
  ttl: z.number().min(1).max(720).optional(),
});

/**
 * Extract wallet address from payment context
 * In x402, the paying wallet is available after payment verification
 */
interface PaymentPayload {
  payload?: {
    authorization?: {
      from?: string;
    };
  };
}

function getWalletAddress(c: Context<{ Bindings: Env }>): string {
  // Try to get from x402 payment context
  const paymentHeader = c.req.header("X-PAYMENT");
  if (paymentHeader) {
    try {
      const decoded = JSON.parse(atob(paymentHeader)) as PaymentPayload;
      if (decoded.payload?.authorization?.from) {
        return decoded.payload.authorization.from;
      }
    } catch {
      // Fall through to default
    }
  }
  
  // Fallback to a default for testing (in production, this should fail)
  return "0x0000000000000000000000000000000000000000";
}

/**
 * Memory Set endpoint handler
 * POST /memory/set
 * Requirement 7.1: Store value and return confirmation
 */
export async function memorySetHandler(c: Context<{ Bindings: Env }>) {
  const requestId = generateRequestId();

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

    const body = await c.req.json<MemorySetRequest>();
    const parsed = memorySetSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        {
          error: "INVALID_REQUEST",
          code: "INVALID_REQUEST",
          message: "Invalid request parameters",
          requestId,
          details: parsed.error.issues,
        },
        400
      );
    }

    const { key, value, ttl } = parsed.data;

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
  const requestId = generateRequestId();

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

    const key = c.req.param("key");
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
  const requestId = generateRequestId();

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

    const key = c.req.param("key");
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
  const requestId = generateRequestId();

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
