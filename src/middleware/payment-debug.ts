/**
 * Payment Debugging Middleware
 * Logs detailed information about payment verification failures
 * 
 * Enhanced for CDP facilitator debugging - captures full payload structure
 * to help diagnose "invalid_payload" errors from CDP's stricter validation
 * 
 * Key CDP Facilitator Requirements (from x402 docs):
 * 1. EIP-712 domain must match: name="USD Coin", version="2", chainId=8453
 * 2. authorization.to must match payTo from requirements
 * 3. authorization.value must be >= maxAmountRequired
 * 4. nonce must be unique 32-byte hex (0x + 64 chars)
 * 5. validAfter <= current time <= validBefore
 * 6. Signature must be valid EIP-712 signature (65 bytes)
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
  extra?: {
    name?: string;
    version?: string;
  };
}

interface Payment402Response {
  error: string;
  accepts?: PaymentAccept[];
  x402Version?: number;
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

/**
 * Decode and parse the X-PAYMENT header
 */
function decodePaymentHeader(header: string): PaymentPayload | null {
  try {
    const decoded = Buffer.from(header, "base64").toString("utf-8");
    return JSON.parse(decoded) as PaymentPayload;
  } catch (e) {
    console.error("  Failed to decode X-PAYMENT header:", e);
    return null;
  }
}

/**
 * Validate EIP-3009 authorization structure
 * CDP facilitator requires specific fields for transferWithAuthorization
 */
