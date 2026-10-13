// A failed intent retains its key; changed parameters constitute a new intent.
export class IntentKeys {
  private keys = new Map<string, string>();
  key(path: string, payload: unknown) {
    const identity = JSON.stringify([path, payload]);
    let key = this.keys.get(identity);
    if (!key) { key = crypto.randomUUID(); this.keys.set(identity, key); }
    return key;
  }
  committed(path: string, payload: unknown) { this.keys.delete(JSON.stringify([path, payload])); }
  clear() { this.keys.clear(); }
}
