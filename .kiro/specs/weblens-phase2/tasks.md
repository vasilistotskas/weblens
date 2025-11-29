# Implementation Plan

- [x] 1. Set up Phase 2 configuration and types
  - [x] 1.1 Add Phase 2 pricing to config
    - Update `src/config.ts` with PHASE2_PRICING constants
    - Add batch, research, smart extract, monitor, pdf, compare, memory pricing
    - _Requirements: 1.4, 2.6, 3.5, 4.2, 4.4, 5.4, 6.4, 7.2_
  - [x] 1.2 Create Phase 2 TypeScript types
    - Add interfaces for all Phase 2 request/response types
    - Add BatchFetchRequest, ResearchRequest, SmartExtractRequest, etc.
    - _Requirements: 1.6, 2.5, 3.4, 5.6, 6.5, 7.1_
  - [x] 1.3 Write property test for Phase 2 pricing
    - **Property 2: Batch fetch pricing is linear**
    - **Validates: Requirements 1.4**

- [x] 2. Implement batch fetch endpoint
  - [x] 2.1 Create batch fetch service
    - Implement `src/services/batch.ts` with parallel URL fetching
    - Handle partial failures gracefully
    - _Requirements: 1.1, 1.5_
  - [x] 2.2 Create batch fetch endpoint handler
    - Implement `src/tools/batch-fetch.ts` with validation
    - Validate URL count bounds (2-20)
    - _Requirements: 1.1, 1.2, 1.3, 1.6_
  - [x] 2.3 Write property test for batch fetch results
    - **Property 1: Batch fetch returns results for all URLs**
    - **Validates: Requirements 1.1, 1.6**
  - [x] 2.4 Write property test for batch fetch bounds
    - **Property 3: Batch fetch bounds validation**
    - **Validates: Requirements 1.2, 1.3**

- [x] 3. Implement AI service for Claude integration
  - [x] 3.1 Create AI service
    - Implement `src/services/ai.ts` with Claude API integration
    - Add methods for summarization, extraction, comparison
    - _Requirements: 2.4, 3.1, 6.3_
  - [x] 3.2 Add error handling for AI unavailability
    - Handle Claude API errors gracefully
    - Return appropriate error responses
    - _Requirements: 3.6_

- [x] 4. Implement research endpoint
  - [x] 4.1 Create research service
    - Implement `src/services/research.ts` orchestrating search + fetch + summarize
    - Use existing search and fetch services
    - _Requirements: 2.1, 2.2, 2.3_
  - [x] 4.2 Create research endpoint handler
    - Implement `src/tools/research.ts` with request validation
    - Return sources, content, and AI summary
    - _Requirements: 2.1, 2.5_
  - [x] 4.3 Write property test for research response
    - **Property 4: Research response completeness**
    - **Validates: Requirements 2.1, 2.5**
  - [x] 4.4 Write property test for research result count
    - **Property 5: Research result count bounds**
    - **Validates: Requirements 2.3**

- [x] 5. Implement smart extraction endpoint
  - [x] 5.1 Create smart extraction endpoint handler
    - Implement `src/tools/smart-extract.ts` with natural language queries
    - Use AI service for intelligent extraction
    - _Requirements: 3.1, 3.2, 3.3_
  - [x] 5.2 Add confidence scoring to extraction results
    - Include confidence scores for each extracted item
    - Handle empty results gracefully
    - _Requirements: 3.4, 3.6_
  - [x] 5.3 Write property test for smart extraction
    - **Property 6: Smart extraction response structure**
    - **Validates: Requirements 3.1, 3.4**

- [x] 6. Implement PDF extraction endpoint
  - [x] 6.1 Create PDF service
    - Implement `src/services/pdf.ts` for PDF text extraction
    - Extract text with page markers
    - _Requirements: 5.1, 5.3_
  - [x] 6.2 Create PDF endpoint handler
    - Implement `src/tools/pdf.ts` with URL validation
    - Return text, metadata, and page structure
    - _Requirements: 5.1, 5.5, 5.6_
  - [x] 6.3 Write property test for PDF response
    - **Property 9: PDF response structure**
    - **Validates: Requirements 5.1, 5.3, 5.6**

