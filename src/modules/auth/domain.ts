export type UserStatus = "active" | "deletion_requested" | "anonymized";

export interface UserProfile {
  id: string;
  email: string;
  name?: string;
  timezone: string;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface UserRecord extends UserProfile {
  passwordHash: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
  createdAt: string;
}

export interface AuthRepository {
  listActiveUsers(): Promise<UserProfile[]>;
  listDeletionRequestedUsers(): Promise<UserProfile[]>;
  findUserByEmail(email: string): Promise<UserRecord | undefined>;
  findUserById(id: string): Promise<UserRecord | undefined>;
  createUser(input: {
    email: string;
    passwordHash: string;
    timezone?: string;
    name?: string;
  }): Promise<UserRecord>;
  createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: string;
  }): Promise<SessionRecord>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | undefined>;
  revokeSession(id: string): Promise<void>;
  revokeAllSessions(userId: string): Promise<void>;
  updateUser(
    userId: string,
    patch: Partial<Pick<UserProfile, "timezone" | "name" | "status" | "deletedAt">>,
  ): Promise<UserRecord | undefined>;
  anonymizeUser(userId: string): Promise<UserRecord | undefined>;
}

export interface PublicUserProfile extends UserProfile {
  email: string;
}
