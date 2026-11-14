
import { describe, expect, it } from "vitest";

import {
  hashPassword,
  verifyPassword,
  usesPreferredPasswordScheme
} from "./password-service";

describe("Passlib password compatibility", () => {
  it("verifies the official Passlib bcrypt_sha256 v2 vector", async () => {
    const hash =
      "$bcrypt-sha256$v=2,t=2b,r=12$n79VH.0Q2TMWmt3Oqt9uku$Kq4Noyk3094Y2QlB8NdRT8SvGiI4ft2";

    await expect(
      verifyPassword("password", hash)
    ).resolves.toBe(true);

    await expect(
      verifyPassword("wrong-password", hash)
    ).resolves.toBe(false);
  });

  it("verifies a standard legacy bcrypt vector", async () => {
    const hash =
      "$2b$12$GhvMmNVjRW29ulnudl.LbuAnUtN/LRfe1JsBm1Xu6LE3059z5Tr8m";

    await expect(
      verifyPassword("password", hash)
    ).resolves.toBe(true);

    await expect(
      verifyPassword("incorrect", hash)
    ).resolves.toBe(false);
  });

  it("creates a Passlib-compatible preferred hash", async () => {
    const password = "Freelance-Test-Password-2026!";

    const hash = await hashPassword(password);

    expect(hash).toMatch(
      /^\$bcrypt-sha256\$v=2,t=2b,r=12\$[./A-Za-z0-9]{22}\$[./A-Za-z0-9]{31}$/
    );

    expect(usesPreferredPasswordScheme(hash)).toBe(true);

    await expect(
      verifyPassword(password, hash)
    ).resolves.toBe(true);

    await expect(
      verifyPassword("different-password", hash)
    ).resolves.toBe(false);
  });

  it("supports passwords longer than bcrypt's 72-byte limit", async () => {
    const password = "LongPassword-" + "x".repeat(100);

    const hash = await hashPassword(password);

    await expect(
      verifyPassword(password, hash)
    ).resolves.toBe(true);

    await expect(
      verifyPassword(password.slice(0, 72), hash)
    ).resolves.toBe(false);
  });

  it("rejects malformed and unsupported hashes", async () => {
    await expect(
      verifyPassword("password", "not-a-valid-hash")
    ).resolves.toBe(false);

    await expect(
      verifyPassword("password", "$bcrypt-sha256$invalid")
    ).resolves.toBe(false);
  });

  it("rejects empty passwords", async () => {
    await expect(
      verifyPassword("", "$2b$12$invalid")
    ).resolves.toBe(false);
  });
});