- [x] 7. Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement compare endpoint





  - [x] 8.1 Create compare endpoint handler


    - Implement `src/tools/compare.ts` with URL validation
    - Fetch all URLs and generate AI comparison
    - _Requirements: 6.1, 6.2, 6.3_


  - [x] 8.2 Add comparison analysis
    - Use AI service to identify similarities and differences
    - Generate summary of key differences
    - _Requirements: 6.3, 6.5_
  - [ ]* 8.3 Write property test for compare bounds
    - **Property 10: Compare URL bounds**
    - **Validates: Requirements 6.6**
  - [ ]* 8.4 Write property test for compare response
    - **Property 11: Compare response completeness**
    - **Validates: Requirements 6.1, 6.5**

- [x] 9. Implement agent memory endpoints



  - [x] 9.1 Create memory service


    - Implement `src/services/memory.ts` with KV storage
    - Isolate data by wallet address
    - _Requirements: 7.1, 7.6_

  - [x] 9.2 Create memory endpoint handlers

    - Implement `src/tools/memory.ts` with set/get/delete/list
    - Handle TTL configuration
    - _Requirements: 7.1, 7.3, 7.5, 7.8_
  - [ ]* 9.3 Write property test for memory write
    - **Property 13: Memory write returns confirmation**
    - **Validates: Requirements 7.1, 7.8**
  - [ ]* 9.4 Write property test for memory read
    - **Property 14: Memory read returns stored value**
    - **Validates: Requirements 7.3**
  - [ ]* 9.5 Write property test for memory TTL
    - **Property 16: Memory TTL bounds**
    - **Validates: Requirements 7.8**

- [x] 10. Implement URL monitor endpoints



  - [x] 10.1 Create monitor service


    - Implement `src/services/monitor.ts` with KV storage
    - Store monitor configuration and state
    - _Requirements: 4.1, 4.5, 4.6_

  - [x] 10.2 Create monitor endpoint handlers

    - Implement `src/tools/monitor.ts` with create/get/delete
    - Validate interval bounds
    - _Requirements: 4.1, 4.5, 4.6, 4.7_
  - [x] 10.3 Implement monitor check logic


    - Create scheduled handler for checking URLs
    - Send webhook notifications on changes
    - _Requirements: 4.3, 4.4_
  - [ ]* 10.4 Write property test for monitor interval
    - **Property 7: Monitor interval bounds**
    - **Validates: Requirements 4.7**
  - [ ]* 10.5 Write property test for monitor lifecycle
    - **Property 8: Monitor lifecycle consistency**
    - **Validates: Requirements 4.5, 4.6**

- [x] 11. Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Update main application router



  - [x] 12.1 Wire up all Phase 2 endpoints


    - Update `src/index.ts` with new routes and payment middleware
    - Apply appropriate pricing to each endpoint
    - _Requirements: All_

  - [x] 12.2 Update API documentation

    - Update root endpoint to include all Phase 2 endpoints
    - Add examples for each endpoint
    - _Requirements: 8.3, 8.4_
  - [ ]* 12.3 Write property test for documentation
    - **Property 12: Phase 2 endpoints documented**
    - **Validates: Requirements 8.3**
  - [ ]* 12.4 Write property test for discoverability
    - **Property 17: All endpoints discoverable**
    - **Validates: Requirements 8.1**

- [x] 13. Configure wrangler.toml for Phase 2

  - [x] 13.1 Add Durable Objects for monitors


    - Configure MonitorScheduler Durable Object
    - Add migrations for new classes
    - _Requirements: 4.3_

  - [x] 13.2 Update KV namespace configuration

    - Add memory namespace binding
    - Add monitor namespace binding
    - _Requirements: 7.1, 4.1_

- [x] 14. Final Checkpoint - Ensure all tests pass



  - Use cloudflare, x402, coingecko and fetch mcp, a look at whole app to ensure everything is correct, the `phase2` naming inside app is not very nice (Why have name such as PHASE2_PRICING) all tests pass , lints and typechecks must pass (we should not have any duplicate types etc), ask the user if questions arise.
