# Requirements Document

## Introduction

WebLens Phase 2 extends the web intelligence API with high-value features designed for AI agents. The focus is on batch operations, AI-powered extraction, research automation, and recurring revenue through URL monitoring. These features target the x402 Bazaar ecosystem where AI agents autonomously discover and pay for services.

## Glossary

- **WebLens**: A premium web intelligence API that provides webpage fetching, search, and data extraction services with x402 micropayments
- **x402**: An open payment protocol enabling HTTP-native micropayments using the 402 Payment Required status code
- **Bazaar**: The x402 discovery layer where AI agents find and integrate with x402-compatible API endpoints
- **AI Agent**: An autonomous system (Claude, GPT, custom agents) that programmatically discovers and pays for API services
- **Batch Operation**: A single API request that processes multiple URLs in parallel
- **Smart Extraction**: AI-powered data extraction using natural language queries instead of rigid schemas
- **URL Monitor**: A service that watches URLs for content changes and notifies via webhook
- **Research Bundle**: A combined service that searches, fetches, and summarizes information on a topic

## Requirements

### Requirement 1

**User Story:** As an AI agent, I want to fetch multiple URLs in a single request, so that I can efficiently research topics without making many separate API calls.

#### Acceptance Criteria

1. WHEN a client sends a POST request to `/batch/fetch` with an array of 2-20 URLs, THEN the WebLens system SHALL fetch all URLs in parallel and return results for each
2. WHEN a client provides fewer than 2 URLs, THEN the WebLens system SHALL return an error indicating minimum 2 URLs required
3. WHEN a client provides more than 20 URLs, THEN the WebLens system SHALL return an error indicating maximum 20 URLs allowed
4. WHEN fetching multiple URLs, THEN the WebLens system SHALL charge $0.003 per URL in the batch
5. WHEN one or more URLs fail to fetch, THEN the WebLens system SHALL return partial results with error details for failed URLs
6. WHEN returning batch results, THEN the WebLens system SHALL include the URL, content, metadata, and status for each item

### Requirement 2

**User Story:** As an AI agent, I want to perform one-stop research on a topic, so that I can get comprehensive information without orchestrating multiple API calls.

#### Acceptance Criteria

1. WHEN a client sends a POST request to `/research` with a query string, THEN the WebLens system SHALL search the web, fetch top results, and return an AI-generated summary
2. WHEN performing research, THEN the WebLens system SHALL search for the query and fetch the top 5 results by default
3. WHEN a client specifies a custom result count (1-10), THEN the WebLens system SHALL fetch that many results
4. WHEN generating a summary, THEN the WebLens system SHALL use Claude to synthesize information from all fetched sources
5. WHEN returning research results, THEN the WebLens system SHALL include the original query, search results, fetched content, and AI summary
6. WHEN the research endpoint is called, THEN the WebLens system SHALL charge $0.08 per request

### Requirement 3

**User Story:** As an AI agent, I want to extract data using natural language queries, so that I can get structured information without defining complex schemas.

#### Acceptance Criteria

1. WHEN a client sends a POST request to `/extract/smart` with a URL and natural language query, THEN the WebLens system SHALL extract relevant data based on the query
2. WHEN a client provides a query like "find all email addresses", THEN the WebLens system SHALL use AI to identify and extract matching data
3. WHEN a client provides a query like "get product prices and names", THEN the WebLens system SHALL return structured data matching the request
4. WHEN extraction is complete, THEN the WebLens system SHALL return data in a structured JSON format with confidence scores
5. WHEN the smart extraction endpoint is called, THEN the WebLens system SHALL charge $0.025 per request
6. IF the AI cannot extract the requested data, THEN the WebLens system SHALL return an empty result with an explanation

### Requirement 4

**User Story:** As an AI agent, I want to monitor URLs for content changes, so that I can react to updates without constantly polling.

#### Acceptance Criteria

