export interface MemoryStore {
  users: Map<string, unknown>;
  sessions: Map<string, unknown>;
  cards: Map<string, unknown>;
  cycles: Map<string, unknown>;
  feeEvents: Map<string, unknown>;
  progressEntries: Map<string, unknown>;
  reminderRules: Map<string, unknown>;
  reminders: Map<string, unknown>;
}

const globalStore = globalThis as typeof globalThis & {
  __cardcalendarMemoryStore?: MemoryStore;
};

export function getMemoryStore(): MemoryStore {
  if (!globalStore.__cardcalendarMemoryStore) {
    globalStore.__cardcalendarMemoryStore = {
      users: new Map(),
      sessions: new Map(),
      cards: new Map(),
      cycles: new Map(),
      feeEvents: new Map(),
      progressEntries: new Map(),
      reminderRules: new Map(),
      reminders: new Map(),
    };
  }
  const store = globalStore.__cardcalendarMemoryStore;
  if (!store.users) store.users = new Map();
  if (!store.sessions) store.sessions = new Map();
  if (!store.reminderRules) store.reminderRules = new Map();
  return store;
}
