/**
 * Domain intelligence.
 *
 * The registration and DNS records are commodities — the derivation is the
 * product, so that is what is pinned here: which SaaS vendors a TXT record
 * betrays, which mail platform an MX points at, and which risk signals fire.
 *
 * `normalizeDomain` is also security-relevant: its output is interpolated
 * into upstream registry and resolver lookups, so it must reject anything
 * that is not a plain public hostname.
 */

import { describe, expect, it } from "vitest";
import { derive, normalizeDomain, type Registration } from "../../src/services/domain-intel";

const FOUND: Registration = {
    found: true,
    registrar: "MarkMonitor Inc.",
    registeredAt: "2015-01-01T00:00:00Z",
    expiresAt: "2030-01-01T00:00:00Z",
    status: ["client transfer prohibited", "client delete prohibited"],
    nameservers: ["ns-1.awsdns-07.org"],
};

/**
 * ISO string N days from now, for age/expiry assertions that cannot be fixed
 * constants. Future dates get an hour of cushion: the report floors partial
 * days, so a timestamp exactly N days out lands microseconds short and floors
 * to N-1 by the time the assertion runs.
 */
function daysFromNow(days: number): string {
    const cushion = days > 0 ? 3_600_000 : 0;
    return new Date(Date.now() + days * 86_400_000 + cushion).toISOString();
}

describe("normalizeDomain", () => {
    it("accepts a bare domain and strips www", () => {
        expect(normalizeDomain("stripe.com")).toBe("stripe.com");
        expect(normalizeDomain("www.stripe.com")).toBe("stripe.com");
        expect(normalizeDomain("  STRIPE.COM  ")).toBe("stripe.com");
        expect(normalizeDomain("stripe.com.")).toBe("stripe.com");
    });

    it("reduces a full URL to its hostname", () => {
        expect(normalizeDomain("https://stripe.com/pricing?x=1")).toBe("stripe.com");
        expect(normalizeDomain("http://www.stripe.com")).toBe("stripe.com");
    });

    it("keeps subdomains, which are legitimate lookups", () => {
        expect(normalizeDomain("api.weblens.dev")).toBe("api.weblens.dev");
    });

    it("strips a path pasted without a scheme", () => {
        expect(normalizeDomain("stripe.com/pricing")).toBe("stripe.com");
    });

    it("rejects anything that is not a public hostname", () => {
        for (const bad of [
            "", "   ", "localhost", "127.0.0.1", "192.168.1.1", "::1",
            "stripe.com:8080", "user@stripe.com", "no-dot", "-lead.com",
            "stripe..com", "stri pe.com", "http://[::1]/",
        ]) {
            expect(normalizeDomain(bad), `should reject ${JSON.stringify(bad)}`).toBeNull();
        }
    });

    it("rejects an over-long name", () => {
        expect(normalizeDomain(`${"a".repeat(250)}.com`)).toBeNull();
    });
});

describe("SaaS stack from TXT verification tokens", () => {
    it("names the vendors behind verification tokens", () => {
        const report = derive("acme.com", FOUND, {
            TXT: [
                "google-site-verification=abc123",
                "MS=ms80697640",
                "atlassian-domain-verification=xyz",
                "docusign=9f8e7d",
                "v=spf1 include:_spf.google.com ~all",
            ],
        }, []);

        expect(report.stack).toEqual(["Atlassian", "DocuSign", "Google Workspace", "Microsoft 365"]);
    });

    it("recognises a Salesforce org id, which has no named prefix", () => {
        const report = derive("acme.com", FOUND, {
            TXT: ["00D50000000JV6w=1TBTQ0000000CIv"],
        }, []);
        expect(report.stack).toContain("Salesforce");
    });

    it("is case-insensitive and does not invent vendors", () => {
        const report = derive("acme.com", FOUND, {
            TXT: ["GOOGLE-SITE-VERIFICATION=abc", "some-unknown-token=1"],
        }, []);
        expect(report.stack).toEqual(["Google Workspace"]);
    });

    it("returns an empty stack rather than guessing", () => {
        expect(derive("acme.com", FOUND, { TXT: ["v=spf1 -all"] }, []).stack).toEqual([]);
    });
});

