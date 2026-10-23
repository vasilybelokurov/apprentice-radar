import { describe, expect, it } from "vitest";
import { classifyRequirement, describeRequirement, gcseFit } from "../src/lib/requirements.ts";
import type { Requirement } from "../src/lib/types.ts";

const req = (type: string | null, essential = true, subject: string | null = null, grade: string | null = null): Requirement => ({ essential, type, subject, grade });

describe("classifyRequirement (wording seen in live DfE data, 2026-10-23)", () => {
  it.each([
    "GCSE",
    "GCSE or equivalent",
    "5 GCSE's including Maths and English at grade 4/C",
    "5 GCSE's",
    "Functional Skills",
    "functional Skills",
    "English",
    "Maths",
    "Level 2",
    "Level 2 or above",
  ])("%j is GCSE-level", (type) => expect(classifyRequirement(req(type))).toBe("gcse"));

  it.each([
    "A Level",
    "T Level",
    "BTEC",
    "BTEC or equivalent",
    "UCAS Points",
    "Achieved or predicted UCAS Points",
    "Degree",
    "Bachelors Degree",
    "HNC",
    "Level 3 or equivalent",
    "Level 3 and Above",
    "Level 4 Apprenticeship",
    "Higher Technical Qualification (Level 4)",
    "Early Years Educator - Level 3",
    "Early Years Educator",
    "Early Years Educator L3",
    "Apprenticeship/ Btec or Tlevel (Alevel equiv)",
    "A level equivalent (E.G NVQ or BTEC)",
    "Level 3 Qualification i.e. A Level, BTEC, TLevel",
    "L3 Diploma/ NVQ",
  ])("%j is Level 3 or above", (type) => expect(classifyRequirement(req(type))).toBe("level3"));

  it.each(["DBS Check", "DBS", "CSCS Card", "Driving Licence", "Full UK Driving Licence", "DRIVING LICENSE", "UK Driving licence", "Computer Skills", "IT Skills", "ICT", "Experience working with children"])(
    "%j is not a qualification",
    (type) => expect(classifyRequirement(req(type))).toBe("not-a-qualification"),
  );

  it.each(["Level 2 Early Years Practitioner", "AAT Level 2", "Childcare", "Plumbing", "NVQ2", "Please see other info for more entry requirements", "Level 2 Diploma"])(
    "%j is another qualification",
    (type) => expect(classifyRequirement(req(type))).toBe("other"),
  );

  it("reads the subject when the type is missing or 'Other'", () => {
    expect(classifyRequirement(req("Other", true, "Three A Levels", "C"))).toBe("level3");
    expect(classifyRequirement(req(null, true, "Drivers Licence"))).toBe("not-a-qualification");
    expect(classifyRequirement(req("Other", true, "Must be able to obtain a clear DBS"))).toBe("not-a-qualification");
    expect(classifyRequirement(req("Other", true, "None", "N/A"))).toBe("not-a-qualification");
    expect(classifyRequirement(req("Qualification", true, "Childcare L2"))).toBe("other");
  });

  it("does not read 'a Level 2' as an A level", () => {
    expect(classifyRequirement(req("Other", true, "a Level 2 qualification in Business"))).toBe("other");
  });

  it("classifies a GCSE entry by its type, whatever the subject says", () => {
    expect(classifyRequirement(req("GCSE", true, "Maths GCSE", "Grade 4/C or above"))).toBe("gcse");
  });
});

describe("gcseFit", () => {
  it("no requirements listed: suitable", () => {
    expect(gcseFit({ requirements: [] })).toEqual({ suitable: true, blockers: [], level3Preferred: false, drivingLicence: false });
  });

  it("essential GCSEs: suitable", () => {
    expect(gcseFit({ requirements: [req("GCSE", true, "English and Maths", "9-4")] }).suitable).toBe(true);
  });

  it("essential A level: ruled out, with the reason", () => {
    const a = req("A Level", true, "Maths", "C");
    expect(gcseFit({ requirements: [req("GCSE"), a] })).toMatchObject({ suitable: false, blockers: [a] });
  });

  it("desired A level: suitable, but labelled", () => {
    expect(gcseFit({ requirements: [req("GCSE"), req("A Level", false)] })).toMatchObject({ suitable: true, level3Preferred: true });
  });

  it("essential vocational qualification: ruled out", () => {
    expect(gcseFit({ requirements: [req("Level 2 Early Years Practitioner")] }).suitable).toBe(false);
  });

  it("desired vocational qualification: no effect", () => {
    expect(gcseFit({ requirements: [req("Level 2 Early Years Practitioner", false)] })).toMatchObject({ suitable: true, level3Preferred: false });
  });

  it("essential driving licence: suitable, flagged", () => {
    expect(gcseFit({ requirements: [req("Full UK Driving Licence")] })).toMatchObject({ suitable: true, drivingLicence: true });
    expect(gcseFit({ requirements: [req("Driving Licence", false)] }).drivingLicence).toBe(false);
  });
});

describe("describeRequirement", () => {
  it("joins type, subject and grade", () => {
    expect(describeRequirement(req("GCSE", true, "English and Maths", "9-4/A*-C"))).toBe("GCSE: English and Maths (9-4/A*-C)");
    expect(describeRequirement(req(null, true, "Drivers Licence", "N/A"))).toBe("Drivers Licence");
    expect(describeRequirement(req(null, true))).toBe("Qualification");
    expect(describeRequirement(req("AAT Level 2", true, "AAT level 2", "Pass"))).toBe("AAT Level 2 (Pass)");
  });
});
