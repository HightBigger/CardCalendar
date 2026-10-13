// Request ownership only. No entity store or cross-feature data cache.
export class RequestSequence {
  private sequence = 0;
  private controller?: AbortController;
  begin() {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const sequence = ++this.sequence;
    return { signal: controller.signal, current: () => sequence === this.sequence && !controller.signal.aborted };
  }
  cancel() { this.sequence++; this.controller?.abort(); }
}
