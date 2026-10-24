// Types `env` and `exports` from "cloudflare:workers" as this Worker's own bindings and
// main module (developers.cloudflare.com/workers/testing/vitest-integration/test-apis/;
// GlobalProps is documented in @cloudflare/workers-types).
import type * as WorkerModule from "../../src/index";
import type { Env as WorkerEnv } from "../../src/types";

declare global {
    namespace Cloudflare {
        interface Env extends WorkerEnv {}
        interface GlobalProps {
            mainModule: typeof WorkerModule;
            durableNamespaces: "CreditAccountDO";
        }
    }
}
