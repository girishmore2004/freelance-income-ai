import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectTech,
  fromJobicy,
  fromRemotive,
  locationOk,
  parseDate,
  workTypeOk
} from "./discovery-agent";
import type { NormalizedJob } from "./discovery-agent";

// Payload shapes follow the providers' documented fields.
const remotivePayload = {
  "0-legal-notice": "Remotive notice",
  "job-count": 2,
  jobs: [
    {
      id: 101,
      url: "https://remotive.com/remote-jobs/software-dev/101",
      title: "Python API contractor",
      company_name: "Acme",
      category: "Software Development",
      job_type: "contract",
      publication_date: "2026-11-14T09:30:00",
      candidate_required_location: "Worldwide",
      description: "<p>Build a <b>FastAPI</b> service with PostgreSQL &amp; Docker.</p><ul><li>RAG</li></ul>"
    },
    {
      id: 102,
      url: "https://remotive.com/remote-jobs/software-dev/102",
      title: "Senior Engineer",
      company_name: "Big Co",
      job_type: "full_time",
      publication_date: "2026-11-14T09:30:00Z",
      candidate_required_location: "USA Only",
      description: "Full time role"
    }
  ]
};

const jobicyPayload = {
  jobs: [
    {
      id: 7,
      url: "https://jobicy.com/jobs/7-react-freelance",
      jobTitle: "React freelancer",
      companyName: "Beta",
      jobIndustry: ["Engineering"],
      jobType: ["Freelance"],
      jobGeo: "Anywhere",
      jobExcerpt: "Short excerpt",
      jobDescription: "<p>React and TypeScript work</p>",
      pubDate: "2026-11-13 12:00:00"
    }
  ]
};

function mockFetch(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }))
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("job feed normalisation", () => {
  it("normalises Remotive jobs and strips HTML", async () => {
    mockFetch(remotivePayload);
    const jobs = await fromRemotive("python");

    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      source: "remotive",
      external_id: "101",
      company: "Acme",
      job_type: "contract",
      location: "Worldwide"
    });
    expect(jobs[0].description).toContain("FastAPI");
    expect(jobs[0].description).not.toContain("<");
    expect(jobs[0].description).toContain("&");
    expect(jobs[0].published_at?.toISOString()).toBe("2026-11-14T09:30:00.000Z");
    // A timestamp that already has "Z" must not become an invalid date.
    expect(jobs[1].published_at?.toISOString()).toBe("2026-11-14T09:30:00.000Z");
  });

  it("normalises Jobicy jobs", async () => {
    mockFetch(jobicyPayload);
    const jobs = await fromJobicy("react");

    expect(jobs[0]).toMatchObject({
      source: "jobicy",
      external_id: "7",
      job_type: "freelance",
      industry: "Engineering",
      location: "Anywhere"
    });
    expect(jobs[0].published_at).not.toBeNull();
  });

  it("treats an HTTP error as a failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 429 })));
    await expect(fromRemotive("python")).rejects.toThrow("HTTP 429");
  });
});

describe("filters", () => {
  const base: NormalizedJob = {
    source: "remotive",
    external_id: "1",
    title: "Dev",
    company: "X",
    description: "",
    url: "u",
    job_type: "",
    industry: "",
    location: "",
    published_at: null
  };

  it("accepts worldwide and Asia, rejects country-locked jobs", () => {
    expect(locationOk("Worldwide")).toBe(true);
    expect(locationOk("")).toBe(true);
    expect(locationOk("APAC")).toBe(true);
    expect(locationOk("USA Only")).toBe(false);
  });

  it("keeps freelance and contract, drops full time unless wanted", () => {
    expect(workTypeOk({ ...base, job_type: "contract" }, ["fixed"])).toBe(true);
    expect(workTypeOk({ ...base, job_type: "full_time" }, ["fixed", "hourly"])).toBe(false);
    expect(workTypeOk({ ...base, job_type: "full_time" }, ["full_time"])).toBe(true);
    expect(workTypeOk({ ...base, description: "short-term contract work" }, [])).toBe(true);
    expect(workTypeOk({ ...base, description: "join our team" }, [])).toBe(false);
  });

  it("detects technologies named in a listing", () => {
    const found = detectTech({ ...base, title: "Python dev", description: "FastAPI, PostgreSQL and Next.js" });
    expect(found).toEqual(expect.arrayContaining(["python", "fastapi", "postgresql", "next.js"]));
  });

  it("parses dates safely", () => {
    expect(parseDate("not a date")).toBeNull();
    expect(parseDate("2026-11-14T09:30:00")?.getUTCHours()).toBe(9);
  });
});
