# Design Document: WebLens Phase 2

## Overview

WebLens Phase 2 extends the web intelligence API with high-value features targeting AI agents in the x402 Bazaar ecosystem. The focus is on batch operations, AI-powered extraction, research automation, URL monitoring for recurring revenue, and document processing.

## Business Context

### Target Users
- **AI Agents**: Autonomous systems discovering services via x402 Bazaar
- **MCP Clients**: Model Context Protocol clients needing comprehensive web intelligence
- **Developers**: Building applications requiring batch web operations and monitoring

### Revenue Model
| Endpoint | Price | Est. Daily Volume | Daily Revenue |
|----------|-------|-------------------|---------------|
| `/batch/fetch` | $0.003/URL | 5000 URLs (500 requests) | $15 |
| `/research` | $0.08 | 200 | $16 |
| `/extract/smart` | $0.025 | 400 | $10 |
| `/monitor/create` | $0.01 | 50 | $0.50 |
| `/monitor` checks | $0.001 | 2400 (100 monitors × 24) | $2.40 |
| `/pdf` | $0.01 | 300 | $3 |
| `/compare` | $0.05 | 100 | $5 |
| `/memory/set` | $0.001 | 5000 | $5 |
| `/memory/get` | $0.0005 | 10000 | $5 |
| **Phase 2 Total** | | | **$61.90/day** |
| **Phase 1 Total** | | | **$36.50/day** |
| **Combined Total** | | | **$98.40/day** |

### Competitive Advantages
1. **Batch Operations** - Efficient multi-URL processing for research tasks
2. **AI-Powered Extraction** - Natural language queries instead of rigid schemas
3. **Research Bundles** - One-stop research combining search + fetch + summarize
4. **Recurring Revenue** - URL monitoring creates passive income stream
5. **Agent Memory** - Persistent storage creates stickiness, agents keep coming back
6. **Bazaar Discovery** - All endpoints discoverable by AI agents

## Architecture

```mermaid
graph TB
    subgraph "Client Layer"
        AI[AI Agent]
        MCP[MCP Client]
    end
    
    subgraph "Cloudflare Workers"
        HN[Hono Router]
        PM[x402 Payment Middleware]
        
        subgraph "Phase 2 Endpoints"
            BF[/batch/fetch]
            RS[/research]
            ES[/extract/smart]
            MN[/monitor]
            PDF[/pdf]
            CMP[/compare]
        end
        
        subgraph "Services"
            BS[Batch Service]
            RSV[Research Service]
            AI_SVC[AI Service - Claude]
            MON[Monitor Service]
            PDF_SVC[PDF Service]
        end
    end
    
    subgraph "External Services"
        KV[(Cloudflare KV)]
        DO[(Durable Objects)]
        CLAUDE[Claude API]
    end
    
    AI --> HN
    MCP --> HN
    HN --> PM
    PM --> BF & RS & ES & MN & PDF & CMP
    BF --> BS
    RS --> RSV --> AI_SVC
    ES --> AI_SVC
    MN --> MON --> DO
    PDF --> PDF_SVC
    CMP --> AI_SVC
    AI_SVC --> CLAUDE
    MON --> KV
```

## Components and Interfaces

### 1. Batch Fetch Service

Fetches multiple URLs in parallel with efficient error handling.

```typescript
interface BatchFetchRequest {
  urls: string[];           // 2-20 URLs
  timeout?: number;         // Per-URL timeout, default 10000ms
  tier?: "basic" | "pro";   // Fetch tier, default "basic"
}

interface BatchFetchResult {
  url: string;
  status: "success" | "error";
  content?: string;         // Markdown content if success
  title?: string;
  metadata?: PageMetadata;
  error?: string;           // Error message if failed
  fetchedAt: string;
}

interface BatchFetchResponse {
  results: BatchFetchResult[];
  summary: {
    total: number;
    successful: number;
    failed: number;
  };
  totalPrice: string;       // e.g., "$0.030" for 10 URLs
  requestId: string;
}
```

### 2. Research Service

Combines search, fetch, and AI summarization into one request.

