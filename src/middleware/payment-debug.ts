/**
 * Payment Debugging Middleware
 * Logs detailed information about payment verification failures
 */

import type { Context, Next } from "hono";
import type { Env } from "../types";

interface PaymentAccept {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  payTo: string;
  asset: string;
  maxTimeoutSeconds?: number;
}

interface Payment402Response {
  error: string;
  accepts?: PaymentAccept[];
  x402Version?: number;
}

export async function paymentDebugMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next
) {
  const startTime = Date.now();

  // Log request details
  const method = c.req.method;
  const path = c.req.path;
  const hasPayment = c.req.header("X-PAYMENT");

  console.log(`🔍 [Payment Debug] ${method} ${path}`);
  console.log(`  Has X-PAYMENT header: ${String(!!hasPayment)}`);

  if (hasPayment) {
    console.log(`  Payment header length: ${String(hasPayment.length)} chars`);
    console.log(`  Payment preview: ${hasPayment.substring(0, 50)}...`);
  }

  await next();

  const endTime = Date.now();
  const status = c.res.status;

  console.log(`  Response status: ${String(status)}`);
  console.log(`  Processing time: ${String(endTime - startTime)}ms`);

  // If 402 response, log the error details
  if (status === 402) {
    try {
      const responseClone = c.res.clone();
      const body: Payment402Response = await responseClone.json();

      if (body.error) {
        console.error(`❌ [Payment Error] ${body.error}`);

        // Log payment acceptance requirements
        if (body.accepts?.[0]) {
          const accept: PaymentAccept = body.accepts[0];
          console.log(`  Expected payment:`);
          console.log(`    Network: ${accept.network}`);
          console.log(`    Amount: ${accept.maxAmountRequired}`);
          console.log(`    Asset: ${accept.asset}`);
          console.log(`    PayTo: ${accept.payTo}`);
        }
      }
    } catch (e) {
      console.error(`  Failed to parse 402 response:`, e);
    }
  }
}
