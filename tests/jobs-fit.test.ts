import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToText, jobFit, titleReasons, type JobInput } from "../src/lib/jobs-fit.ts";

// Advert wording below is taken from (or modelled on) live Reed adverts, 2026-10-23.
const job = (text: string, over: Partial<JobInput> = {}): JobInput => ({
  title: "Warehouse Operative",
  text,
  pay: { type: "per hour", min: 13 },
  partTime: false,
  contract: "Permanent",
  ...over,
});
const verdict = (text: string, over: Partial<JobInput> = {}) => jobFit(job(text, over));

describe("titleReasons", () => {
  it.each(["Senior Accounts Assistant", "Team Leader", "Head Chef", "Finance Manager - Part-Time", "Mechatronics Design Expert", "Experienced Patent Secretary"])(
    "%j is a senior role",
    (t) => expect(titleReasons(t)).toEqual(["Senior or management role"]),
  );
  it.each(["Solicitor", "Software Developer", "Electrician", "Dispensing Optician Assistant Manager", "HLTA", "2nd Line Support Technician", "Revit Technician"])(
    "%j is excluded",
    (t) => expect(titleReasons(t)).not.toEqual([]),
  );
  it.each(["Junior Electrician / Electrician's Mate (Full Training)", "Trainee Dental Nurse", "Teaching Assistant", "Accounts Assistant", "Warehouse Operative", "Customer Service Advisor"])(
    "%j passes",
    (t) => expect(titleReasons(t)).toEqual([]),
  );
  it("sends apprenticeships to the apprenticeship search", () => {
    expect(titleReasons("Apprentice Chef")[0]).toMatch(/Apprenticeship/);
  });
});

describe("jobFit: strong signals exclude, with the sentence as evidence", () => {
  it.each([
    ["• A degree in Geology, Engineering Geology or a related discipline.", "Needs a degree"],
    ["Candidates will need A Levels in Maths and Physics.", "Needs A levels"],
    ["Qualification: Level 3 Early Years / Childcare Qualification", "Needs a Level 3 or higher qualification"],
    ["• Holds an HLTA qualification.", "Needs a professional qualification or licence"],
    ["You must have experience working in a financial planning administrator role.", "Needs previous experience"],
    ["Are you an experienced Credit Controller looking for a new role?", "Needs previous experience"],
    ["We're hiring reliable, experienced Stock Replenishment Assistants.", "Needs previous experience"],
    ["The ideal candidate will have experience within a relevant accounts role.", "Needs previous experience"],
    ["Please note, this role requires you to have the appropriate driving licence with previous experience as a driver.", "Needs previous experience"],
    ["• Proven administrative experience in a fast-paced environment (HR experience preferred).", "Needs proven experience"],
    ["For this position, you will need strong knowledge in patent formalities.", "Needs specialist knowledge"],
    ["• Minimum of 2 years’ experience in first-line support.", "Needs 2+ years' experience"],
    ["Please note this is a training course and fees apply.", "Paid training course, not a job"],
    ["Drivers must be aged 25 or over for insurance.", "Must be 21 or over"],
  ])("%j -> %j", (text, reason) => {
    const f = verdict(text);
    expect(f.suitable).toBe(false);
    expect(f.reasons).toContain(reason);
    expect(f.evidence[f.reasons.indexOf(reason)]).toBe(text.replace(/^•\s*/, ""));
  });

  it("two required experience bullets exclude; one only labels", () => {
    const two = "Required Skills & Experience\n• Experience assembling precision components.\n• Experience using measuring equipment.";
    expect(verdict(two).reasons).toContain("Needs previous experience");
    const one = "Required Skills & Experience\n• Previous experience in a warehouse environment";
    expect(verdict(one)).toMatchObject({ suitable: true, labels: ["Asks for some experience"] });
  });

  it("high pay excludes unless full training is offered", () => {
    expect(verdict("Join our team.", { pay: { type: "per annum", min: 33_000 } }).reasons).toEqual(["Pay suggests an experienced role"]);
    expect(verdict("Full training will be provided.", { pay: { type: "per annum", min: 33_000 } }).suitable).toBe(true);
    expect(verdict("Join our team.", { pay: { type: "per hour", min: 17.7 } }).suitable).toBe(true);
  });
});

describe("jobFit: wording that must not exclude", () => {
  it.each([
    "No previous experience required; however, experience in similar environments is a bonus.",
    "Whilst sales experience is not essential, this is a results based role.",
    "Whether you're an experienced Teaching Assistant or looking to take the next step, apply today.",
    "A degree or significant experience in supporting students is welcomed.",
    "Previous experience working with SEN pupils is desirable.",
    "A Teaching Assistant qualification (Level 2 or 3) is desirable but not essential.",
    "Qualification: NVQ level 2 or level 3",
    "We will train you into a fully-fledged Field Service Engineer / qualified electrician.",
    "£30,000 + Full Training + Progression to Field Service Engineer / Qualified Electrician",
    "We encourage applications from suitably qualified and eligible candidates.",
    "We have a proven track record of placing candidates.",
    "With over 30 years' experience delivering projects, the company is growing.",
    "Working alongside experienced colleagues who will support your progression.",
    "You will have the opportunity to gain experience across sectors.",
    "Store temperatures can be -20 degrees.",
    "This role needs a high degree of accuracy.",
    "We are looking at a level that suits you.",
    "Skills and Experience Required",
  ])("%j", (text) => expect(verdict(text).suitable).toBe(true));
});

describe("jobFit: labels", () => {
  it("driving licence, training, part time, contract", () => {
    const f = verdict("• Full UK driving licence and access to a car\nFull training will be provided.", { partTime: true, contract: "Temporary" });
    expect(f.labels).toEqual(expect.arrayContaining(["Driving licence required", "No experience needed / training given", "Part time", "Temporary"]));
  });
  it("preferred qualifications become labels", () => {
    expect(verdict("A Level 2 Food Hygiene qualification would be beneficial. A degree is desirable.").labels).toContain("Degree preferred");
  });
  it("a heading marks the bullets below it as preferred", () => {
    expect(verdict("Desirable:\n• A degree in a related subject").labels).toContain("Degree preferred");
    expect(verdict("Essential:\n• A degree in a related subject").reasons).toContain("Needs a degree");
  });
  it("one year of experience is a label, not an exclusion", () => {
    expect(verdict("You will need at least 1 year of retail experience.").labels).toContain("Asks for a year's experience");
  });
});

describe("htmlToText / decodeEntities", () => {
  it("keeps list items and paragraphs as lines", () => {
    expect(htmlToText("<p>Intro</p><ul><li>One</li><li>Two &amp; three</li></ul>")).toBe("Intro\n• One\n• Two & three");
  });
  it("turns plain-text bullets into •", () => {
    expect(htmlToText("Needs:<br>* Experience in an office<br>- Excel")).toBe("Needs:\n• Experience in an office\n• Excel");
  });
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("Child &amp; Youth &#163;25K &#x2013; now")).toBe("Child & Youth £25K – now");
  });
});
