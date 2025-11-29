/**
 * MonitorScheduler Durable Object
 * Handles scheduled URL monitoring checks
 *
 * Requirements: 4.3 - Scheduled URL checking
 */

import { DurableObject } from "cloudflare:workers";
import type { Env } from "../types";

export class MonitorScheduler extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  /**
   * Handle HTTP requests to the Durable Object
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/schedule" && request.method === "POST") {
      const body = await request.json() as { monitorId: string; intervalHours: number };
      await this.scheduleCheck(body.monitorId, body.intervalHours);
      return new Response(JSON.stringify({ scheduled: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/cancel" && request.method === "POST") {
      const body = await request.json() as { monitorId: string };
      await this.cancelCheck(body.monitorId);
      return new Response(JSON.stringify({ cancelled: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  /**
   * Schedule a monitor check using Durable Object alarm
   */
  async scheduleCheck(monitorId: string, intervalHours: number): Promise<void> {
    // Store the monitor info
    await this.ctx.storage.put(`monitor:${monitorId}`, {
      monitorId,
      intervalHours,
      scheduledAt: Date.now(),
    });

    // Set alarm for next check (convert hours to ms)
    const nextCheck = Date.now() + intervalHours * 60 * 60 * 1000;
    await this.ctx.storage.setAlarm(nextCheck);
  }

  /**
   * Cancel a scheduled monitor check
   */
  async cancelCheck(monitorId: string): Promise<void> {
    await this.ctx.storage.delete(`monitor:${monitorId}`);
  }

  /**
   * Handle alarm - triggered when it's time to check monitors
   */
  async alarm(): Promise<void> {
    // Get all scheduled monitors
    const monitors = await this.ctx.storage.list({ prefix: "monitor:" });

    for (const [key, value] of monitors) {
      const monitor = value as { monitorId: string; intervalHours: number };
      
      // Trigger the check via the Worker
      // In production, this would call back to the main Worker to perform the check
      console.log(`Alarm triggered for monitor: ${monitor.monitorId}`);
      
      // Reschedule for next interval
      const nextCheck = Date.now() + monitor.intervalHours * 60 * 60 * 1000;
      await this.ctx.storage.setAlarm(nextCheck);
    }
  }
}
