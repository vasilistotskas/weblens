/**
 * Evaluation-friction surfaces: free previews and the ERC-8004 off-chain
 * documents.
 *
 * Two properties matter most and are asserted here:
 *   1. A preview can never cost us money — only endpoints with no paid
 *      upstream may run live.
 *   2. The feedbackHash we hand a buyer must be reproducible from the bytes
 *      we serve, or their on-chain giveFeedback() call points at a document
 *      that fails integrity checks.
 */

import { describe, expect, it } from "vitest";
import { keccak256, stringToHex } from "viem";
import { PAID_ENDPOINTS } from "../../src/config";
import {
    ERC8004_REGISTRATION_TYPE,
    REQUIRED_FEEDBACK_FIELDS,
    buildRegistration,
    canonicalJson,
    feedbackHash,
    missingFeedbackFields,
} from "../../src/services/erc8004";
import {
    LIVE_PREVIEW_ENDPOINTS,
    PREVIEW_SAMPLES,
    describePrice,
    isPaidEndpoint,
} from "../../src/services/previews";

/** Endpoints that call a metered third-party API on every request. */
const PAID_UPSTREAM = [
    "/search", "/search/news", "/search/images", "/search/places", "/search/shopping",
    "/search/scholar", "/search/autocomplete", "/search/trends",
    "/social/youtube/transcript", "/answer", "/research", "/research/deep",
    "/extract", "/extract/smart", "/compare",
    "/intel/company", "/intel/market", "/intel/competitive", "/intel/site-audit",
];

describe("preview coverage", () => {
    it("has a sample for every paid endpoint", () => {
        const missing = PAID_ENDPOINTS.filter((e) => !(e in PREVIEW_SAMPLES));
        expect(missing, `paid endpoints with no preview sample: ${missing.join(", ")}`).toEqual([]);
    });

    it("has no sample for an endpoint that is not sold", () => {
        const orphans = Object.keys(PREVIEW_SAMPLES).filter((e) => !PAID_ENDPOINTS.includes(e));
        expect(orphans, `preview samples with no endpoint: ${orphans.join(", ")}`).toEqual([]);
    });

    it("gives every sample a non-empty summary and shape", () => {
        for (const [endpoint, entry] of Object.entries(PREVIEW_SAMPLES)) {
            expect(entry.summary.length, `${endpoint} summary`).toBeGreaterThan(10);
            expect(Object.keys(entry.sample).length, `${endpoint} sample`).toBeGreaterThan(0);
        }
    });

    it("quotes a concrete price for every paid endpoint", () => {
        for (const endpoint of PAID_ENDPOINTS) {
            const price = describePrice(endpoint);
            expect(price, `${endpoint} price`).not.toBe("see the 402 challenge");
            expect(price.length).toBeGreaterThan(0);
        }
    });
});

describe("preview cost safety", () => {
    it("never runs a live preview for an endpoint with a paid upstream", () => {
        const leaking = LIVE_PREVIEW_ENDPOINTS.filter((e) => PAID_UPSTREAM.includes(e));
        expect(leaking, `these would burn upstream credits for free: ${leaking.join(", ")}`).toEqual([]);
    });

    it("only offers live previews for endpoints we actually sell", () => {
        for (const endpoint of LIVE_PREVIEW_ENDPOINTS) {
            expect(isPaidEndpoint(endpoint), `${endpoint} is not a paid endpoint`).toBe(true);
        }
    });
});

describe("ERC-8004 registration document", () => {
    const doc = buildRegistration("https://api.weblens.dev");

    it("declares the registration-v1 type the spec requires", () => {
        expect(doc.type).toBe(ERC8004_REGISTRATION_TYPE);
    });

    it("carries every field the spec lists as required", () => {
        for (const field of ["name", "description", "image", "services", "active", "x402Support", "registrations", "supportedTrust"]) {
            expect(doc, `missing ${field}`).toHaveProperty(field);
        }
    });

    it("describes services as {name, endpoint} entries", () => {
        expect(doc.services.length).toBeGreaterThan(0);
        for (const service of doc.services) {
            expect(typeof service.name).toBe("string");
            expect(service.endpoint.startsWith("https://")).toBe(true);
        }
    });

    it("claims no on-chain registration it does not have", () => {
        // Inventing an agentId would make the document lie about identity.
        expect(doc.registrations).toEqual([]);
        expect(doc.supportedTrust).toEqual(["feedback"]);
    });

    it("advertises x402 support and the real network", () => {
        expect(doc.x402Support).toBe(true);
        expect(doc.payment.networks).toContain("base");
    });
});

describe("canonical JSON", () => {
    it("is key-order independent", () => {
        expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    });

    it("is stable for nested structures", () => {
        const one = canonicalJson({ z: { y: 1, x: [1, { b: 2, a: 3 }] } });
        const two = canonicalJson({ z: { x: [1, { a: 3, b: 2 }], y: 1 } });
        expect(one).toBe(two);
    });

    it("drops undefined values rather than emitting them", () => {
        expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    });

    it("distinguishes different documents", () => {
        expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
    });
});

describe("feedbackHash", () => {
    it("is the keccak-256 of the canonical bytes a buyer can recompute", () => {
        const doc = { agentId: "1", value: 100, clientAddress: "0xabc" };
        // Exactly what a buyer does: hash the served bytes.
        expect(feedbackHash(doc)).toBe(keccak256(stringToHex(canonicalJson(doc))));
    });

    it("is a 0x-prefixed 32-byte hex string", () => {
        expect(feedbackHash({ a: 1 })).toMatch(/^0x[0-9a-f]{64}$/u);
    });

    it("is stable across key ordering but changes with content", () => {
        expect(feedbackHash({ a: 1, b: 2 })).toBe(feedbackHash({ b: 2, a: 1 }));
        expect(feedbackHash({ a: 1 })).not.toBe(feedbackHash({ a: 2 }));
    });
});

describe("feedback document validation", () => {
    const valid = {
        agentRegistry: "0xRegistry",
        agentId: "42",
        clientAddress: "0xClient",
        createdAt: "2026-07-31T12:00:00.000Z",
        value: 100,
        valueDecimals: 2,
    };

    it("accepts a document carrying every required field", () => {
        expect(missingFeedbackFields(valid)).toEqual([]);
    });

    it("names each missing required field", () => {
        const { agentId, value, ...rest } = valid;
        void agentId; void value;
        expect(missingFeedbackFields(rest).sort()).toEqual(["agentId", "value"]);
    });

    it("accepts falsy-but-present values", () => {
        // value: 0 is a legitimate rating and must not read as missing.
        expect(missingFeedbackFields({ ...valid, value: 0, valueDecimals: 0 })).toEqual([]);
    });

    it("tracks exactly the fields the spec requires", () => {
        expect([...REQUIRED_FEEDBACK_FIELDS].sort()).toEqual(
            ["agentId", "agentRegistry", "clientAddress", "createdAt", "value", "valueDecimals"],
        );
    });
});
