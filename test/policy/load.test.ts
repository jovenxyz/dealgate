import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPolicy, PolicyError, parsePolicy } from "../../src/policy/index.js";

const examplePath = fileURLToPath(new URL("../../examples/dealgate.yaml", import.meta.url));

const header = "version: 1\ncrm: hubspot\n";

/** Parses YAML that should be rejected, and returns the reported problems. */
function problemsOf(text: string): readonly string[] {
  try {
    parsePolicy(text);
  } catch (error) {
    if (error instanceof PolicyError) return error.problems;
    throw error;
  }
  throw new Error("expected the rules file to be rejected");
}

describe("loadPolicy", () => {
  it("loads the example rules file", async () => {
    const policy = await loadPolicy(examplePath);

    expect(policy.crm).toBe("hubspot");
    expect(policy.default).toBe("deny");
    expect(Object.keys(policy.objects)).toEqual(["contacts", "companies", "deals"]);
    expect(policy.rules.map((rule) => rule.name)).toEqual(["big-deal", "people-close-deals"]);
    expect(policy.limits.maxChangesPerRequest).toBe(10);
  });

  it("names the file in the error message", async () => {
    await expect(loadPolicy(examplePath.replace("dealgate.yaml", "missing.yaml"))).rejects.toThrow(
      /ENOENT/,
    );
    expect(() => parsePolicy("version: 2\ncrm: hubspot\n", "team-rules.yaml")).toThrow(
      /Invalid rules file team-rules\.yaml:\n {2}- version: must be 1/,
    );
  });
});

describe("parsePolicy", () => {
  it("fills in defaults for everything optional", () => {
    expect(parsePolicy(header)).toEqual({
      version: 1,
      crm: "hubspot",
      default: "deny",
      objects: {},
      rules: [],
      limits: {},
    });
  });

  it("accepts approve as the default", () => {
    expect(parsePolicy(`${header}default: approve\n`).default).toBe("approve");
  });

  it("rejects an empty file", () => {
    expect(problemsOf("")).toEqual(["the file is empty"]);
    expect(problemsOf("# only a comment\n")).toEqual(["the file is empty"]);
  });

  it("rejects a file that isn't a map", () => {
    expect(problemsOf("- version: 1\n")).toEqual([
      "top level: must be a map of settings (key: value)",
    ]);
  });

  it("says which required settings are missing", () => {
    expect(problemsOf("default: deny\n")).toEqual(["version: is required", "crm: is required"]);
  });

  it("rejects unsupported versions and CRMs", () => {
    expect(problemsOf("version: 2\ncrm: salesforce\n")).toEqual([
      "version: must be 1",
      'crm: must be "hubspot", the only CRM supported so far',
    ]);
  });

  it("reports misspelled keys with their location", () => {
    expect(problemsOf(`${header}objects:\n  deals:\n    updte: allow\n`)).toEqual([
      'objects.deals: unknown key "updte"',
    ]);
    expect(problemsOf(`${header}objects:\n  deals:\n    update:\n      alow: [amount]\n`)).toEqual([
      'objects.deals.update: unknown key "alow"',
    ]);
  });

  it("rejects decisions that don't exist", () => {
    expect(problemsOf(`${header}objects:\n  deals:\n    create: maybe\n`)).toEqual([
      'objects.deals.create: must be "allow", "approve" or "deny"',
    ]);
    expect(problemsOf(`${header}objects:\n  deals:\n    update: maybe\n`)).toEqual([
      'objects.deals.update: must be "allow", "approve", "deny", or field lists under allow, approve and deny',
    ]);
  });

  it("rejects a field listed under more than one decision", () => {
    const text = `${header}objects:\n  deals:\n    update:\n      allow: [amount]\n      approve: [dealstage, amount]\n`;
    expect(problemsOf(text)).toEqual([
      'objects.deals.update.approve[1]: "amount" is already listed under allow',
    ]);
  });

  it("requires exactly one comparison per rule", () => {
    const none = `${header}rules:\n  - when: { object: deals, field: amount }\n    decision: approve\n`;
    expect(problemsOf(none)).toEqual([
      "rules[0].when: needs one comparison: greaterThan, lessThan or equals",
    ]);

    const two = `${header}rules:\n  - when: { object: deals, field: amount, greaterThan: 1, lessThan: 5 }\n    decision: approve\n`;
    expect(problemsOf(two)).toEqual([
      "rules[0].when: can only have one comparison, but has greaterThan and lessThan",
    ]);
  });

  it("rejects number comparisons against text", () => {
    const text = `${header}rules:\n  - when: { object: deals, field: amount, greaterThan: lots }\n    decision: approve\n`;
    expect(problemsOf(text)).toEqual(["rules[0].when.greaterThan: must be a number"]);
  });

  it("doesn't let rules allow anything", () => {
    const text = `${header}rules:\n  - when: { object: deals, field: amount, lessThan: 100 }\n    decision: allow\n`;
    expect(problemsOf(text)).toEqual([
      'rules[0].decision: must be "approve" or "deny" (rules can only make a decision stricter)',
    ]);
  });

  it("requires a positive whole number for the change limit", () => {
    for (const value of ["0", "2.5", "ten"]) {
      expect(problemsOf(`${header}limits:\n  maxChangesPerRequest: ${value}\n`)).toEqual([
        "limits.maxChangesPerRequest: must be a whole number above 0",
      ]);
    }
  });

  it("reports YAML mistakes with the line number", () => {
    const [problem, ...rest] = problemsOf(`${header}crm: hubspot\n`);
    expect(rest).toEqual([]);
    expect(problem).toMatch(/unique.*line 3/i);
  });
});
