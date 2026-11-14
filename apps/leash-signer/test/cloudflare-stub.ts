export class DurableObject<T> {
  protected ctx: DurableObjectState;
  protected env: T;
  constructor(ctx: DurableObjectState, env: T) {
    this.ctx = ctx;
    this.env = env;
  }
}