```typescript
interface ResearchRequest {
  query: string;            // Research topic/question
  resultCount?: number;     // 1-10, default 5
  includeRawContent?: boolean; // Include full fetched content
}

interface ResearchSource {
  url: string;
  title: string;
  snippet: string;
  content?: string;         // Full content if includeRawContent
  fetchedAt: string;
}

interface ResearchResponse {
  query: string;
  sources: ResearchSource[];
  summary: string;          // AI-generated summary
  keyFindings: string[];    // Bullet points of key findings
  researchedAt: string;
  requestId: string;
}
```

### 3. Smart Extraction Service

AI-powered extraction using natural language queries.

```typescript
interface SmartExtractRequest {
  url: string;
  query: string;            // e.g., "find all email addresses"
  format?: "json" | "text"; // Output format, default "json"
}

interface ExtractedItem {
  value: unknown;           // Extracted value
  context?: string;         // Surrounding context
  confidence: number;       // 0-1 confidence score
}

interface SmartExtractResponse {
  url: string;
  query: string;
  data: ExtractedItem[];
  explanation: string;      // AI explanation of extraction
  extractedAt: string;
  requestId: string;
}
```

### 4. Monitor Service

URL monitoring with webhook notifications.

```typescript
interface MonitorCreateRequest {
  url: string;
  webhookUrl: string;
  checkInterval?: number;   // Hours, 1-24, default 1
  notifyOn?: "any" | "content" | "status"; // What triggers notification
}

interface MonitorCreateResponse {
  monitorId: string;
  url: string;
  webhookUrl: string;
  checkInterval: number;
  nextCheckAt: string;
  createdAt: string;
  requestId: string;
}

interface MonitorStatus {
  monitorId: string;
  url: string;
  status: "active" | "paused" | "error";
  lastCheck?: {
    checkedAt: string;
    changed: boolean;
    contentHash: string;
  };
  checkCount: number;
  totalCost: string;        // Total spent on checks
  createdAt: string;
}

interface WebhookPayload {
  monitorId: string;
  url: string;
  changeType: "content" | "status" | "error";
  previousHash?: string;
  currentHash?: string;
  diff?: string;            // Summary of changes
  checkedAt: string;
}
```

### 5. PDF Extraction Service

Extracts text and metadata from PDF documents.

```typescript
interface PdfExtractRequest {
  url: string;
  pages?: number[];         // Specific pages, or all if omitted
}

interface PdfPage {
  pageNumber: number;
  content: string;
}

interface PdfExtractResponse {
  url: string;
  metadata: {
    title?: string;
    author?: string;
    pageCount: number;
    createdAt?: string;
  };
  pages: PdfPage[];
  fullText: string;         // All pages concatenated
  extractedAt: string;
  requestId: string;
}
```

### 6. Compare Service

Compares multiple URLs with AI-generated analysis.

```typescript
interface CompareRequest {
  urls: string[];           // 2-3 URLs
  focus?: string;           // What to focus comparison on
}

interface CompareSource {
  url: string;
  title: string;
  content: string;
}

interface CompareResponse {
  sources: CompareSource[];
  comparison: {
    similarities: string[];
    differences: string[];
    summary: string;        // AI-generated comparison summary
  };
  comparedAt: string;
  requestId: string;
}
```

### 7. Agent Memory Service

Persistent key-value storage for AI agents, isolated by wallet address.

```typescript
interface MemorySetRequest {
  key: string;              // Max 256 chars
  value: unknown;           // JSON-serializable, max 100KB
  ttl?: number;             // Hours, 1-720 (30 days), default 168 (7 days)
}

interface MemorySetResponse {
  key: string;
  stored: boolean;
  expiresAt: string;
  requestId: string;
}

interface MemoryGetResponse {
  key: string;
  value: unknown;
  storedAt: string;
  expiresAt: string;
  requestId: string;
}

interface MemoryListResponse {
  keys: string[];
  count: number;
  requestId: string;
}
```

### 8. Pricing Configuration

