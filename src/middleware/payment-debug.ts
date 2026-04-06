/**
 * Payment Debugging Middleware (x402 v2)
 *
 * Logs structured information about every payment attempt so failures are
 * visible in `wrangler tail`. v2 wire format only:
 *
 *  - Payment payloads arrive in the `Payment-Signature` request header.
 *  - 402 payment requirements are returned in the `PAYMENT-REQUIRED`
 *    *response* header (base64-JSON encoded). The 402 response body is `{}`.
 *  - Settlement receipts come back in `PAYMENT-RESPONSE`.
 */

import type { Context, Next } from "hono";
import type { Env } from "../types";

// ---- Types ----

interface V2PaymentAccept {
  scheme: string;
  network: string;
  amount?: string;
  asset?: string;
  payTo?: string;
  maxTimeoutSeconds?: number;
  extra?: { name?: string; version?: string };
}

interface V2PaymentRequiredResponse {
  x402Version?: number;
  error?: string;
  resource?: { url?: string; description?: string; mimeType?: string };
  accepts?: V2PaymentAccept[];
}

interface PaymentPayload {
  x402Version?: number;
  scheme?: string;
  network?: string;
  payload?: {
    signature?: string;
    authorization?: {
      from?: string;
      to?: string;
      value?: string;
      validAfter?: string;
      validBefore?: string;
      nonce?: string;
    };
  };
}

// ---- Helpers ----

