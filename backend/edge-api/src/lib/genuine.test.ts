import { describe, expect, it } from "vitest";
import { assessListing } from "./genuine";

const real = {
  source: "remotive",
  title: "Senior React developer (contract)",
  company: "Acme Analytics",
  url: "https://remotive.com/remote-jobs/software-dev/senior-react-developer-123",
  description: "We build dashboards for clinics. You will own the React front end, work with our designer and ship weekly. Apply with examples of past work; contact jobs@acme.example for questions.",
};

describe("genuine listings (U30)", () => {
  it("passes an ordinary job ad, including an email address for questions", () => {
    expect(assessListing(real)).toEqual({ genuine: true, reasons: [] });
    expect(assessListing({ ...real, source: "himalayas", url: "https://himalayas.app/companies/acme/jobs/react" }).genuine).toBe(true);
    expect(assessListing({ ...real, description: real.description + " Rate $90/hr, 20 hours a week." }).genuine).toBe(true);
  });

  it("drops listings that ask for money first", () => {
    expect(assessListing({ ...real, description: real.description + " A refundable registration fee of $25 is required." }).reasons).toContain("asks_for_money");
    expect(assessListing({ ...real, description: real.description + " Buy the starter kit first, then we send tasks." }).reasons).toContain("asks_for_money");
  });

  it("drops listings that move contact to chat apps or payment off the record", () => {
    expect(assessListing({ ...real, description: real.description + " Message our HR on Telegram @hr_team." }).reasons).toContain("chat_app_contact");
    expect(assessListing({ ...real, description: real.description + " Guaranteed returns on our crypto trading desk." }).reasons).toContain("off_platform_payment");
    expect(assessListing({ ...real, description: real.description + " Pay me directly by UPI." }).reasons).toContain("off_platform_payment");
  });

  it("drops get-rich, too-good-to-be-true and empty listings", () => {
    expect(assessListing({ ...real, title: "Work from home", description: "Earn $500 per day from home, no experience needed! Simple tasks, daily payment guaranteed for everyone who joins today." }).reasons).toContain("vague_get_rich");
    expect(assessListing({ ...real, description: real.description + " We pay $900/hr for simple data checks." }).reasons).toContain("too_good_to_be_true");
    expect(assessListing({ ...real, description: "Apply now." }).reasons).toContain("no_real_content");
    expect(assessListing({ ...real, description: real.description + " Details: bit.ly/abc123" }).reasons).toContain("link_shortener");
  });

  it("drops links that are not https or that leave the source's own site", () => {
    expect(assessListing({ ...real, url: "http://remotive.com/remote-jobs/x" }).reasons).toContain("unsafe_link");
    expect(assessListing({ ...real, url: "javascript:alert(1)" }).reasons).toContain("unsafe_link");
    expect(assessListing({ ...real, url: "https://remotive.com.evil.example/x" }).reasons).toContain("link_not_from_source");
    expect(assessListing({ ...real, source: "hackernews", url: "https://news.ycombinator.com/item?id=1" }).genuine).toBe(true);
  });
});