```typescript
const PHASE2_PRICING = {
  batchFetch: {
    perUrl: "$0.003",
    minUrls: 2,
    maxUrls: 20,
  },
  research: "$0.08",
  smartExtract: "$0.025",
  monitor: {
    setup: "$0.01",
    perCheck: "$0.001",
    minInterval: 1,   // hours
    maxInterval: 24,  // hours
  },
  pdf: "$0.01",
  compare: "$0.05",
  memory: {
    write: "$0.001",
    read: "$0.0005",
    minTtl: 1,        // hours
    maxTtl: 720,      // 30 days
    defaultTtl: 168,  // 7 days
  },
} as const;
```

## Data Models

### Monitor Storage (KV)

```typescript
// Key: monitor:{monitorId}
interface StoredMonitor {
  id: string;
  url: string;
  webhookUrl: string;
  checkInterval: number;
  notifyOn: "any" | "content" | "status";
  status: "active" | "paused" | "error";
  lastContentHash?: string;
  lastStatusCode?: number;
  checkCount: number;
  totalCost: number;        // In cents
  createdAt: string;
  lastCheckAt?: string;
  nextCheckAt: string;
  ownerId?: string;         // Wallet address
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Batch fetch returns results for all URLs
*For any* batch fetch request with N URLs (2 ≤ N ≤ 20), the response SHALL contain exactly N results, one for each input URL.
**Validates: Requirements 1.1, 1.6**

### Property 2: Batch fetch pricing is linear
*For any* batch fetch request with N URLs, the total price SHALL equal N × $0.003.
**Validates: Requirements 1.4**

### Property 3: Batch fetch bounds validation
*For any* batch fetch request with fewer than 2 URLs or more than 20 URLs, the system SHALL return a validation error.
**Validates: Requirements 1.2, 1.3**

### Property 4: Research response completeness
*For any* research request, the response SHALL include the original query, sources array, and AI-generated summary.
**Validates: Requirements 2.1, 2.5**

### Property 5: Research result count bounds
*For any* research request with result count N (1 ≤ N ≤ 10), the response SHALL contain at most N sources.
**Validates: Requirements 2.3**

### Property 6: Smart extraction response structure
*For any* smart extraction request, the response SHALL include extracted data array with confidence scores for each item.
**Validates: Requirements 3.1, 3.4**

### Property 7: Monitor interval bounds
*For any* monitor creation request, the check interval SHALL be clamped to 1-24 hours.
**Validates: Requirements 4.7**

### Property 8: Monitor lifecycle consistency
*For any* created monitor, GET /monitor/:id SHALL return the monitor status, and DELETE /monitor/:id SHALL remove it.
**Validates: Requirements 4.5, 4.6**

### Property 9: PDF response structure
*For any* PDF extraction request, the response SHALL include page count, pages array with content, and full concatenated text.
**Validates: Requirements 5.1, 5.3, 5.6**

### Property 10: Compare URL bounds
*For any* compare request with fewer than 2 URLs, the system SHALL return a validation error.
**Validates: Requirements 6.6**

### Property 11: Compare response completeness
*For any* compare request with 2-3 URLs, the response SHALL include fetched content for each URL and AI-generated comparison.
**Validates: Requirements 6.1, 6.5**

### Property 12: Phase 2 endpoints documented
*For any* GET request to `/`, the response SHALL include documentation for all Phase 2 endpoints with pricing.
**Validates: Requirements 8.3**

### Property 13: Memory write returns confirmation
*For any* memory set request with valid key and value, the response SHALL include the key, stored status, and expiration time.
**Validates: Requirements 7.1, 7.8**

### Property 14: Memory read returns stored value
*For any* memory get request for an existing key, the response SHALL return the exact value that was stored.
**Validates: Requirements 7.3**

### Property 15: Memory isolation by wallet
*For any* two different wallet addresses, stored keys SHALL be isolated and not accessible across wallets.
**Validates: Requirements 7.6**

### Property 16: Memory TTL bounds
*For any* memory set request with TTL, the TTL SHALL be clamped to 1-720 hours.
**Validates: Requirements 7.8**

### Property 17: All endpoints discoverable
*For any* Phase 2 endpoint registered with the facilitator, the discoverable flag SHALL be true.
**Validates: Requirements 8.1**

## Error Handling

| Error Code | HTTP Status | Description | Retry? |
|------------|-------------|-------------|--------|
| `BATCH_TOO_SMALL` | 400 | Fewer than 2 URLs provided | No |
| `BATCH_TOO_LARGE` | 400 | More than 20 URLs provided | No |
| `INVALID_PDF` | 400 | URL does not point to valid PDF | No |
| `PDF_TOO_LARGE` | 400 | PDF exceeds size limit | No |
| `MONITOR_NOT_FOUND` | 404 | Monitor ID does not exist | No |
| `WEBHOOK_INVALID` | 400 | Webhook URL is invalid | No |
| `EXTRACTION_FAILED` | 500 | AI extraction failed | Yes |
| `RESEARCH_FAILED` | 500 | Research operation failed | Yes |
| `AI_UNAVAILABLE` | 503 | Claude API unavailable | Yes |

## Testing Strategy

### Property-Based Testing

The system uses **fast-check** for property-based testing in TypeScript.

**Test Configuration:**
- Minimum 100 iterations per property test
- Seed-based reproducibility for debugging
- Shrinking enabled for minimal failing examples

**Property Test Categories:**

1. **Batch Properties** (Properties 1, 2, 3)
   - Generate random URL arrays of various sizes
   - Verify result count matches input count
   - Verify pricing calculation
   - Verify bounds validation

2. **Research Properties** (Properties 4, 5)
   - Generate random queries and result counts
   - Verify response structure completeness
   - Verify result count bounds

3. **Extraction Properties** (Property 6)
   - Generate random URLs and queries
   - Verify response structure with confidence scores

4. **Monitor Properties** (Properties 7, 8)
   - Generate random intervals and verify clamping
   - Test create/get/delete lifecycle

5. **PDF Properties** (Property 9)
   - Verify response structure for PDF extraction

6. **Compare Properties** (Properties 10, 11)
   - Generate random URL arrays
   - Verify bounds validation
   - Verify response completeness

7. **Documentation Properties** (Properties 12, 13)
   - Verify all endpoints documented
   - Verify discoverable flags

### Unit Tests

- URL validation for batch operations
- Interval clamping for monitors
- Price calculation functions
- Response structure validation

## File Structure

```
weblens/
├── src/
│   ├── tools/
│   │   ├── batch-fetch.ts      # /batch/fetch endpoint
│   │   ├── research.ts         # /research endpoint
│   │   ├── smart-extract.ts    # /extract/smart endpoint
│   │   ├── monitor.ts          # /monitor endpoints
│   │   ├── pdf.ts              # /pdf endpoint
│   │   ├── compare.ts          # /compare endpoint
│   │   └── memory.ts           # /memory endpoints
│   ├── services/
│   │   ├── batch.ts            # Batch fetch service
│   │   ├── research.ts         # Research orchestration
│   │   ├── ai.ts               # Claude AI service
│   │   ├── monitor.ts          # Monitor management
│   │   ├── pdf.ts              # PDF extraction
│   │   └── memory.ts           # Memory storage service
│   └── config.ts               # Add Phase 2 pricing
├── test/
│   └── properties/
│       ├── batch.test.ts
│       ├── research.test.ts
│       ├── smart-extract.test.ts
│       ├── monitor.test.ts
│       ├── pdf.test.ts
│       ├── compare.test.ts
│       └── memory.test.ts
└── wrangler.toml               # Add Durable Objects for monitors
```

## Deployment Configuration

### Additional wrangler.toml Configuration

```toml
# Durable Objects for Monitor scheduling
[[durable_objects.bindings]]
name = "MONITOR_SCHEDULER"
class_name = "MonitorScheduler"

[[migrations]]
tag = "v1"
new_classes = ["MonitorScheduler"]
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | For AI-powered features (research, smart extract, compare) |

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| `/batch/fetch` latency | < 10s | Parallel fetch, limited by slowest URL |
| `/research` latency | < 15s | Includes AI summarization |
| `/extract/smart` latency | < 8s | Single URL + AI extraction |
| `/pdf` latency | < 5s | Depends on PDF size |
| `/compare` latency | < 12s | Multiple fetches + AI comparison |
| Monitor check latency | < 3s | Background operation |
