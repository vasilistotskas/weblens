import type { Hono } from "hono";
import { PRICING } from "../config";
import { createCreditMiddleware } from "../middleware/credit-middleware";
import { createLazyPaymentMiddleware } from "../middleware/payment";
import { validateRequest } from "../middleware/validation";
// Tool Handlers + their canonical per-endpoint request schemas.
import { ProjectAuditRequestSchema } from "../schemas";
import { projectAuditHandler } from "../tools/project-audit";
import type { Env, Variables } from "../types";

export function registerIntelRoutes(app: Hono<{ Bindings: Env; Variables: Variables }>) {
    // ============================================
    // /intel/project — off-chain project due diligence
    // ============================================
    app.use(
        "/intel/project",
        validateRequest(ProjectAuditRequestSchema),
        createCreditMiddleware(PRICING.intel.project, "Project Due Diligence"),
        createLazyPaymentMiddleware(
            "/intel/project",
            PRICING.intel.project,
            "Off-chain due diligence on a project's web presence — the half on-chain rug checkers cannot see. Domain age and registrar, whether a team page, whitepaper, docs and socials exist, whether the site is an off-the-shelf template, and a cross-check of the contract address you are about to trade against the addresses actually printed on the project's own website. Returns weighted risk signals and an A-F grade. Reads nothing on-chain: pair it with a contract/liquidity checker.",
            { domain: "example.org", tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", chain: "base" },
            {
                properties: {
                    domain: { type: "string", description: "Project website, e.g. \"example.org\"" },
                    tokenAddress: { type: "string", description: "Optional contract address to cross-check against the site" },
                    chain: { type: "string", description: "Optional chain label, e.g. base, ethereum, solana" },
                },
                required: ["domain"],
            },
            {
                project: { input: "example.org", domain: "example.org", reachable: true, status: 200, title: "Example Project" },
                domain: { registeredAt: "2021-04-02T00:00:00Z", ageDays: 1950, registrar: "NameCheap, Inc.", found: true },
                site: { technologies: [{ name: "Next.js", category: "framework", evidence: "html contains \"/_next/static\"" }], categories: { framework: ["Next.js"] }, looksTemplated: false },
                content: { pages: { team: true, whitepaper: true, docs: true }, socials: { twitter: "https://x.com/example", github: "https://github.com/example" }, contractAddresses: ["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"] },
                crossCheck: { queried: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", chain: "base", foundOnSite: true, otherAddressesOnSite: [] },
                signals: [],
                risk: { score: 0, grade: "A", summary: "No off-chain risk signals. The web presence is consistent with an established project." },
                auditedAt: "2026-08-05T12:00:00.000Z",
                requestId: "req_proj123",
            },
            {
                properties: {
                    project: { type: "object", description: "input, domain, reachable, status, title" },
                    domain: { type: "object", description: "RDAP facts: registeredAt, ageDays, expiresAt, registrar, nameservers, found" },
                    site: { type: "object", description: "technologies with evidence, categories, generator, looksTemplated" },
                    content: { type: "object", description: "pages present (team/whitepaper/docs/tokenomics/audit/roadmap), socials, contractAddresses found on the site" },
                    crossCheck: { type: "object", description: "queried address, whether it appears on the site, and any other addresses that do" },
                    signals: { type: "array", description: "Weighted off-chain risk signals" },
                    risk: { type: "object", description: "score 0-100, grade A-F, summary" },
                    disclaimer: { type: "string" },
                    auditedAt: { type: "string" },
                    requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/intel/project", projectAuditHandler);
}
