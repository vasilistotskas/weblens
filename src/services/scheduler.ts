/**
 * MonitorScheduler Durable Object
 * Handles scheduled URL monitoring checks
 *
 * Requirements: 4.3 - Scheduled URL checking
 */

import { DurableObject } from "cloudflare:workers";
import type { Env } from "../types";

export class MonitorScheduler extends DurableObject<Env> {

  /**
   * Handle HTTP requests to the Durable Object
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/schedule" && request.method === "POST") {
      interface ScheduleBody { monitorId: string; intervalHours: number }
      const body: ScheduleBody = await request.json();
      await this.scheduleCheck(body.monitorId, body.intervalHours);
      return new Response(JSON.stringify({ scheduled: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/cancel" && request.method === "POST") {
      interface CancelBody { monitorId: string }
      const body: CancelBody = await request.json();
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
    await this.ctx.storage.put(`monitor:${monitorId}`, {
      monitorId,
      intervalHours,
      scheduledAt: Date.now(),
    });

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
    const monitors = await this.ctx.storage.list({ prefix: "monitor:" });

    if (monitors.size === 0) {
      return;
    }

    // Process all monitors
    const now = Date.now();
    let nextAlarmTime = Infinity;

    for (const [, value] of monitors) {
      const monitor = value as { monitorId: string; intervalHours: number; scheduledAt: number };

      // If it's time to check (or past time)
      if (monitor.scheduledAt <= now) {
        console.log(`Processing monitor: ${monitor.monitorId}`);

        // Execute the check logic
        await this.processCheck(monitor.monitorId);

        // Reschedule
        const nextCheck = now + monitor.intervalHours * 60 * 60 * 1000;
        await this.ctx.storage.put(`monitor:${monitor.monitorId}`, {
          ...monitor,
          scheduledAt: nextCheck,
        });

        if (nextCheck < nextAlarmTime) {
          nextAlarmTime = nextCheck;
        }
      } else {
        // Not time yet, but keep track for next alarm
        if (monitor.scheduledAt < nextAlarmTime) {
          nextAlarmTime = monitor.scheduledAt;
        }
      }
    }

    if (nextAlarmTime !== Infinity) {
      await this.ctx.storage.setAlarm(nextAlarmTime);
    }
  }

  /**
   * Process a single monitor check
   */
  async processCheck(monitorId: string): Promise<void> {
    try {
      // Dynamic import to avoid circular dependencies if possible, 
      // or just import at top level if build system permits.
      // For now assuming we can import service functions.
      const { checkMonitor } = await import("../services/monitor");
      const { deductCredits } = await import("../services/credits");
      const { getMonitor } = await import("../services/monitor");
      const { PRICING } = await import("../config");

      // 1. Get monitor to find owner
      if (!this.env.MONITOR || !this.env.CREDIT_MANAGER) {
        console.error("Monitor or Credits service not configured");
        return;
      }

      const config = { kv: this.env.MONITOR };
      const monitor = await getMonitor(config, monitorId);

      if (!monitor?.ownerId) {
        console.error(`Monitor ${monitorId} not found or has no owner`);
        return;
      }

      // 2. Billing (Prevent check if insufficient funds)
      const cost = parseFloat(PRICING.monitor.perCheck.replace("$", ""));
      try {
        await deductCredits(
          this.env.CREDIT_MANAGER,
          monitor.ownerId,
          cost,
          `Background check for ${monitor.url}`,
          `mon_check_${monitorId}_${Date.now()}`
        );
      } catch (error) {
        console.error(`Billing failed for ${monitorId}:`, error);
        // Optionally disable monitor here
        return;
      }

      // 3. Perform Check
      // Use a standard fetch for now, or resilientFetch if needed
      const fetcher = async (url: string) => {
        const res = await fetch(url);
        return await res.text();
      };

      const result = await checkMonitor(config, monitorId, fetcher);
      console.log(`Check complete for ${monitorId}. Changed: ${result.changed}`);

    } catch (error) {
      console.error(`Failed to process check for ${monitorId}:`, error);
    }
  }
}
