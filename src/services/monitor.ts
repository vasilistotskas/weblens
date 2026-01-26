/**
 * Monitor Service - URL Change Monitoring
 * Watches URLs for content changes and notifies via webhook
 *
 * Requirements: 4.1, 4.5, 4.6
 * - Create monitors with URL and webhook
 * - Store monitor configuration and state
 * - Get monitor status and delete monitors
 */

import { PRICING } from "../config";
import type { StoredMonitor, MonitorStatus } from "../types";

export interface MonitorServiceConfig {
  kv: KVNamespace;
  ownerId?: string; // Wallet address for ownership
}

/**
 * Generate a unique monitor ID
 */
function generateMonitorId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `mon_${timestamp}${random}`;
}

/**
 * Get the KV key for a monitor
 */
function getMonitorKey(monitorId: string): string {
  return `monitor:${monitorId}`;
}

/**
 * Get the KV key for owner's monitor list
 */
function getOwnerMonitorsKey(ownerId: string): string {
  return `monitors:owner:${ownerId}`;
}

/**
 * Clamp check interval to valid bounds (1-24 hours)
 * Requirement 4.7: Interval between 1 and 24 hours
 */
export function clampInterval(interval: number | undefined): number {
  const { minInterval, maxInterval } = PRICING.monitor;
  if (interval === undefined) {return minInterval;}
  return Math.max(minInterval, Math.min(maxInterval, interval));
}

/**
 * Calculate next check timestamp
 */
function calculateNextCheck(intervalHours: number): string {
  const nextCheck = new Date();
  nextCheck.setTime(nextCheck.getTime() + intervalHours * 60 * 60 * 1000);
  return nextCheck.toISOString();
}

/**
 * Create a new monitor
 * Requirement 4.1: POST /monitor/create creates monitor and returns ID
 */
export async function createMonitor(
  config: MonitorServiceConfig,
  url: string,
  webhookUrl: string,
  checkInterval?: number,
  notifyOn: "any" | "content" | "status" = "any"
): Promise<StoredMonitor> {
  const { kv, ownerId } = config;
  const monitorId = generateMonitorId();
  const clampedInterval = clampInterval(checkInterval);
  const now = new Date().toISOString();

  const monitor: StoredMonitor = {
    id: monitorId,
    url,
    webhookUrl,
    checkInterval: clampedInterval,
    notifyOn,
    status: "active",
    checkCount: 0,
    totalCost: 0,
    createdAt: now,
    nextCheckAt: calculateNextCheck(clampedInterval),
    ownerId,
  };

  // Store the monitor
  await kv.put(getMonitorKey(monitorId), JSON.stringify(monitor));

  // Add to owner's monitor list if owner is specified
  if (ownerId) {
    await addMonitorToOwnerList(kv, ownerId, monitorId);
  }

  return monitor;
}

/**
 * Get a monitor by ID
 * Requirement 4.5: GET /monitor/:id returns monitor status
 */
export async function getMonitor(
  config: MonitorServiceConfig,
  monitorId: string
): Promise<StoredMonitor | null> {
  const { kv } = config;
  const data = await kv.get(getMonitorKey(monitorId));
  
  if (!data) {return null;}

  try {
    return JSON.parse(data) as StoredMonitor;
  } catch {
    return null;
  }
}

/**
 * Delete a monitor
 * Requirement 4.6: DELETE /monitor/:id stops and removes monitor
 */
export async function deleteMonitor(
  config: MonitorServiceConfig,
  monitorId: string
): Promise<boolean> {
  const { kv } = config;
  
  // Get monitor first to check ownership and existence
  const monitor = await getMonitor(config, monitorId);
  if (!monitor) {return false;}

  // Delete the monitor
  await kv.delete(getMonitorKey(monitorId));

  // Remove from owner's list if owner exists
  if (monitor.ownerId) {
    await removeMonitorFromOwnerList(kv, monitor.ownerId, monitorId);
  }

  return true;
}

/**
 * Update monitor after a check
 */
export async function updateMonitorAfterCheck(
  config: MonitorServiceConfig,
  monitorId: string,
  contentHash: string,
  changed: boolean
): Promise<StoredMonitor | null> {
  const { kv } = config;
  const monitor = await getMonitor(config, monitorId);
  
  if (!monitor) {return null;}

  const now = new Date().toISOString();
  const perCheckCents = parseFloat(PRICING.monitor.perCheck.replace("$", "")) * 100;
  void changed; // Used for webhook notification logic

  const updated: StoredMonitor = {
    ...monitor,
    lastContentHash: contentHash,
    lastCheckAt: now,
    nextCheckAt: calculateNextCheck(monitor.checkInterval),
    checkCount: monitor.checkCount + 1,
    totalCost: monitor.totalCost + perCheckCents,
  };

  await kv.put(getMonitorKey(monitorId), JSON.stringify(updated));

  return updated;
}

/**
 * List monitors for an owner
 */
