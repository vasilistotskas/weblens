// Loads the main Worker before each test file runs. `exports.default.fetch()` otherwise imports it on the
// first call, which under the full suite's parallel load takes longer than a test's 5 s timeout
// (developers.cloudflare.com/workers/testing/vitest-integration/migration-guides/migrate-from-unstable-dev/
// imports the main module the same way).
import "../../src/index";
