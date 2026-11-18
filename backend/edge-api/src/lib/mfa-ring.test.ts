import { describe, expect, it } from "vitest";
import { decryptWithRing, encryptTotpSecret, mfaKeyRing } from "./mfa";

describe("MFA key ring (K-04)", () => {
  it("puts the dedicated key first and keeps JWT_SECRET as fallback", () => {
    expect(mfaKeyRing({ JWT_SECRET: "jwt" })).toEqual(["jwt"]);
    expect(mfaKeyRing({ MFA_ENCRYPTION_KEY: " mfa ", JWT_SECRET: "jwt" })).toEqual(["mfa", "jwt"]);
    expect(mfaKeyRing({ MFA_ENCRYPTION_KEY: "same", JWT_SECRET: "same" })).toEqual(["same"]);
    expect(mfaKeyRing({})).toEqual([]);
  });

  it("reads legacy secrets with the fallback key and new ones with the dedicated key", async () => {
    const legacy = await encryptTotpSecret("JBSWY3DPEHPK3PXP", "jwt-secret-value-long-enough");
    const ring = mfaKeyRing({ MFA_ENCRYPTION_KEY: "dedicated-mfa-key-long-enough", JWT_SECRET: "jwt-secret-value-long-enough" });
    expect(await decryptWithRing(legacy, ring)).toEqual({ secret: "JBSWY3DPEHPK3PXP", keyIndex: 1 });
    const moved = await encryptTotpSecret("JBSWY3DPEHPK3PXP", ring[0]);
    expect(await decryptWithRing(moved, ring)).toEqual({ secret: "JBSWY3DPEHPK3PXP", keyIndex: 0 });
    await expect(decryptWithRing(moved, ["wrong-key-entirely-different"])).rejects.toThrow();
  });
});
