/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable n/no-process-exit */
/**
 * Verify Local Discovery Endpoint
 * 
 * Fetches /.well-known/x402 from the local running instance (or mocks it)
 * to verify keywords and capabilities are correctly populated.
 */

import { wellKnownX402Handler } from "../src/tools/discovery";


function run() {
    console.log("🔍 Verifying Local Discovery Manifest...");

    // Mock Context
    const mockRequest = new Request("http://localhost:8787/.well-known/x402");
    const mockContext = {
        req: {
            url: "http://localhost:8787/.well-known/x402",
            raw: mockRequest,
        },
        json: (data: any) => data
    } as any;

    const result = wellKnownX402Handler(mockContext) as any;

    console.log("✅ Capabilities:", result.capabilities.length);

    const requiredKeywords = [
        "autonomous-context-verification",
        "truth-oracle",
        "web-intelligence",
        "cryptographic-proofs"
    ];

    const missing = requiredKeywords.filter(k => !result.capabilities.includes(k));

    if (missing.length > 0) {
        console.error("❌ Missing keywords:", missing);
        process.exit(1);
    } else {
        console.log("✅ All required ACV keywords found in capabilities.");
    }

    if (result.keywords?.includes("truth-oracle")) {
        console.log("✅ 'keywords' field populated correctly.");
    } else {
        console.error("❌ 'keywords' field missing or incomplete.");
        process.exit(1);
    }

    console.log("🎉 Local Discovery Verification Passed!");
}

try {
    run();
} catch (e) {
    console.error(e);
}
