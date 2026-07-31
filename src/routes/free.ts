import type { Hono } from "hono";
import { rateLimitMiddleware } from "../middleware/rate-limit";
import { validateRequest } from "../middleware/validation";
import { PreviewRequestSchema } from "../schemas";

// Tool handlers + their canonical free-tier request schemas
import { freeFetch, freeSearch, freeFetchSchema, freeSearchSchema } from "../tools/free";
import {
    agentRegistrationHandler,
    getFeedbackHandler,
    previewHandler,
    receiptHandler,
    submitFeedbackHandler,
} from "../tools/preview";
import type { Env, Variables } from "../types";

export function registerFreeRoutes(app: Hono<{ Bindings: Env; Variables: Variables }>) {

    // ============================================
    // /free/fetch
    // ============================================
    app.use("/free/fetch", rateLimitMiddleware);
    app.use("/free/fetch", validateRequest(freeFetchSchema));
    app.post("/free/fetch", freeFetch);

    // ============================================
    // /free/search
    // ============================================
    app.use("/free/search", rateLimitMiddleware);
    app.use("/free/search", validateRequest(freeSearchSchema));
    app.post("/free/search", freeSearch);

    // ============================================
    // /preview — see the price and a real response sample before paying
    // ============================================
    // Rate limited because the live branch performs a real fetch. Never calls
    // a paid upstream, so it cannot cost us money (see services/previews.ts).
    app.use("/preview", rateLimitMiddleware);
    app.use("/preview", validateRequest(PreviewRequestSchema));
    app.post("/preview", previewHandler);

    // ============================================
    // ERC-8004 off-chain surfaces (free)
    // ============================================
    // Registration document — the URI an Identity Registry entry points at.
    app.get("/.well-known/agent-registration.json", agentRegistrationHandler);

    // Receipt for a paid call: the buyer's payment evidence.
    app.get("/receipts/:requestId", receiptHandler);

    // Host a buyer-authored feedback document and hand back the
    // (feedbackURI, feedbackHash) pair that giveFeedback() expects.
    app.use("/feedback", rateLimitMiddleware);
    app.post("/feedback", submitFeedbackHandler);
    app.get("/feedback/:id", getFeedbackHandler);
}
