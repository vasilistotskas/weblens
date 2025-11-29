/**
 * Monitor Endpoint Handlers
 * URL change monitoring with webhook notifications
 *
 * Requirements: 4.1, 4.5, 4.6, 4.7
 * - POST /monitor/create - Create a new monitor
 * - GET /monitor/:id - Get monitor status
 * - DELETE /monitor/:id - Delete a monitor
 */

import type { Context } from "hono";
import { z } from "zod/v4";
import {
  createMonitor,
  getMonitor,
  deleteMonitor,
  toMonitorStatus,
  validateWebhookUrl,
} from "../services/monitor";
import type {
  Env,
  MonitorCreateRequest,
  MonitorCreateResponse,
} from "../types";
import { generateRequestId } from "../utils/requestId";

const monitorCreateSchema = z.object({
  url: z.url(),
  webhookUrl: z.url(),
  checkInterval: z.number().min(1).max(24).optional(),
  notifyOn: z.enum(["any", "content", "status"]).optional(),
});

/**
 * Extract wallet address from payment context
 */
interface PaymentPayload {
  payload?: {
    authorization?: {
      from?: string;
    };
  };
}

function getWalletAddress(c: Context<{ Bindings: Env }>): string {
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
  return "0x0000000000000000000000000000000000000000";
}

/**
 * Monitor Create endpoint handler
 * POST /monitor/create
 * Requirement 4.1: Create monitor and return ID
 */
export async function monitorCreateHandler(c: Context<{ Bindings: Env }>) {
  const requestId = generateRequestId();

  try {
    // Check if KV is available
    if (!c.env.MONITOR) {
      return c.json(
        {
          error: "SERVICE_UNAVAILABLE",
          code: "SERVICE_UNAVAILABLE",
          message: "Monitor service not configured",
          requestId,
        },
        503
      );
    }

    const body = await c.req.json<MonitorCreateRequest>();
    const parsed = monitorCreateSchema.safeParse(body);

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

    const { url, webhookUrl, checkInterval, notifyOn } = parsed.data;

    // Validate webhook URL
    const webhookValidation = validateWebhookUrl(webhookUrl);
    if (!webhookValidation.valid) {
      return c.json(
        {
          error: "WEBHOOK_INVALID",
          code: "WEBHOOK_INVALID",
          message: webhookValidation.error,
          requestId,
        },
        400
      );
    }

    const walletAddress = getWalletAddress(c);

    const monitor = await createMonitor(
      { kv: c.env.MONITOR, ownerId: walletAddress },
      url,
      webhookUrl,
      checkInterval,
      notifyOn
    );

    const response: MonitorCreateResponse = {
      monitorId: monitor.id,
      url: monitor.url,
      webhookUrl: monitor.webhookUrl,
      checkInterval: monitor.checkInterval,
      nextCheckAt: monitor.nextCheckAt,
      createdAt: monitor.createdAt,
      requestId,
    };

    return c.json(response, 201);
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
 * Monitor Get endpoint handler
 * GET /monitor/:id
 * Requirement 4.5: Return monitor status and history
 */
export async function monitorGetHandler(c: Context<{ Bindings: Env }>) {
  const requestId = generateRequestId();

  try {
    // Check if KV is available
    if (!c.env.MONITOR) {
      return c.json(
        {
          error: "SERVICE_UNAVAILABLE",
          code: "SERVICE_UNAVAILABLE",
          message: "Monitor service not configured",
          requestId,
        },
        503
      );
    }

    const monitorId = c.req.param("id");
    if (!monitorId) {
      return c.json(
        {
          error: "INVALID_REQUEST",
          code: "INVALID_REQUEST",
          message: "Monitor ID is required",
          requestId,
        },
        400
      );
    }

    const monitor = await getMonitor(
      { kv: c.env.MONITOR },
      monitorId
    );

    if (!monitor) {
      return c.json(
        {
          error: "MONITOR_NOT_FOUND",
          code: "MONITOR_NOT_FOUND",
          message: `Monitor '${monitorId}' not found`,
          requestId,
        },
        404
      );
    }

    const status = toMonitorStatus(monitor);

    return c.json({
      ...status,
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
 * Monitor Delete endpoint handler
 * DELETE /monitor/:id
 * Requirement 4.6: Stop monitoring and remove monitor
 */
export async function monitorDeleteHandler(c: Context<{ Bindings: Env }>) {
  const requestId = generateRequestId();

  try {
    // Check if KV is available
    if (!c.env.MONITOR) {
      return c.json(
        {
          error: "SERVICE_UNAVAILABLE",
          code: "SERVICE_UNAVAILABLE",
          message: "Monitor service not configured",
          requestId,
        },
        503
      );
    }

    const monitorId = c.req.param("id");
    if (!monitorId) {
      return c.json(
        {
          error: "INVALID_REQUEST",
          code: "INVALID_REQUEST",
          message: "Monitor ID is required",
          requestId,
        },
        400
      );
    }

    const deleted = await deleteMonitor(
      { kv: c.env.MONITOR },
      monitorId
    );

    if (!deleted) {
      return c.json(
        {
          error: "MONITOR_NOT_FOUND",
          code: "MONITOR_NOT_FOUND",
          message: `Monitor '${monitorId}' not found`,
          requestId,
        },
        404
      );
    }

    return c.json({
      monitorId,
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
