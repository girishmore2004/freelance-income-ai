import { describe, expect, it } from "vitest";
import { billingGaps, clientProfileGaps, clientSteps, freelancerProfileGaps, freelancerSteps, onboardingOut } from "./onboarding";

const fullFreelancer = { full_name: "Asha Rao", headline: "Next.js developer for shops", skills: '["Next.js","React","SEO"]', bio: "I build fast websites for local shops and cafes, with ordering and SEO.", hourly_rate: "1500" };
const fullClient = { kind: "company", name: "Acme Bakery", country: "IN", industry: "Food", billing_name: "Acme Bakery LLP", billing_email: "accounts@bakery.example.com" };

describe("onboarding rules (U31, D-31)", () => {
  it("a freelancer profile needs name, headline, 3 skills, a 50-character bio and a rate", () => {
    expect(freelancerProfileGaps(fullFreelancer)).toEqual([]);
    expect(freelancerProfileGaps(null).map((g) => g.key)).toEqual(["full_name", "headline", "skills", "bio", "hourly_rate"]);
    expect(freelancerProfileGaps({ ...fullFreelancer, skills: ["React", "SEO"] }).map((g) => g.key)).toEqual(["skills"]);
    expect(freelancerProfileGaps({ ...fullFreelancer, bio: "Short bio." }).map((g) => g.key)).toEqual(["bio"]);
    expect(freelancerProfileGaps({ ...fullFreelancer, hourly_rate: 0 }).map((g) => g.key)).toEqual(["hourly_rate"]);
    expect(freelancerProfileGaps({ ...fullFreelancer, skills: "not json" }).map((g) => g.key)).toEqual(["skills"]);
  });

  it("a client profile needs type, name, country and industry; billing is separate", () => {
    expect(clientProfileGaps(fullClient)).toEqual([]);
    // The automatic individual account has a type, name and country but no industry.
    expect(clientProfileGaps({ kind: "individual", name: "Meera Shah", country: "IN", industry: "" }).map((g) => g.key)).toEqual(["industry"]);
    expect(clientProfileGaps(null).map((g) => g.key)).toEqual(["kind", "name", "country", "industry"]);
    expect(billingGaps(fullClient)).toEqual([]);
    expect(billingGaps({ ...fullClient, billing_email: "not-an-email" }).map((g) => g.key)).toEqual(["billing_email"]);
  });

  it("client steps follow the hiring order and report the next one", () => {
    const fresh = clientSteps({ profile: { kind: "individual", name: "Meera", country: "IN" }, listings: 0, proposals: 0, invitations: 0, contracts: 0, funded: 0, approved: 0 });
    expect(fresh.map((s) => s.key)).toEqual(["profile", "post", "proposals", "hire", "billing", "fund", "approve"]);
    expect(onboardingOut("client", fresh, { profile: [] })).toMatchObject({ next: "profile", done: 0, total: 7, complete: false });
    const posted = clientSteps({ profile: fullClient, listings: 1, proposals: 0, invitations: 2, contracts: 0, funded: 0, approved: 0 });
    expect(onboardingOut("client", posted, { profile: [] })).toMatchObject({ next: "hire", done: 4 });
    const all = clientSteps({ profile: fullClient, listings: 1, proposals: 3, invitations: 0, contracts: 1, funded: 1, approved: 1 });
    expect(onboardingOut("client", all, { profile: [] })).toMatchObject({ next: null, complete: true, done: 7 });
  });

  it("freelancer steps follow the work order", () => {
    const fresh = freelancerSteps({ profile: null, visible: false, proposals: 0, contracts: 0, deliveries: 0, paid: 0 });
    expect(fresh.map((s) => s.key)).toEqual(["profile", "visible", "proposal", "contract", "deliver", "paid"]);
    expect(fresh.every((s) => !s.done && s.href.startsWith("/"))).toBe(true);
    // Warn only: a proposal sent before the profile is complete still counts.
    const early = freelancerSteps({ profile: null, visible: true, proposals: 1, contracts: 0, deliveries: 0, paid: 0 });
    expect(onboardingOut("freelancer", early, { profile: freelancerProfileGaps(null) })).toMatchObject({ next: "profile", done: 2 });
  });
});
