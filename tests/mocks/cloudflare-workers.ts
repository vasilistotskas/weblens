/** Stands in for workerd's `DurableObject` base class when a Node-project test imports a Durable Object module. */
export class DurableObject<Env = unknown> {
    protected ctx: DurableObjectState;
    protected env: Env;

    constructor(ctx: DurableObjectState, env: Env) {
        this.ctx = ctx;
        this.env = env;
    }
}
