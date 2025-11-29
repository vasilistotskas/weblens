# Implementation Plan

- [x] 1. Set up project structure and configuration





  - [x] 1.1 Create config module with pricing and facilitator settings


    - Create `src/config.ts` with PRICING constants, FACILITATORS URLs, and cache settings
    - Export typed configuration for all endpoints
    - _Requirements: 2.1, 2.2, 3.2, 4.1_
  - [x] 1.2 Create comprehensive TypeScript types


    - Update `src/types.ts` with all request/response interfaces from design
    - Add ScreenshotRequest, ScreenshotResponse, CacheMetadata, ErrorResponse types
    - _Requirements: 1.6, 2.5, 3.6, 5.4_
  - [x] 1.3 Write property test for pricing configuration


    - **Property 3: Tier pricing consistency**
    - **Validates: Requirements 2.1, 2.2**

- [x] 2. Implement core utilities and services





  - [x] 2.1 Create URL validator service


    - Implement `src/services/validator.ts` with blocked hosts and protocol validation
    - Block localhost, internal IPs, non-HTTP protocols
    - _Requirements: 1.1, 5.4_
  - [x] 2.2 Write property test for URL validation


    - **Property 11: Error response format consistency**
    - **Validates: Requirements 5.4**
  - [x] 2.3 Create request ID generator utility


    - Implement `src/utils/requestId.ts` with `wl_` prefix format
    - _Requirements: 5.3_
  - [x] 2.4 Create pricing utility functions


    - Implement `src/utils/pricing.ts` with getCachedPrice function
    - Calculate 70% discount for cached responses
    - _Requirements: 3.2_
  - [x] 2.5 Write property test for cache pricing


    - **Property 6: Cache hit returns reduced price**
    - **Validates: Requirements 3.2**

- [x] 3. Implement cache manager



  - [x] 3.1 Create cache service with Cloudflare KV


    - Implement `src/services/cache.ts` with get, set, generateKey methods
    - Use SHA256 hash for cache key generation
    - _Requirements: 3.1, 3.3, 3.4_
  - [x] 3.2 Implement TTL bounds validation

    - Clamp TTL to 60-86400 seconds range
    - Default TTL of 3600 seconds
    - _Requirements: 3.4, 3.5_
  - [x] 3.3 Write property test for TTL bounds


    - **Property 8: Cache TTL bounds**
    - **Validates: Requirements 3.4, 3.5**
  - [x] 3.4 Create cache middleware


    - Implement `src/middleware/cache.ts` for cache-enabled endpoints
    - Check cache before processing, store after success
    - _Requirements: 3.1, 3.3, 3.6_
  - [x] 3.5 Write property test for cache metadata


    - **Property 7: Cache metadata completeness**
    - **Validates: Requirements 3.6**

- [x] 4. Checkpoint - Ensure all tests pass



  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement screenshot endpoint



  - [x] 5.1 Create screenshot service


    - Implement `src/services/screenshot.ts` using Cloudflare Browser Rendering
    - Support viewport dimensions, CSS selector, fullPage options
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [x] 5.2 Create screenshot endpoint handler


    - Implement `src/tools/screenshot.ts` with request validation
    - Return base64 PNG with dimensions and metadata
    - _Requirements: 1.1, 1.6_
  - [x] 5.3 Write property test for screenshot response


    - **Property 1: Screenshot returns valid PNG data**
    - **Validates: Requirements 1.1, 1.6**
  - [x] 5.4 Write property test for viewport dimensions


    - **Property 2: Viewport dimensions are respected**
    - **Validates: Requirements 1.2**

- [x] 6. Implement tiered fetch endpoints





  - [x] 6.1 Refactor existing fetch to fetch-basic


    - Move current `/fetch` logic to `src/tools/fetch-basic.ts`
    - Add tier metadata to response
    - _Requirements: 2.1, 2.5_
  - [x] 6.2 Create fetch-pro endpoint with JS rendering


    - Implement `src/tools/fetch-pro.ts` using Browser Rendering
    - Wait for full page load including dynamic content
    - _Requirements: 2.2, 2.4, 2.5_
  - [x] 6.3 Add legacy /fetch endpoint alias


    - Route `/fetch` to `/fetch/basic` for backward compatibility
    - _Requirements: 2.3_
  - [x] 6.4 Write property test for tier metadata


    - **Property 5: Tier metadata inclusion**
    - **Validates: Requirements 2.5**

  - [x] 6.5 Write property test for legacy endpoint

    - **Property 4: Legacy endpoint backward compatibility**
    - **Validates: Requirements 2.3**

- [x] 7. Checkpoint - Ensure all tests pass



  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement multi-chain payment support



  - [x] 8.1 Create payment configuration for multiple networks


    - Update payment middleware to support Base, Solana, Polygon
    - Configure CDP facilitator for Base, PayAI for Solana/Polygon
    - _Requirements: 4.1, 4.2, 4.3_
  - [x] 8.2 Update all endpoint payment middleware


    - Apply multi-chain payment options to all paid endpoints
    - _Requirements: 4.1, 4.4_

  - [x] 8.3 Write property test for multi-chain options

    - **Property 9: Multi-chain payment options**
    - **Validates: Requirements 4.1**

- [x] 9. Implement response headers and error handling



  - [x] 9.1 Create request ID middleware


    - Implement `src/middleware/requestId.ts` to add X-Request-Id to all responses
    - Track processing time for X-Processing-Time header
    - _Requirements: 5.3_
  - [x] 9.2 Create global error handler middleware


    - Implement `src/middleware/errorHandler.ts` with consistent error format
    - Include error code, message, and requestId in all error responses
    - _Requirements: 5.4_
  - [x] 9.3 Write property test for response headers


    - **Property 10: Response header consistency**
    - **Validates: Requirements 5.3**

- [x] 10. Implement health and documentation endpoints



  - [x] 10.1 Create health check endpoint


    - Implement `/health` with cache, browser, facilitator status checks
    - _Requirements: 5.2_
  - [x] 10.2 Update root endpoint documentation


    - Update `/` to include all endpoints, pricing, and features
    - _Requirements: 5.1_

- [x] 11. Update main application router


  - [x] 11.1 Wire up all new endpoints and middleware


    - Update `src/index.ts` with new routes and middleware chain
    - Apply cache middleware to cacheable endpoints
    - _Requirements: All_
  - [x] 11.2 Configure wrangler.toml for production


    - Add KV namespace binding for cache
    - Add Browser Rendering binding
    - _Requirements: 3.1, 1.1_


- [x] 12. Final Checkpoint - Ensure all tests pass


  - Ensure all tests pass, ask the user if questions arise.