1. WHEN a client sends a POST request to `/monitor/create` with a URL and webhook URL, THEN the WebLens system SHALL create a monitor and return a monitor ID
2. WHEN creating a monitor, THEN the WebLens system SHALL charge $0.01 for setup
3. WHEN a monitored URL changes, THEN the WebLens system SHALL send a POST request to the webhook URL with change details
4. WHEN checking for changes, THEN the WebLens system SHALL charge $0.001 per check
5. WHEN a client sends a GET request to `/monitor/:id`, THEN the WebLens system SHALL return the monitor status and history
6. WHEN a client sends a DELETE request to `/monitor/:id`, THEN the WebLens system SHALL stop monitoring and remove the monitor
7. WHEN creating a monitor, THEN the WebLens system SHALL allow configuring check interval (minimum 1 hour, maximum 24 hours)

### Requirement 5

**User Story:** As an AI agent, I want to extract text from PDF documents, so that I can process document content programmatically.

#### Acceptance Criteria

1. WHEN a client sends a POST request to `/pdf` with a PDF URL, THEN the WebLens system SHALL download and extract text from the PDF
2. WHEN extracting PDF text, THEN the WebLens system SHALL preserve paragraph structure and formatting where possible
3. WHEN the PDF contains multiple pages, THEN the WebLens system SHALL return text from all pages with page markers
4. WHEN the PDF extraction endpoint is called, THEN the WebLens system SHALL charge $0.01 per request
5. IF the URL does not point to a valid PDF, THEN the WebLens system SHALL return an error with a descriptive message
6. WHEN returning PDF content, THEN the WebLens system SHALL include metadata such as page count, title, and author if available

### Requirement 6

**User Story:** As an AI agent, I want to compare multiple URLs side by side, so that I can perform competitive analysis efficiently.

#### Acceptance Criteria

1. WHEN a client sends a POST request to `/compare` with 2-3 URLs, THEN the WebLens system SHALL fetch all URLs and generate a comparison
2. WHEN comparing URLs, THEN the WebLens system SHALL identify similarities and differences in content structure
3. WHEN comparing URLs, THEN the WebLens system SHALL use AI to generate a summary of key differences
4. WHEN the compare endpoint is called, THEN the WebLens system SHALL charge $0.05 per request
5. WHEN returning comparison results, THEN the WebLens system SHALL include fetched content for each URL and the AI-generated comparison
6. IF fewer than 2 URLs are provided, THEN the WebLens system SHALL return an error indicating minimum 2 URLs required

### Requirement 7

**User Story:** As an AI agent, I want persistent key-value storage, so that I can remember information between sessions and API calls.

#### Acceptance Criteria

1. WHEN a client sends a POST request to `/memory/set` with a key and value, THEN the WebLens system SHALL store the value and return confirmation
2. WHEN storing a value, THEN the WebLens system SHALL charge $0.001 per write operation
3. WHEN a client sends a GET request to `/memory/get/:key`, THEN the WebLens system SHALL return the stored value if it exists
4. WHEN retrieving a value, THEN the WebLens system SHALL charge $0.0005 per read operation
5. WHEN a client sends a DELETE request to `/memory/:key`, THEN the WebLens system SHALL remove the stored value
6. WHEN storing values, THEN the WebLens system SHALL associate data with the paying wallet address for isolation
7. WHEN a key does not exist, THEN the WebLens system SHALL return a 404 error with a descriptive message
8. WHEN storing a value, THEN the WebLens system SHALL allow optional TTL (time-to-live) between 1 hour and 30 days

### Requirement 8

**User Story:** As a developer, I want comprehensive API documentation and Bazaar discoverability, so that AI agents can find and use WebLens services.

#### Acceptance Criteria

1. WHEN the WebLens system registers endpoints with the x402 facilitator, THEN all endpoints SHALL have discoverable set to true for Bazaar listing
2. WHEN an endpoint is listed in the Bazaar, THEN the listing SHALL include accurate pricing, description, and input/output schemas
3. WHEN a client sends a GET request to `/`, THEN the WebLens system SHALL return documentation for all Phase 2 endpoints
4. WHEN returning API documentation, THEN the WebLens system SHALL include example requests and responses for each endpoint
