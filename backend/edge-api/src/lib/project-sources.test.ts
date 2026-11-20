import { afterEach, describe, expect, it, vi } from "vitest";
import { fromFreelancer, fromHackerNews, fromReddit, hiringPostToJob, parseBudget } from "./project-sources";
import { detectTech, workTypeOk } from "./discovery-agent";

// Payload shapes follow each provider's documented fields. These tests check
// our parsing only; they do not prove the live APIs still return this shape.
function mockFetchSequence(payloads: unknown[]) {
  const queue = [...payloads];
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => queue.shift() })));
}

/** Answers by URL, for sources that make several requests in parallel. */
function mockFetchByUrl(routes: Array<[RegExp, unknown]>) {
  const fn = vi.fn(async (url: string) => {
    const hit = routes.find(([pattern]) => pattern.test(String(url)));
    return { ok: Boolean(hit), status: hit ? 200 : 404, json: async () => hit?.[1] };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
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

  // Since U30 the source also reads the monthly "Who is hiring?" thread in parallel, so the fake answers by URL.
  it("keeps only top-level 'SEEKING FREELANCER' Hacker News posts", async () => {
    mockFetchByUrl([
      [/query=Freelancer/, { hits: [{ objectID: "1", title: "Ask HN: Freelancer? Seeking freelancer? (November 2026)" }] }],
      [/query=hiring/, { hits: [] }],
      [/story_1/, {
        hits: [
          { objectID: "10", parent_id: 1, author: "acme", created_at: "2026-11-02T10:00:00.000Z", comment_text: "SEEKING FREELANCER | Remote | React dev<p>Budget $3,000 fixed</p>" },
          { objectID: "11", parent_id: 1, author: "bob", comment_text: "SEEKING WORK | Remote | I do React" },
          { objectID: "12", parent_id: 10, author: "x", comment_text: "SEEKING FREELANCER reply" }
        ]
      }]
    ]);
    const jobs = await fromHackerNews("react");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].url).toBe("https://news.ycombinator.com/item?id=10");
    expect(jobs[0].budget_min).toBe(3000);
  });

  it("adds contract, freelance or part-time remote company posts from \"Who is hiring?\" (U30)", async () => {
    mockFetchByUrl([
      [/query=Freelancer/, { hits: [] }],
      [/query=hiring/, { hits: [{ objectID: "2", title: "Ask HN: Who is hiring? (November 2026)" }] }],
      [/story_2/, { hits: [
        { objectID: "20", parent_id: 2, author: "acme", created_at: "2026-11-03T10:00:00.000Z", comment_text: "Acme Analytics | Senior React engineer | REMOTE | Contract, 3 months<p>We build dashboards for clinics. Rate $90/hr. Apply at careers page.</p>" },
        { objectID: "21", parent_id: 2, author: "big", comment_text: "BigCo | Backend engineer | Onsite NYC | Full-time<p>Great benefits.</p>" },
        { objectID: "22", parent_id: 2, author: "far", comment_text: "FarCo | Designer | Full-time | REMOTE<p>Salary 120k.</p>" },
        { objectID: "23", parent_id: 20, author: "reply", comment_text: "Acme | Contract | REMOTE reply" },
      ] }],
    ]);
    const jobs = await fromHackerNews("react");
    expect(jobs.map((j) => j.external_id)).toEqual(["20"]);
    expect(jobs[0]).toMatchObject({ company: "Acme Analytics", job_type: "contract", location: "Remote", url: "https://news.ycombinator.com/item?id=20" });
    expect(hiringPostToJob({ objectID: "x", comment_text: "No pipes here, contract remote" })).toBeNull();
  });

  // Reddit's Public Content Policy (May 2024) needs a contract for commercial use: off by default since U30.
  it("calls Reddit only once a data agreement is recorded", async () => {
    const fetchFn = mockFetchByUrl([]);
    expect(await fromReddit("node")).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
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
    const jobs = await fromReddit("node", { REDDIT_DATA_AGREEMENT: "true" } as never);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe("Node.js API developer");
    expect(jobs[0].budget_min).toBe(800);
  });
});
