/**
 * MonitorScheduler Durable Object
 * Handles scheduled URL monitoring checks
 *
 * Requirements: 4.3 - Scheduled URL checking
 */

import { DurableObject } from "cloudflare:workers";
import type { Env } from "../types";
import { safeFetch } from "../utils/safe-fetch";

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

    for (const [key, value] of monitors) {
      const monitor = value as { monitorId: string; intervalHours: number; scheduledAt: number };

      // If it's time to check (or past time)
      if (monitor.scheduledAt <= now) {
        console.log(`Processing monitor: ${monitor.monitorId}`);

        // Execute the check logic — returns false if billing failed
        const shouldContinue = await this.processCheck(monitor.monitorId);

        if (!shouldContinue) {
          // Billing failed (insufficient credits) — remove from scheduler
          // to stop the alarm loop. Monitor remains in KV as "paused".
          console.warn(`Pausing monitor ${monitor.monitorId} — billing failed, removing from scheduler`);
          await this.ctx.storage.delete(key);
          continue;
        }

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
   * Process a single monitor check.
   * Returns true if the monitor should be rescheduled, false if billing
   * failed and the monitor should be paused to stop the alarm loop.
   */
  async processCheck(monitorId: string): Promise<boolean> {
    try {
      const { checkMonitor } = await import("../services/monitor");
      const { deductCredits } = await import("../services/credits");
      const { getMonitor, updateMonitorStatus } = await import("../services/monitor");
      const { PRICING } = await import("../config");

      // 1. Get monitor to find owner
      if (!this.env.MONITOR || !this.env.CREDIT_MANAGER) {
        console.error("Monitor or Credits service not configured");
        return false;
      }

      const config = { kv: this.env.MONITOR };
      const monitor = await getMonitor(config, monitorId);

      if (!monitor?.ownerId) {
        console.error(`Monitor ${monitorId} not found or has no owner`);
        return false;
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
        // Mark monitor as paused in KV so the owner can see why it stopped
        try {
          await updateMonitorStatus(config, monitorId, "paused");
        } catch { /* best-effort */ }
        return false;
      }

      // 3. Perform Check — use safeFetch so any redirect chain is revalidated
      // (a monitored page could redirect to an internal IP between creation
      // and the next scheduled check).
      const fetcher = async (url: string) => {
        const res = await safeFetch(url, { signal: AbortSignal.timeout(15000) });
        return await res.text();
      };

      const result = await checkMonitor(config, monitorId, fetcher);
      console.log(`Check complete for ${monitorId}. Changed: ${result.changed}`);
      return true;

    } catch (error) {
      console.error(`Failed to process check for ${monitorId}:`, error);
      return true; // reschedule — transient errors should retry
    }
  }
}