function validateEIP3009Authorization(auth: PaymentPayload["payload"]): string[] {
  const issues: string[] = [];
  
  if (!auth) {
    issues.push("Missing payload object");
    return issues;
  }

  if (!auth.signature) {
    issues.push("Missing signature");
  } else if (!auth.signature.startsWith("0x")) {
    issues.push("Signature should start with 0x");
  } else if (auth.signature.length !== 132) {
    issues.push(`Signature length ${String(auth.signature.length)} (expected 132 for 65-byte signature)`);
  }

  if (!auth.authorization) {
    issues.push("Missing authorization object");
    return issues;
  }

  const { authorization } = auth;

  // Check required EIP-3009 fields
  if (!authorization.from) issues.push("Missing authorization.from");
  if (!authorization.to) issues.push("Missing authorization.to");
  if (!authorization.value) issues.push("Missing authorization.value");
  if (!authorization.validAfter) issues.push("Missing authorization.validAfter");
  if (!authorization.validBefore) issues.push("Missing authorization.validBefore");
  if (!authorization.nonce) issues.push("Missing authorization.nonce");

  // Validate address formats
  if (authorization.from && !authorization.from.startsWith("0x")) {
    issues.push("authorization.from should start with 0x");
  }
  if (authorization.to && !authorization.to.startsWith("0x")) {
    issues.push("authorization.to should start with 0x");
  }

  // Validate nonce format (should be 32-byte hex)
  if (authorization.nonce) {
    if (!authorization.nonce.startsWith("0x")) {
      issues.push("authorization.nonce should start with 0x");
    } else if (authorization.nonce.length !== 66) {
      issues.push(`authorization.nonce length ${String(authorization.nonce.length)} (expected 66 for 32-byte hex)`);
    }
  }

  // Validate timestamps
  const now = Math.floor(Date.now() / 1000);
  if (authorization.validAfter) {
    const validAfter = parseInt(authorization.validAfter, 10);
    if (validAfter > now) {
      issues.push(`authorization.validAfter (${String(validAfter)}) is in the future (now: ${String(now)})`);
    }
  }
  if (authorization.validBefore) {
    const validBefore = parseInt(authorization.validBefore, 10);
    if (validBefore < now) {
      issues.push(`authorization.validBefore (${String(validBefore)}) is in the past (now: ${String(now)})`);
    }
  }

  return issues;
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

  console.log(`\n🔍 [Payment Debug] ${method} ${path}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log(`  Has X-PAYMENT header: ${String(!!hasPayment)}`);

  let paymentPayload: PaymentPayload | null = null;

  if (hasPayment) {
    console.log(`  Payment header length: ${String(hasPayment.length)} chars`);
    
    // Decode and analyze the payment payload
    paymentPayload = decodePaymentHeader(hasPayment);
    
    if (paymentPayload) {
      console.log(`  📦 Payment Payload Structure:`);
      console.log(`    x402Version: ${String(paymentPayload.x402Version ?? "undefined")}`);
      console.log(`    scheme: ${paymentPayload.scheme ?? "undefined"}`);
      console.log(`    network: ${paymentPayload.network ?? "undefined"}`);
      
      if (paymentPayload.payload) {
        console.log(`    payload.signature: ${paymentPayload.payload.signature?.substring(0, 20) ?? "undefined"}...`);
        
        if (paymentPayload.payload.authorization) {
          const auth = paymentPayload.payload.authorization;
          console.log(`    payload.authorization:`);
          console.log(`      from: ${auth.from ?? "undefined"}`);
          console.log(`      to: ${auth.to ?? "undefined"}`);
          console.log(`      value: ${auth.value ?? "undefined"}`);
          console.log(`      validAfter: ${auth.validAfter ?? "undefined"}`);
          console.log(`      validBefore: ${auth.validBefore ?? "undefined"}`);
          console.log(`      nonce: ${auth.nonce?.substring(0, 20) ?? "undefined"}...`);
        }
        
        // Validate EIP-3009 structure
        const validationIssues = validateEIP3009Authorization(paymentPayload.payload);
        if (validationIssues.length > 0) {
          console.log(`  ⚠️ EIP-3009 Validation Issues:`);
          validationIssues.forEach(issue => { console.log(`    - ${issue}`); });
        } else {
          console.log(`  ✅ EIP-3009 structure looks valid`);
        }
      }
    }
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

        // Provide specific guidance based on error type
        if (body.error.includes("invalid_payload")) {
          console.log(`  💡 CDP Facilitator Debugging Tips:`);
          console.log(`    1. Check EIP-712 domain matches USDC contract (name: "USD Coin", version: "2")`);
          console.log(`    2. Verify signature is for correct chainId (8453 for Base mainnet)`);
          console.log(`    3. Ensure authorization.to matches payTo address`);
          console.log(`    4. Check authorization.value >= maxAmountRequired`);
          console.log(`    5. Verify nonce is unique 32-byte hex`);
          
          if (paymentPayload?.payload?.authorization) {
            const auth = paymentPayload.payload.authorization;
            const accept = body.accepts?.[0];
            
            if (accept) {
              // Compare payload vs requirements
              console.log(`  🔄 Payload vs Requirements Comparison:`);
              console.log(`    to (payload): ${auth.to ?? "undefined"}`);
              console.log(`    payTo (required): ${accept.payTo}`);
              const toMatch = auth.to?.toLowerCase() === accept.payTo.toLowerCase();
              console.log(`    Match: ${String(toMatch)}`);
              
              console.log(`    value (payload): ${auth.value ?? "undefined"}`);
              console.log(`    maxAmountRequired: ${accept.maxAmountRequired}`);
              const valueBigInt = BigInt(auth.value ?? "0");
              const requiredBigInt = BigInt(accept.maxAmountRequired);
              const sufficient = valueBigInt >= requiredBigInt;
              console.log(`    Sufficient: ${String(sufficient)}`);
              
              console.log(`    network (payload): ${paymentPayload.network ?? "undefined"}`);
              console.log(`    network (required): ${accept.network}`);
              const networkMatch = paymentPayload.network === accept.network;
              console.log(`    Match: ${String(networkMatch)}`);
            }
          }
        }

        // Log payment acceptance requirements
        if (body.accepts?.[0]) {
          const accept: PaymentAccept = body.accepts[0];
          console.log(`  📋 Expected Payment Requirements:`);
          console.log(`    scheme: ${accept.scheme}`);
          console.log(`    network: ${accept.network}`);
          console.log(`    maxAmountRequired: ${accept.maxAmountRequired}`);
          console.log(`    asset: ${accept.asset}`);
          console.log(`    payTo: ${accept.payTo}`);
          console.log(`    resource: ${accept.resource}`);
          if (accept.extra) {
            console.log(`    extra.name: ${accept.extra.name ?? "undefined"}`);
            console.log(`    extra.version: ${accept.extra.version ?? "undefined"}`);
          }
        }
      }
    } catch (err) {
      console.error(`  Failed to parse 402 response:`, err);
    }
  }

  // Log successful payment response
  if (status === 200 && hasPayment) {
    const paymentResponse = c.res.headers.get("X-PAYMENT-RESPONSE");
    if (paymentResponse) {
      try {
        const decoded = JSON.parse(Buffer.from(paymentResponse, "base64").toString()) as {
          transaction?: string;
          network?: string;
          payer?: string;
        };
        console.log(`  ✅ Payment settled successfully`);
        console.log(`    Transaction: ${decoded.transaction?.substring(0, 20) ?? "unknown"}...`);
        console.log(`    Network: ${decoded.network ?? "unknown"}`);
        console.log(`    Payer: ${decoded.payer ?? "unknown"}`);
      } catch {
        console.log(`  Payment response header present but couldn't decode`);
      }
    }
  }

  // Log verification failure details if available in response
  if (status === 402 && hasPayment) {
    console.log(`\n  🔬 CDP Facilitator Verification Analysis:`);
    console.log(`  The payment was submitted but rejected by the facilitator.`);
    console.log(`  Common causes for 'invalid_payload' with CDP facilitator:`);
    console.log(`    1. EIP-712 signature mismatch (wrong chainId or domain)`);
    console.log(`    2. Insufficient USDC balance in payer wallet`);
    console.log(`    3. Nonce already used (replay attack prevention)`);
    console.log(`    4. validBefore timestamp expired during verification`);
    console.log(`    5. KYT/OFAC compliance check failed`);
    console.log(`  `);
    console.log(`  To debug further:`);
    console.log(`    - Check payer wallet USDC balance on Base mainnet`);
    console.log(`    - Verify the signature was created with chainId 8453`);
    console.log(`    - Ensure validBefore has sufficient buffer (60+ seconds)`);
  }
}
