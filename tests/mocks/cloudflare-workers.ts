
export class DurableObject {
    state: any;
    env: any;
    constructor(state: any, env: any) {
        this.state = state;
        this.env = env;
    }
}
