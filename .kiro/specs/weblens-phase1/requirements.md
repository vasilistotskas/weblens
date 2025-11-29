# Requirements Document

## Introduction

WebLens Phase 1 enhances the core web intelligence API with screenshot capabilities, tiered pricing, caching, and multi-chain payment support. These features transform WebLens from a basic web scraping tool into a comprehensive, cost-effective solution for AI agents requiring web intelligence.

## Glossary

- **WebLens**: A premium web intelligence API that provides webpage fetching, search, and data extraction services with x402 micropayments
- **x402**: An open payment protocol enabling HTTP-native micropayments using the 402 Payment Required status code
- **Facilitator**: A service that verifies and settles x402 payments on the blockchain
- **Cloudflare Browser Rendering**: A Cloudflare Workers feature that provides headless browser capabilities for JavaScript rendering and screenshots
- **Cloudflare KV**: A key-value storage service for caching data at the edge
- **Base Sepolia**: Ethereum Layer 2 testnet for development and testing
- **PayAI Facilitator**: A multi-chain x402 facilitator supporting Solana, Polygon, Avalanche, and other networks
- **Cache TTL**: Time-to-live duration for cached content before expiration

## Requirements

### Requirement 1

**User Story:** As an AI agent, I want to capture screenshots of webpages, so that I can obtain visual context for analysis and decision-making.

#### Acceptance Criteria

1. WHEN a client sends a POST request to `/screenshot` with a valid URL, THEN the WebLens system SHALL return a PNG image of the rendered webpage
2. WHEN a client specifies viewport dimensions in the request, THEN the WebLens system SHALL capture the screenshot at the specified width and height
3. WHEN a client specifies a CSS selector in the request, THEN the WebLens system SHALL capture only the specified element
4. WHEN a client requests a full-page screenshot, THEN the WebLens system SHALL capture the entire scrollable page content
5. IF the target URL fails to load within the timeout period, THEN the WebLens system SHALL return an error response with status 502 and a descriptive message
6. WHEN a screenshot is successfully captured, THEN the WebLens system SHALL return the image as base64-encoded data with metadata including dimensions and capture timestamp

### Requirement 2

**User Story:** As an AI agent, I want tiered pricing options for webpage fetching, so that I can choose the appropriate service level based on my needs and budget.

#### Acceptance Criteria

1. WHEN a client sends a request to `/fetch/basic`, THEN the WebLens system SHALL fetch the page without JavaScript rendering at a price of $0.005
2. WHEN a client sends a request to `/fetch/pro`, THEN the WebLens system SHALL fetch the page with full JavaScript rendering at a price of $0.015
3. WHEN a client sends a request to the legacy `/fetch` endpoint, THEN the WebLens system SHALL treat it as equivalent to `/fetch/basic` for backward compatibility
4. WHEN using `/fetch/pro`, THEN the WebLens system SHALL wait for the page to fully load including dynamic content before returning the response
5. WHEN a tier-specific endpoint receives a request, THEN the WebLens system SHALL include the tier name in the response metadata

### Requirement 3

**User Story:** As an AI agent, I want cached responses at reduced prices, so that I can minimize costs when fresh data is not required.

#### Acceptance Criteria

1. WHEN a client includes `cache=true` in the request query parameters, THEN the WebLens system SHALL check for a cached response before fetching
2. WHEN a cached response exists and has not expired, THEN the WebLens system SHALL return the cached response at 70% reduced price
3. WHEN a cached response does not exist or has expired, THEN the WebLens system SHALL fetch fresh content and store it in the cache
4. WHEN storing content in cache, THEN the WebLens system SHALL use a default TTL of 3600 seconds (1 hour)
5. WHEN a client specifies a custom TTL in the request, THEN the WebLens system SHALL use the specified TTL between 60 and 86400 seconds
6. WHEN returning a cached response, THEN the WebLens system SHALL include cache metadata indicating cache hit status, age, and expiration time
7. WHEN the cache storage operation fails, THEN the WebLens system SHALL still return the fresh response without caching

### Requirement 4

**User Story:** As an AI agent, I want to pay with multiple cryptocurrencies on different blockchains, so that I can use my preferred payment method.

#### Acceptance Criteria

1. WHEN the WebLens system returns a 402 Payment Required response, THEN the response SHALL include payment options for Base, Solana, and Polygon networks
2. WHEN a client submits payment on the Base network, THEN the WebLens system SHALL verify and settle using the CDP facilitator
3. WHEN a client submits payment on Solana or Polygon networks, THEN the WebLens system SHALL verify and settle using the PayAI facilitator
4. WHEN payment verification succeeds on any supported network, THEN the WebLens system SHALL process the request and return the response
5. IF payment verification fails, THEN the WebLens system SHALL return a 402 response with updated payment requirements

### Requirement 5

**User Story:** As a developer, I want comprehensive API documentation and health monitoring, so that I can integrate WebLens reliably into my applications.

#### Acceptance Criteria

1. WHEN a client sends a GET request to `/`, THEN the WebLens system SHALL return API documentation including all endpoints, pricing, and supported features
2. WHEN a client sends a GET request to `/health`, THEN the WebLens system SHALL return system health status including cache availability and facilitator connectivity
3. WHEN any endpoint processes a request successfully, THEN the WebLens system SHALL include standard response headers with request ID and processing time
4. WHEN an error occurs, THEN the WebLens system SHALL return a consistent error response format with error code, message, and request ID
