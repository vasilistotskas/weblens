# Coinbase Bazaar Discovery Setup

This guide shows you how to get WebLens listed in the Coinbase Bazaar discovery catalog so AI agents can find and use your API.

## What is Bazaar?

Bazaar is the discovery layer for x402-enabled APIs. Think of it as "Google for AI agent services." When you're listed in Bazaar:
- ✅ AI agents can discover your API automatically
- ✅ Your endpoints appear in search results
- ✅ Agents can see your pricing, schemas, and descriptions
- ✅ No manual integration needed - agents pay and use instantly

## Requirements

To be listed in Bazaar, you MUST:
1. Use the **CDP facilitator** from `@coinbase/x402`
2. Set `discoverable: true` on your endpoints (already done ✅)
3. Provide CDP API keys for payment verification

## Step-by-Step Setup

### 1. Get CDP API Keys

1. Go to https://portal.cdp.coinbase.com
2. Create an account / sign in
3. Create a project (if you don't have one)
4. Go to **Settings → API Keys → Create API Key**
5. Copy the **Key ID** and **Secret**

**Example:**
```
Key ID: a1b2c3d4-5678-90ab-cdef-1234567890ab
Secret: abcdefghijklmnopqrstuvwxyz0123456789
```

### 2. Add Keys to wrangler.toml

Open `wrangler.toml` and replace the placeholders with your actual keys:

```toml
[vars]
NETWORK = "base"
CDP_API_KEY_ID = "a1b2c3d4-5678-90ab-cdef-1234567890ab"  # ← Your actual Key ID
CDP_API_KEY_SECRET = "abcdefghijklmnopqrstuvwxyz0123456789"  # ← Your actual Secret
```

Also update the production environment:

```toml
[env.production.vars]
NETWORK = "base"
CDP_API_KEY_ID = "a1b2c3d4-5678-90ab-cdef-1234567890ab"  # ← Same keys
CDP_API_KEY_SECRET = "abcdefghijklmnopqrstuvwxyz0123456789"
```

**⚠️ IMPORTANT:** While these are in `[vars]` (not secrets), they're still sensitive. Consider:
- Adding `wrangler.toml` to `.gitignore` if you commit keys
- Using environment variables for extra security (see Alternative Method below)

### 3. Deploy to Production

```bash
npx wrangler deploy --env production
```

### 4. Verify Bazaar Listing

Wait 5-10 minutes for Coinbase to index your endpoints, then run:

```bash
npm run verify-bazaar
```

**Expected output:**
```
✅ Found 14 WebLens resources in Bazaar!

📋 Endpoint Verification:

✅ Found in Bazaar:
   ✓ /fetch/basic
   ✓ /fetch/pro
   ✓ /screenshot
   ✓ /search
   ✓ /extract
   ... (all 14 endpoints)

🎉 All endpoints are properly listed in Bazaar!
```

### 5. Test Payments

Your API will now:
- ✅ Accept payments via CDP facilitator
- ✅ Be discoverable in Bazaar
- ✅ Verify payments using your CDP API keys

Test it:

```bash
$env:PRIVATE_KEY='0xYourPrivateKey'; npx ts-node scripts/test-payment.ts
```

## Alternative Method: Environment Variables

For extra security, you can set CDP keys as environment variables instead of in `wrangler.toml`:

```bash
# PowerShell (Windows)
$env:CDP_API_KEY_ID='your-key-id'
$env:CDP_API_KEY_SECRET='your-secret'
npx wrangler deploy --env production

# Bash (Linux/Mac)
export CDP_API_KEY_ID='your-key-id'
export CDP_API_KEY_SECRET='your-secret'
npx wrangler deploy --env production
```

Then remove the keys from `wrangler.toml` and replace with:

```toml
[vars]
NETWORK = "base"
# CDP_API_KEY_ID and CDP_API_KEY_SECRET are set via environment variables
```

## How It Works

1. **CDP Facilitator Initialization:**
   ```typescript
   const CDP_FACILITATOR = createFacilitatorConfig(
     process.env.CDP_API_KEY_ID,
     process.env.CDP_API_KEY_SECRET
   );
   ```

2. **Payment Flow:**
   - Client requests endpoint → Gets 402 Payment Required
   - Client signs USDC payment with wallet
   - Client retries with X-PAYMENT header
   - **Server calls CDP facilitator's /verify endpoint** (uses your API keys)
   - CDP verifies signature and returns success
   - Server returns data to client

3. **Bazaar Discovery:**
   - CDP facilitator automatically ingests your endpoints
   - Endpoints with `discoverable: true` appear in Bazaar
   - AI agents can query: `GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources`
   - Your WebLens endpoints show up in results!

## Troubleshooting

### "invalid_payload" Error

**Cause:** CDP facilitator can't verify payments

**Solutions:**
1. Check CDP_API_KEY_ID and CDP_API_KEY_SECRET are set correctly
2. Verify keys are valid at https://portal.cdp.coinbase.com
3. Ensure you deployed after adding keys
4. Check wrangler logs: `npx wrangler tail --env production`

### Not Appearing in Bazaar

**Cause:** Either not deployed or CDP keys missing

**Solutions:**
1. Confirm deployment: `curl https://api.weblens.dev/health`
2. Wait 10-15 minutes for indexing
3. Check `discoverable: true` is set (already done ✅)
4. Verify CDP_API_KEY_ID and CDP_API_KEY_SECRET are in wrangler.toml
5. Run: `npm run verify-bazaar`

### Using PayAI Facilitator Instead

If you don't want Bazaar listing (or want to test first):

```typescript
// In src/index.ts, set:
const FACILITATOR = PAYAI_FACILITATOR;
```

**Pros:** No API keys needed, works immediately
**Cons:** NOT listed in Bazaar, agents can't discover you

## Verification Checklist

- [ ] CDP API keys obtained from https://portal.cdp.coinbase.com
- [ ] Keys added to `wrangler.toml` under `[vars]` and `[env.production.vars]`
- [ ] Deployed with `npx wrangler deploy --env production`
- [ ] Waited 10 minutes for Bazaar indexing
- [ ] Verified listing with `npm run verify-bazaar`
- [ ] Tested payments with `npx ts-node scripts/test-payment.ts`

## Resources

- Bazaar Discovery Endpoint: https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources
- CDP Portal: https://portal.cdp.coinbase.com
- x402 Protocol: https://x402.org
- WebLens API Docs: https://api.weblens.dev/docs