export async function listMonitorsByOwner(
  config: MonitorServiceConfig,
  ownerId: string
): Promise<string[]> {
  const { kv } = config;
  const data = await kv.get(getOwnerMonitorsKey(ownerId));
  
  if (!data) {return [];}

  try {
    return JSON.parse(data) as string[];
  } catch {
    return [];
  }
}

/**
 * Add monitor to owner's list
 */
async function addMonitorToOwnerList(
  kv: KVNamespace,
  ownerId: string,
  monitorId: string
): Promise<void> {
  const key = getOwnerMonitorsKey(ownerId);
  const data = await kv.get(key);
  
  let monitors: string[] = [];
  if (data) {
    try {
      monitors = JSON.parse(data) as string[];
    } catch {
      monitors = [];
    }
  }

  if (!monitors.includes(monitorId)) {
    monitors.push(monitorId);
    await kv.put(key, JSON.stringify(monitors));
  }
}

/**
 * Remove monitor from owner's list
 */
async function removeMonitorFromOwnerList(
  kv: KVNamespace,
  ownerId: string,
  monitorId: string
): Promise<void> {
  const key = getOwnerMonitorsKey(ownerId);
  const data = await kv.get(key);
  
  if (!data) {return;}

  try {
    const monitors = JSON.parse(data) as string[];
    const filtered = monitors.filter((id) => id !== monitorId);
    await kv.put(key, JSON.stringify(filtered));
  } catch {
    // Ignore parse errors
  }
}

/**
 * Convert StoredMonitor to MonitorStatus response
 */
export function toMonitorStatus(monitor: StoredMonitor): MonitorStatus {
  return {
    monitorId: monitor.id,
    url: monitor.url,
    status: monitor.status,
    lastCheck: monitor.lastCheckAt
      ? {
          checkedAt: monitor.lastCheckAt,
          changed: false, // Would need to track this separately
          contentHash: monitor.lastContentHash ?? "",
        }
      : undefined,
    checkCount: monitor.checkCount,
    totalCost: `$${(monitor.totalCost / 100).toFixed(3)}`,
    createdAt: monitor.createdAt,
  };
}

/**
 * Validate webhook URL
 */
export function validateWebhookUrl(url: string): { valid: boolean; error?: string } {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { valid: false, error: "Webhook URL must use HTTP or HTTPS" };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid webhook URL format" };
  }
}

/**
 * Hash content for change detection
 */
export async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}


/**
 * Send webhook notification
 * Requirement 4.3: Send POST to webhook URL with change details
 */
export async function sendWebhookNotification(
  webhookUrl: string,
  payload: {
    monitorId: string;
    url: string;
    changeType: "content" | "status" | "error";
    previousHash?: string;
    currentHash?: string;
    diff?: string;
    checkedAt: string;
  }
): Promise<boolean> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "WebLens-Monitor/1.0",
      },
      body: JSON.stringify(payload),
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check a single monitor for changes
 * Requirement 4.3: Check URL and notify on changes
 */
export async function checkMonitor(
  config: MonitorServiceConfig,
  monitorId: string,
  fetchFn: (url: string) => Promise<string>
): Promise<{
  changed: boolean;
  error?: string;
  notified?: boolean;
}> {
  const monitor = await getMonitor(config, monitorId);
  if (!monitor) {
    return { changed: false, error: "Monitor not found" };
  }

  if (monitor.status !== "active") {
    return { changed: false, error: "Monitor is not active" };
  }

  try {
    // Fetch the URL content
    const content = await fetchFn(monitor.url);
    const currentHash = await hashContent(content);
    const previousHash = monitor.lastContentHash;

    // Check if content changed
    const changed = previousHash !== undefined && previousHash !== currentHash;

    // Update monitor state
    await updateMonitorAfterCheck(config, monitorId, currentHash, changed);

    // Send webhook if changed and notification is configured
    let notified = false;
    if (changed && (monitor.notifyOn === "any" || monitor.notifyOn === "content")) {
      notified = await sendWebhookNotification(monitor.webhookUrl, {
        monitorId: monitor.id,
        url: monitor.url,
        changeType: "content",
        previousHash,
        currentHash,
        checkedAt: new Date().toISOString(),
      });
    }

    return { changed, notified };
  } catch (error) {
    // Send error notification if configured
    if (monitor.notifyOn === "any" || monitor.notifyOn === "status") {
      await sendWebhookNotification(monitor.webhookUrl, {
        monitorId: monitor.id,
        url: monitor.url,
        changeType: "error",
        diff: error instanceof Error ? error.message : "Unknown error",
        checkedAt: new Date().toISOString(),
      });
    }

    return {
      changed: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get all monitors that are due for checking
 */
export function getMonitorsDueForCheck(): StoredMonitor[] {
  // Note: In a real implementation, this would use KV list with prefix
  // and filter by nextCheckAt. For now, this is a placeholder that
  // would be implemented with Durable Objects for proper scheduling.
  // The actual scheduling will be handled by the Durable Object in task 13.
  return [];
}
