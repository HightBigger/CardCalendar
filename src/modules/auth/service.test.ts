import { describe, expect, it } from "vitest";
import { InMemoryAuthRepository } from "./repository";
import { getSessionUser, loginUser, logoutSession, registerUser, requestAccountDeletion } from "./service";

describe("auth service", () => {
  it("registers, normalizes email and logs in", async () => {
    const repository = new InMemoryAuthRepository();
    const registered = await registerUser(
      {
        email: "Test@Example.com",
        password: "password123",
        name: "测试用户",
        timezone: "Asia/Shanghai",
      },
      repository,
    );
    expect(registered.user?.email).toBe("test@example.com");
    expect(registered.user?.timezone).toBe("Asia/Shanghai");

    const logged = await loginUser(
      { email: "test@example.com", password: "password123" },
      repository,
    );
    expect(logged.user?.id).toBe(registered.user?.id);
    expect(await getSessionUser(logged.token, repository)).toMatchObject({ id: registered.user?.id });
    await logoutSession(logged.token, repository);
    expect(await getSessionUser(logged.token, repository)).toBeUndefined();
  });

  it("rejects duplicate email and wrong password", async () => {
    const repository = new InMemoryAuthRepository();
    await registerUser(
      { email: "dup@example.com", password: "password123" },
      repository,
    );
    await expect(
      registerUser({ email: "DUP@example.com", password: "password123" }, repository),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      loginUser({ email: "dup@example.com", password: "wrong-password" }, repository),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("anonymizes credentials after account cleanup", async () => {
    const repository = new InMemoryAuthRepository();
    const registered = await registerUser(
      { email: "privacy@example.com", password: "password123" },
      repository,
    );
    const anonymized = await repository.anonymizeUser(registered.user!.id);
    expect(anonymized?.status).toBe("anonymized");
    expect(anonymized?.email).toContain("@invalid.cardcalendar");
    expect(anonymized?.passwordHash).not.toBe("password123");
  });

  it("blocks login after deletion is requested", async () => {
    const repository = new InMemoryAuthRepository();
    await registerUser({ email: "delete@example.com", password: "password123" }, repository);
    const user = await repository.findUserByEmail("delete@example.com");
    await requestAccountDeletion(user!.id, { confirmation: "DELETE" }, repository);
    await expect(
      loginUser({ email: "delete@example.com", password: "password123" }, repository),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
