import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { handleNotificationRoute, notifyContractEvent, notifyUsers } from "./notify";
import { createFakeSql, jsonRequest, readJson } from "./test-support";

describe("notifications", () => {
  it("writes one row per distinct recipient with a per-user dedupe key", async () => {
    const fake = createFakeSql(() => []);
    await notifyUsers(fake.sql, ["u1", "u1", null, "u2"], { kind: "x.y", title: "T", message: "M", dedupe: "evt" });
    const inserts = fake.queries.filter((q) => q.text.startsWith("INSERT INTO notifications"));
    expect(inserts).toHaveLength(2);
    expect(inserts.map((q) => q.values[6])).toEqual(["evt:u1", "evt:u2"]);
    expect(inserts[0].text).toContain("ON CONFLICT (dedupe_key) DO NOTHING");
  });

  it("never throws, so a notification problem cannot break the business action", async () => {
    const broken = createFakeSql(() => { throw new Error("no table"); });
    await expect(notifyUsers(broken.sql, ["u1"], { kind: "k", title: "t", message: "m" })).resolves.toBeUndefined();
    await expect(notifyContractEvent(broken.sql, "K1", "u1", "contract.activated", {}, "e1")).resolves.toBeUndefined();
  });

  it("sends contract events to the other party only", async () => {
    const fake = createFakeSql((text) => {
      if (text.startsWith("SELECT freelancer_user_id, organization_id FROM contracts")) return [{ freelancer_user_id: "f1", organization_id: "o1" }];
      if (text.startsWith("SELECT user_id FROM organization_memberships")) return [{ user_id: "c1" }, { user_id: "c2" }];
      return [];
    });
    await notifyContractEvent(fake.sql, "K1", "c1", "contract.activated", {}, "e1");
    expect(fake.queries.filter((q) => q.text.startsWith("INSERT INTO notifications")).map((q) => q.values[1])).toEqual(["f1", "c2"]);
    const toClient = createFakeSql((text) => (text.startsWith("SELECT freelancer_user_id") ? [{ freelancer_user_id: "f1", organization_id: "o1" }] : text.startsWith("SELECT user_id") ? [{ user_id: "c1" }] : []));
    await notifyContractEvent(toClient.sql, "K1", "f1", "milestone.submitted", { title: "Design" }, "e2");
    const row = toClient.queries.find((q) => q.text.startsWith("INSERT INTO notifications"))!;
    expect([row.values[1], row.values[2]]).toEqual(["c1", "Work was delivered for review: Design"]);
    const unknown = createFakeSql(() => []);
    await notifyContractEvent(unknown.sql, "K1", "f1", "something.else", {}, "e3");
    expect(unknown.queries).toHaveLength(0);
  });

  it("lists, counts and marks only the signed-in user's notifications", async () => {
    const fake = createFakeSql((text) => {
      if (text.startsWith("SELECT count(*)::int AS n FROM notifications")) return [{ n: 3 }];
      if (text.startsWith("UPDATE notifications")) return [{ id: "n1" }];
      if (text.startsWith("SELECT id, title")) return [{ id: "n1", title: "T", message: "M", kind: "k", link: "/x", read_at: null, created_at: new Date(), status: "sent", channel: "in_app" }];
      return [];
    });
    const deps = { database: () => fake.sql, authenticate: async () => ({ user: { id: "u1", email: "", email_verified: true, mfa_enabled: false }, claims: { sub: "u1", jti: "j", iat: 0, exp: 0 } }) };
    const env = {} as Env;
    expect((await readJson((await handleNotificationRoute(jsonRequest("GET", "/api/v1/notifications/unread-count"), env, "r", deps))!)).data.unread).toBe(3);
    expect((await readJson((await handleNotificationRoute(jsonRequest("GET", "/api/v1/notifications"), env, "r", deps))!)).data[0]).toMatchObject({ read: false, link: "/x" });
    await handleNotificationRoute(jsonRequest("POST", "/api/v1/notifications/read", { ids: ["n1", "bad id!"] }), env, "r", deps);
    const update = fake.queries.find((q) => q.text.startsWith("UPDATE notifications"))!;
    expect(update.values).toEqual(["u1", "{\"n1\"}"]);
  });
});
