## What does Company Profile from Domain do?

Give it a list of company domains and it returns one profile per company, **read live from the company's own website** at the moment you run it. You don't get a database snapshot that went stale months ago. Each profile tells you:

- **What the company does**, its products or services, and who it sells to
- **Pricing**: the pricing model (free, freemium, subscription, usage-based, one-time, contact sales) and the plans listed on its pricing page
- **Industry**: its 2022 NAICS sector, classified from the site's own text
- **Head count**: only when the company states it, with the exact words or the schema.org value it publishes as evidence. Nothing is estimated.
- **Hiring**: open roles, top teams and locations from its public Greenhouse, Lever or Ashby job board
- **Tech stack** detected from the homepage, and **social profiles** linked from it
- **Security contacts** from its `security.txt`: role mailboxes and company pages only
- **Domain facts**: registrar, domain age, email provider, SPF/DMARC posture and SaaS vendors from DNS verification records

Every field read by the AI names **the page it came from**. A `coverage` object marks each part true or false, so you can tell "not on the site" from "not asked".

## Why use it?

- **Lead enrichment and qualification**: sector, size and pricing model for every account in your CRM.
- **Market research**: map a list of competitors' offerings, pricing and hiring in one run.
- **Sales prospecting**: see who is hiring, and for which teams, before you reach out.
- **Due diligence**: check a vendor's domain age, email security and security contact.

## What it does not do

It collects **company-level facts only**: no people, no personal emails or phone numbers. It honours each site's `robots.txt`; pages a site disallows are listed in `skipped`. It never estimates a head count; when a site doesn't state one, `size` is absent.

## How to use it

1. Enter one domain per line in **Company domains**, e.g. `gitlab.com`. A full URL such as `https://www.gitlab.com/about` also works.
2. Click **Start**. Each profile takes about 3–10 seconds; five are fetched at a time.
3. Download the results as JSON, CSV or Excel from the **Output** tab, or read them through the Apify API.

## Input example

```json
{ "domains": ["gitlab.com", "vercel.com", "stripe.com"] }
```

## Output example

```json
{
  "input": "gitlab.com",
  "name": "GitLab",
  "description": "GitLab is an intelligent orchestration platform where teams and their AI agents plan, build, secure, and ship software across the full software lifecycle, with source control, CI/CD, security scanning, and governance in one platform.",
  "offerings": ["GitLab Duo Agent Platform", "Code Suggestions (AI)", "CI/CD", "GitLab Dedicated", "Application Security Testing"],
  "industry": { "naicsSector": "51", "name": "Information", "basis": "estimated", "source": "https://about.gitlab.com/company/" },
  "size": { "band": "1001-5000", "employees": { "min": 2500, "max": 2500 }, "basis": "self-reported", "evidence": "schema.org numberOfEmployees: 2500", "source": "https://about.gitlab.com/" },
  "pricing": { "pageUrl": "https://about.gitlab.com/pricing/", "model": "subscription", "plans": [{ "name": "Free", "price": "$0", "period": "per user/month" }, { "name": "Premium", "price": "$29", "period": "per user/month, billed annually" }, { "name": "Ultimate", "price": "Custom pricing" }] },
  "coverage": { "name": true, "description": true, "offerings": true, "audience": true, "pricing": true, "hiring": false, "size": true, "industry": true, "tech": true, "socials": true, "securityContacts": true }
}
```

Each item also carries `pages`, `socials`, `tech`, `domainFacts`, `securityContacts`, `sources`, `skipped` and `profiledAt`.

## Pricing

You pay **per profile delivered**. A domain whose website cannot be read, or that has nothing to profile, **costs nothing**; it is listed in the run's `OUTPUT` record with the reason. The run stops cleanly when it reaches the maximum charge you set for it.

## FAQ

**Why is `size` missing for some companies?** Most websites don't state a head count. Rather than guess, the Actor leaves it out and sets `coverage.size` to false.

**How fresh is the data?** It is read from the live website during your run.

**Is the industry exact?** No. It is the NAICS sector that best matches the site's own description, which is why it is marked `"basis": "estimated"`.

**A site blocks automated access. What happens?** The profile fails for that domain and you are not charged.