describe("provider detection", () => {
    it("identifies the mail platform from MX", () => {
        const google = derive("a.com", FOUND, { MX: ["10 aspmx.l.google.com."] }, []);
        expect(google.email.provider).toBe("Google Workspace");

        const ms = derive("a.com", FOUND, { MX: ["0 acme-com.mail.protection.outlook.com."] }, []);
        expect(ms.email.provider).toBe("Microsoft 365");

        const proofpoint = derive("a.com", FOUND, { MX: ["10 mx1.pphosted.com."] }, []);
        expect(proofpoint.email.provider).toBe("Proofpoint");
    });

    it("identifies the DNS operator from NS", () => {
        expect(derive("a.com", FOUND, { NS: ["ns-1.awsdns-07.org."] }, []).hosting.dnsProvider)
            .toBe("AWS Route 53");
        expect(derive("a.com", FOUND, { NS: ["kim.ns.cloudflare.com."] }, []).hosting.dnsProvider)
            .toBe("Cloudflare");
        // Cloudflare's enterprise nameservers live on their own domain, so a
        // *.ns.cloudflare.com match alone misses large sites like shopify.com.
        expect(derive("a.com", FOUND, { NS: ["gold.foundationdns.com."] }, []).hosting.dnsProvider)
            .toBe("Cloudflare Foundation DNS");
    });

    it("falls back to RDAP nameservers when DNS NS is missing", () => {
        expect(derive("a.com", FOUND, {}, []).hosting.dnsProvider).toBe("AWS Route 53");
    });

    it("leaves the provider unset rather than guessing", () => {
        expect(derive("a.com", FOUND, { MX: ["10 mail.selfhosted.example."] }, []).email.provider)
            .toBeUndefined();
    });
});

describe("email posture", () => {
    it("reads SPF presence and the DMARC policy", () => {
        const report = derive("a.com", FOUND,
            { TXT: ["v=spf1 include:_spf.google.com ~all"], MX: ["10 aspmx.l.google.com."] },
            ["v=DMARC1; p=reject; rua=mailto:d@a.com"]);

        expect(report.email.hasSpf).toBe(true);
        expect(report.email.hasDmarc).toBe(true);
        expect(report.email.dmarcPolicy).toBe("reject");
        expect(report.signals).not.toContain("no-spf");
        expect(report.signals).not.toContain("no-dmarc");
    });

    it("flags a monitor-only DMARC policy, which enforces nothing", () => {
        const report = derive("a.com", FOUND, { MX: ["10 x."] }, ["v=DMARC1; p=none"]);
        expect(report.email.dmarcPolicy).toBe("none");
        expect(report.signals).toContain("dmarc-monitor-only");
    });

    it("flags missing SPF, DMARC and MX", () => {
        const report = derive("a.com", FOUND, {}, []);
        expect(report.signals).toEqual(expect.arrayContaining(["no-spf", "no-dmarc", "no-mx"]));
    });
});

describe("risk signals", () => {
    it("flags a newly registered domain", () => {
        const fresh: Registration = { ...FOUND, registeredAt: daysFromNow(-11) };
        const report = derive("a.com", fresh, { MX: ["10 x."] }, ["v=DMARC1; p=reject"]);

        expect(report.signals).toContain("newly-registered");
        expect(report.ageDays).toBe(11);
    });

    it("does not flag an established domain", () => {
        const report = derive("a.com", FOUND, { MX: ["10 x."] }, ["v=DMARC1; p=reject"]);
        expect(report.signals).not.toContain("newly-registered");
        expect(report.ageDays).toBeGreaterThan(3000);
    });

    it("flags expiry that is imminent or past", () => {
        const soon = derive("a.com", { ...FOUND, expiresAt: daysFromNow(9) }, {}, []);
        expect(soon.signals).toContain("expiring-soon");
        expect(soon.expiresInDays).toBe(9);

        const gone = derive("a.com", { ...FOUND, expiresAt: daysFromNow(-5) }, {}, []);
        expect(gone.signals).toEqual(expect.arrayContaining(["expiring-soon", "expired"]));
    });

    it("flags a domain with no registrar transfer lock", () => {
        const unlocked = derive("a.com", { ...FOUND, status: ["active"] }, {}, []);
        expect(unlocked.signals).toContain("no-registrar-lock");

        const locked = derive("a.com", FOUND, {}, []);
        expect(locked.signals).not.toContain("no-registrar-lock");
    });

    it("says so when registration could not be read, instead of implying it is fine", () => {
        const report = derive("a.com", { found: false }, {}, []);
        expect(report.signals).toContain("registration-unavailable");
        // An unknown registration must not masquerade as a missing lock.
        expect(report.signals).not.toContain("no-registrar-lock");
        expect(report.ageDays).toBeUndefined();
    });

    it("reports a clean domain with no signals at all", () => {
        const report = derive("a.com", FOUND,
            { MX: ["10 aspmx.l.google.com."], TXT: ["v=spf1 -all"] },
            ["v=DMARC1; p=reject"]);
        expect(report.signals).toEqual([]);
    });
});
