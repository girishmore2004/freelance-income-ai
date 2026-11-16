import { afterEach, describe, expect, it, vi } from "vitest";
import { fromFreelancer, fromHackerNews, fromReddit, parseBudget } from "./project-sources";
import { detectTech, workTypeOk } from "./discovery-agent";

// Payload shapes follow each provider's documented fields. These tests check
// our parsing only; they do not prove the live APIs still return this shape.
function mockFetchSequence(payloads: unknown[]) {
  const queue = [...payloads];
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => queue.shift() })));
}

afterEach(() => vi.unstubAllGlobals());

describe("parseBudget", () => {
  it("reads ranges and ignores hourly rates", () => {
    expect(parseBudget("Budget $500 - $1,500 total")).toEqual({ min: 500, max: 1500 });
    expect(parseBudget("Paying $40/hr")).toEqual({ min: null, max: null });
    expect(parseBudget("about $2k")).toEqual({ min: 2000, max: 2000 });
  });
});

describe("project sources", () => {
  it("maps Freelancer.com projects with budget, skills and competition", async () => {
    mockFetchSequence([
      {
        result: {
          projects: [
            {
              id: 9,
              title: "Build FastAPI backend",
              seo_url: "python/fastapi-backend",
              description: "<p>Need FastAPI</p>",
              currency: { code: "USD" },
              budget: { minimum: 250, maximum: 750 },
              time_submitted: 1763000000,
              jobs: [{ name: "Python" }],
              bid_stats: { bid_count: 12 }
            }
          ]
        }
      }
    ]);
    const [job] = await fromFreelancer("python");
    expect(job.url).toBe("https://www.freelancer.com/projects/python/fastapi-backend");
    expect([job.budget_min, job.budget_max, job.competition]).toEqual([250, 750, "medium"]);
    expect(detectTech(job)).toContain("python");
    expect(workTypeOk(job, [])).toBe(true);
  });

  it("keeps only top-level 'SEEKING FREELANCER' Hacker News posts", async () => {
    mockFetchSequence([
      { hits: [{ objectID: "1", title: "Ask HN: Freelancer? Seeking freelancer? (November 2026)" }] },
      {
        hits: [
          { objectID: "10", parent_id: 1, author: "acme", created_at: "2026-11-02T10:00:00.000Z", comment_text: "SEEKING FREELANCER | Remote | React dev<p>Budget $3,000 fixed</p>" },
          { objectID: "11", parent_id: 1, author: "bob", comment_text: "SEEKING WORK | Remote | I do React" },
          { objectID: "12", parent_id: 10, author: "x", comment_text: "SEEKING FREELANCER reply" }
        ]
      }
    ]);
    const jobs = await fromHackerNews("react");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].url).toBe("https://news.ycombinator.com/item?id=10");
    expect(jobs[0].budget_min).toBe(3000);
  });

  it("keeps only [Hiring] posts from r/forhire", async () => {
    mockFetchSequence([
      {
        data: {
          children: [
            { data: { id: "a", title: "[Hiring] Node.js API developer", selftext: "Pay $800", permalink: "/r/forhire/comments/a/x/", author: "u1", created_utc: 1763000000 } },
            { data: { id: "b", title: "[For Hire] I am a designer", selftext: "", permalink: "/r/forhire/comments/b/x/", author: "u2" } }
          ]
        }
      }
    ]);
    const jobs = await fromReddit("node");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe("Node.js API developer");
    expect(jobs[0].budget_min).toBe(800);
  });
});