function safeBase64Decode(value: string): string | null {
  try {
    return Buffer.from(value, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

function decodePaymentSignature(header: string): PaymentPayload | null {
  const json = safeBase64Decode(header);
  if (!json) {return null;}
  try {
    return JSON.parse(json) as PaymentPayload;
  } catch {
    return null;
  }
}

function decodePaymentRequired(header: string): V2PaymentRequiredResponse | null {
  const json = safeBase64Decode(header);
  if (!json) {return null;}
  try {
    return JSON.parse(json) as V2PaymentRequiredResponse;
  } catch {
    return null;
  }
}

function validateEIP3009(payload: PaymentPayload["payload"]): string[] {
  const issues: string[] = [];
  if (!payload) {
    issues.push("Missing payload object");
    return issues;
  }

  if (!payload.signature) {
    issues.push("Missing signature");
  } else if (!payload.signature.startsWith("0x")) {
    issues.push("Signature should start with 0x");
  } else if (payload.signature.length !== 132) {
    issues.push(
      `Signature length ${String(payload.signature.length)} (expected 132 for 65-byte signature)`
    );
  }

  if (!payload.authorization) {
    issues.push("Missing authorization object");
    return issues;
  }
  const auth = payload.authorization;

  if (!auth.from) {issues.push("Missing authorization.from");}
  if (!auth.to) {issues.push("Missing authorization.to");}
  if (!auth.value) {issues.push("Missing authorization.value");}
  if (!auth.validAfter) {issues.push("Missing authorization.validAfter");}
  if (!auth.validBefore) {issues.push("Missing authorization.validBefore");}
  if (!auth.nonce) {issues.push("Missing authorization.nonce");}

  if (auth.from && !auth.from.startsWith("0x")) {issues.push("authorization.from should start with 0x");}
  if (auth.to && !auth.to.startsWith("0x")) {issues.push("authorization.to should start with 0x");}

  if (auth.nonce) {
    if (!auth.nonce.startsWith("0x")) {
      issues.push("authorization.nonce should start with 0x");
    } else if (auth.nonce.length !== 66) {
      issues.push(
        `authorization.nonce length ${String(auth.nonce.length)} (expected 66 for 32-byte hex)`
      );
    }
  }

  const now = Math.floor(Date.now() / 1000);
  if (auth.validAfter) {
    const validAfter = parseInt(auth.validAfter, 10);
    if (validAfter > now) {
      issues.push(
        `authorization.validAfter (${String(validAfter)}) is in the future (now: ${String(now)})`
      );
    }
  }
  if (auth.validBefore) {
    const validBefore = parseInt(auth.validBefore, 10);
    if (validBefore < now) {
      issues.push(
        `authorization.validBefore (${String(validBefore)}) is in the past (now: ${String(now)})`
      );
    }
  }

  return issues;
}

// ---- Middleware ----

export async function paymentDebugMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next
) {
  const startTime = Date.now();
  const path = c.req.path;
  const method = c.req.method;

  const paymentSignature = c.req.header("payment-signature");
  const isPaidAttempt = !!paymentSignature;

  if (isPaidAttempt) {
    console.log(`\n🔍 [Payment Debug] ${method} ${path}`);
    console.log(`  Timestamp: ${new Date().toISOString()}`);

    const payload = decodePaymentSignature(paymentSignature);
    if (!payload) {
      console.error(
        `  ❌ Failed to base64/JSON-decode Payment-Signature header (${String(paymentSignature.length)} chars)`
      );
    } else {
      console.log(`  📦 Payment Payload:`);
      console.log(`    x402Version: ${String(payload.x402Version ?? "undefined")}`);
      console.log(`    scheme: ${payload.scheme ?? "undefined"}`);
      console.log(`    network: ${payload.network ?? "undefined"}`);

      if (payload.payload?.authorization) {
        const auth = payload.payload.authorization;
        console.log(`    authorization.from: ${auth.from ?? "undefined"}`);
        console.log(`    authorization.to: ${auth.to ?? "undefined"}`);
        console.log(`    authorization.value: ${auth.value ?? "undefined"}`);
        console.log(`    authorization.validBefore: ${auth.validBefore ?? "undefined"}`);
      }
      if (payload.payload?.signature) {
        console.log(
          `    payload.signature: ${payload.payload.signature.substring(0, 22)}... (${String(payload.payload.signature.length)} chars)`
        );
      }

      const issues = validateEIP3009(payload.payload);
      if (issues.length > 0) {
        console.log(`  ⚠️  EIP-3009 structure issues:`);
        issues.forEach((issue) => { console.log(`    - ${issue}`); });
      }
    }
  }

  await next();

  const status = c.res.status;
  const elapsedMs = Date.now() - startTime;

  if (isPaidAttempt) {
    console.log(`  ← Response status: ${String(status)} (${String(elapsedMs)}ms)`);
  }

  // 402 with payment attempted = the @x402 middleware rejected somewhere.
  // Decode the PAYMENT-REQUIRED response header for the actual reason.
  if (status === 402 && isPaidAttempt) {
    const paymentRequired =
      c.res.headers.get("payment-required") ?? c.res.headers.get("PAYMENT-REQUIRED");
    if (paymentRequired) {
      const decoded = decodePaymentRequired(paymentRequired);
      if (decoded) {
        console.error(`  ❌ [Payment Rejected] error=${decoded.error ?? "unknown"}`);
        const accept = decoded.accepts?.[0];
        if (accept) {
          console.log(`     Expected: scheme=${accept.scheme} network=${accept.network} amount=${accept.amount ?? "?"} payTo=${accept.payTo ?? "?"}`);
        }
      } else {
        console.error(`  ❌ Could not decode PAYMENT-REQUIRED header`);
      }
    } else {
      console.error(
        `  ❌ 402 returned with Payment-Signature present but no PAYMENT-REQUIRED response header — likely a settlement failure (silent path). Check x402 Verify/Settle Failure logs above.`
      );
    }
  }

  // Successful settlement: log the receipt.
  if (status >= 200 && status < 300 && isPaidAttempt) {
    const receipt = c.res.headers.get("payment-response");
    if (receipt) {
      const json = safeBase64Decode(receipt);
      if (json) {
        try {
          const parsed = JSON.parse(json) as {
            transaction?: string;
            network?: string;
            payer?: string;
          };
          console.log(`  ✅ Payment settled`);
          console.log(`     tx: ${parsed.transaction ?? "?"}`);
          console.log(`     network: ${parsed.network ?? "?"}`);
          console.log(`     payer: ${parsed.payer ?? "?"}`);
        } catch {
          console.log(`  ✅ Payment settled (receipt header present but unparseable)`);
        }
      }
    }
  }
}
