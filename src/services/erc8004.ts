/**
 * ERC-8004 (Trustless Agents) off-chain surfaces.
 *
 * ERC-8004 keeps only compact signals on-chain: a client calls
 * `giveFeedback(agentId, value, valueDecimals, tag1, tag2, endpoint,
 * feedbackURI, feedbackHash)` on the Reputation Registry, and the detailed
 * feedback document lives off-chain behind `feedbackURI`, integrity-checked
 * by `feedbackHash` (KECCAK-256 of the document bytes).
 *
 * That off-chain half is the part a service operator can run WITHOUT
 * deploying or owning any contract, and it is all this module does:
 *   1. serve the registration file at /.well-known/agent-registration.json
 *   2. serve a per-call receipt the buyer can cite as payment evidence
 *   3. host a buyer-authored feedback document and return its canonical
 *      URI + KECCAK-256 hash, ready to pass to giveFeedback
 *
 * WHAT THIS IS NOT: WebLens is not registered on-chain, holds no agent id,
 * and writes nothing to any registry. A receipt is signed with the same
 * symmetric HMAC as proof-of-context, so it attests "WebLens served this
 * call" to anyone holding the key — it is NOT a third-party-verifiable
 * signature and must not be described as one.
 *
 * Spec: https://eips.ethereum.org/EIPS/eip-8004
 */

import { keccak256, stringToHex } from "viem";
import { PRICING, SUPPORTED_NETWORKS } from "../config";
import type { Env } from "../types";
import { signContext } from "./crypto";

export const ERC8004_REGISTRATION_TYPE =
    "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";

/** KV prefixes. Receipts and hosted feedback share the CACHE namespace. */
const RECEIPT_PREFIX = "receipt:";
const FEEDBACK_PREFIX = "feedback:";
/** 30 days — long enough for a buyer to post feedback well after the call. */
const RECEIPT_TTL_SECONDS = 60 * 60 * 24 * 30;

// ============================================
// Registration file (Identity)
// ============================================

/**
 * The ERC-8004 registration document. An agent id is only present once
 * someone registers this URI on-chain; until then `registrations` is empty
 * and we say so rather than inventing an id.
 */
export function buildRegistration(baseUrl: string) {
    return {
        type: ERC8004_REGISTRATION_TYPE,
        name: "WebLens",
        description:
            "Premium web intelligence API for AI agents: scraping, search verticals, crawling, extraction, and cited research. Pay per request in USDC on Base via x402 — no accounts, no API keys.",
        image: `${baseUrl}/favicon.png`,
        active: true,
        x402Support: true,
        services: [
            { name: "web", endpoint: baseUrl },
            { name: "MCP", endpoint: `${baseUrl}/mcp` },
            { name: "web", endpoint: `${baseUrl}/openapi.json`, version: "3.1.0" },
        ],
        /**
         * Populated only by an on-chain Identity Registry registration of
         * this document. Empty means exactly that: not registered.
         */
        registrations: [] as { agentId: string; agentRegistry: string }[],
        /**
         * Trust models this service actually supports today. Feedback is the
         * live one; we make no crypto-economic or TEE-attestation claims.
         */
        supportedTrust: ["feedback"],
        payment: {
            protocol: "x402",
            version: 2,
            networks: SUPPORTED_NETWORKS,
            asset: "USDC",
            priceRange: `${PRICING.memory.read} - ${PRICING.intel.competitive}`,
        },
        feedback: {
            /** Where a buyer turns a served call into citable payment evidence. */
            receiptEndpoint: `${baseUrl}/receipts/{requestId}`,
            /** Where a buyer can host a feedback document and get its hash. */
            submitEndpoint: `${baseUrl}/feedback`,
            hashAlgorithm: "keccak256",
        },
    };
}

// ============================================
// Receipts
// ============================================

export interface CallReceipt {
    type: "weblens-call-receipt-v1";
    requestId: string;
    endpoint: string;
    method: string;
    /** HTTP status the caller received. */
    status: number;
    outcome: "success" | "error";
    /** Charged price, e.g. "$0.015". Absent when the call was not charged. */
    price?: string;
    currency: "USD";
    /** "x402" or "credits". */
    paymentMethod?: string;
    network?: string;
    payTo?: string;
    servedAt: string;
    /** Symmetric HMAC over the receipt body — see the module header. */
    mac?: string;
    keyId?: string;
    alg?: string;
}

function receiptKey(requestId: string): string {
    return `${RECEIPT_PREFIX}${requestId}`;
}

/** Canonical JSON (sorted keys) so a hash is reproducible by the buyer. */
export function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(",")}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** KECCAK-256 of the canonical JSON — the value ERC-8004 wants as feedbackHash. */
export function feedbackHash(document: unknown): string {
    return keccak256(stringToHex(canonicalJson(document)));
}

/**
 * Build and persist a receipt for a served paid call. Never throws — a
 * receipt is an add-on, and losing one must not fail a paid request.
 */
export async function recordReceipt(
    env: Env,
    receipt: Omit<CallReceipt, "type" | "mac" | "keyId" | "alg">,
): Promise<CallReceipt | null> {
    const full: CallReceipt = { type: "weblens-call-receipt-v1", ...receipt };

    try {
        if (env.SIGNING_PRIVATE_KEY ?? env.CDP_API_KEY_SECRET) {
            const { mac, keyId, alg } = await signContext(
                full.endpoint,
                feedbackHash(full),
                full.servedAt,
                env,
            );
            full.mac = mac;
            full.keyId = keyId;
            full.alg = alg;
        }
    } catch {
        // Unsigned receipt is still useful evidence of the call.
    }

    try {
        await env.CACHE?.put(receiptKey(full.requestId), JSON.stringify(full), {
            expirationTtl: RECEIPT_TTL_SECONDS,
        });
    } catch {
        return full;
    }
    return full;
}

export async function getReceipt(env: Env, requestId: string): Promise<CallReceipt | null> {
    try {
        const raw = await env.CACHE?.get(receiptKey(requestId));
        return raw ? (JSON.parse(raw) as CallReceipt) : null;
    } catch {
        return null;
    }
}

// ============================================
// Hosted feedback documents
// ============================================

/** Fields ERC-8004 requires in the off-chain feedback document. */
export const REQUIRED_FEEDBACK_FIELDS = [
    "agentRegistry",
    "agentId",
    "clientAddress",
    "createdAt",
    "value",
    "valueDecimals",
] as const;

export function missingFeedbackFields(document: Record<string, unknown>): string[] {
    return REQUIRED_FEEDBACK_FIELDS.filter((field) => document[field] === undefined);
}

/**
 * Store a buyer-authored feedback document and return the URI + hash pair
 * they pass to `giveFeedback`. The document is stored verbatim: we host it,
 * we do not author or edit it.
 */
export async function hostFeedback(
    env: Env,
    baseUrl: string,
    document: Record<string, unknown>,
    id: string,
): Promise<{ feedbackURI: string; feedbackHash: string; storedAt: string }> {
    const body = canonicalJson(document);
    const hash = keccak256(stringToHex(body));
    const storedAt = new Date().toISOString();

    await env.CACHE?.put(`${FEEDBACK_PREFIX}${id}`, body, {
        expirationTtl: RECEIPT_TTL_SECONDS,
    });

    return { feedbackURI: `${baseUrl}/feedback/${id}`, feedbackHash: hash, storedAt };
}

export async function getFeedback(env: Env, id: string): Promise<string | null> {
    try {
        return (await env.CACHE?.get(`${FEEDBACK_PREFIX}${id}`)) ?? null;
    } catch {
        return null;
    }
}
