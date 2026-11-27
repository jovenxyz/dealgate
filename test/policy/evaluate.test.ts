import { describe, expect, it } from "vitest";
import type { Change, FieldValue } from "../../src/change.js";
import { evaluateChange, evaluateChanges, parsePolicy, strictest } from "../../src/policy/index.js";

const update = (object: string, fields: Record<string, FieldValue>): Change => ({
  action: "update",
  object,
  recordId: "1",
  fields,
});
const create = (object: string, fields: Record<string, FieldValue>): Change => ({
  action: "create",
  object,
  fields,
});
const remove = (object: string): Change => ({ action: "delete", object, recordId: "1" });

const policy = parsePolicy(`
version: 1
crm: hubspot
objects:
  contacts:
    create: allow
    update:
      allow: [firstname, lastname]
      approve: [email]
      deny: [hs_object_id]
    delete: deny
  deals:
    create: approve
    update:
      allow: [amount, closedate]
      approve: [dealstage]
  notes:
    update: allow
`);

describe("strictest", () => {
  it("ranks deny above approve above allow", () => {
    expect(strictest([])).toBe("allow");
    expect(strictest(["allow", "approve"])).toBe("approve");
    expect(strictest(["approve", "deny", "allow"])).toBe("deny");
  });
});

describe("evaluateChange: field lists", () => {
  it("allows a field on the allow list", () => {
    expect(evaluateChange(policy, update("contacts", { firstname: "Ada" }))).toEqual({
      decision: "allow",
      reasons: [
        {
          decision: "allow",
          field: "firstname",
          message: "Changing contacts.firstname is allowed.",
        },
      ],
    });
  });

  it("holds a field on the approve list", () => {
    const result = evaluateChange(policy, update("contacts", { email: "ada@example.com" }));
    expect(result.decision).toBe("approve");
    expect(result.reasons[0]?.message).toBe("Changing contacts.email needs approval.");
  });

  it("blocks a field on the deny list", () => {
    expect(evaluateChange(policy, update("contacts", { hs_object_id: "9" })).decision).toBe("deny");
  });

  it("blocks a field the file doesn't mention", () => {
    expect(evaluateChange(policy, update("contacts", { phone: "555" }))).toEqual({
      decision: "deny",
      reasons: [
        {
          decision: "deny",
          field: "phone",
          message:
            "Changing contacts.phone isn't covered by the rules file, so it is blocked by default.",
        },
      ],
    });
  });

  it("gives one reason per field and uses the strictest", () => {
    const result = evaluateChange(policy, update("contacts", { firstname: "Ada", email: "a@b.c" }));
    expect(result.decision).toBe("approve");
    expect(result.reasons.map((r) => [r.field, r.decision])).toEqual([
      ["firstname", "allow"],
      ["email", "approve"],
    ]);
  });

  it("applies a single update setting to every field", () => {
    expect(evaluateChange(policy, update("notes", { anything: "x" })).decision).toBe("allow");
  });

  it("allows an update that changes no fields", () => {
    expect(evaluateChange(policy, update("contacts", {})).decision).toBe("allow");
  });

  it("uses approve for unlisted things when that's the default", () => {
    const lenient = parsePolicy("version: 1\ncrm: hubspot\ndefault: approve\n");
    const result = evaluateChange(lenient, update("tickets", { subject: "Hi" }));
    expect(result).toEqual({
      decision: "approve",
      reasons: [
        {
          decision: "approve",
          message:
            "Updating tickets isn't covered by the rules file, so it needs approval by default.",
        },
      ],
    });
  });
});

describe("evaluateChange: objects and actions", () => {
  it("blocks objects the file doesn't mention", () => {
    expect(evaluateChange(policy, update("tickets", { subject: "Hi" })).decision).toBe("deny");
    expect(evaluateChange(policy, create("tickets", {})).decision).toBe("deny");
    expect(evaluateChange(policy, remove("tickets")).decision).toBe("deny");
  });

  it("applies create and delete settings", () => {
    expect(evaluateChange(policy, create("contacts", { firstname: "Ada" })).decision).toBe("allow");
    expect(evaluateChange(policy, create("deals", { dealname: "Acme" })).reasons).toEqual([
      { decision: "approve", message: "Creating deals needs approval." },
    ]);
    expect(evaluateChange(policy, remove("contacts")).decision).toBe("deny");
  });

  it("falls back to the default for an action the object doesn't list", () => {
    expect(evaluateChange(policy, remove("deals")).reasons).toEqual([
      {
        decision: "deny",
        message: "Deleting deals isn't covered by the rules file, so it is blocked by default.",
      },
    ]);
  });

  it("doesn't treat built-in object property names as listed objects", () => {
    for (const object of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(evaluateChange(policy, update(object, { x: 1 })).decision).toBe("deny");
      expect(evaluateChange(policy, create(object, {})).decision).toBe("deny");
    }
  });
});

describe("evaluateChange: rules", () => {
  const withRules = parsePolicy(`
version: 1
crm: hubspot
objects:
  deals:
    create: allow
    update:
      allow: [amount, dealstage, closedate]
      deny: [hs_object_id]
rules:
  - name: big-deal
    when: { object: deals, field: amount, greaterThan: 10000 }
    decision: approve
  - when: { object: deals, field: amount, lessThan: 0 }
    decision: deny
  - name: people-close-deals
    when: { object: deals, field: dealstage, equals: closedwon }
    decision: deny
  - when: { object: deals, field: hs_object_id, greaterThan: 0 }
    decision: approve
`);

  it("holds a number above the limit", () => {
    expect(evaluateChange(withRules, update("deals", { amount: 50000 }))).toEqual({
      decision: "approve",
      reasons: [
        { decision: "allow", field: "amount", message: "Changing deals.amount is allowed." },
        {
          decision: "approve",
          field: "amount",
          rule: "big-deal",
          message:
            'Rule "big-deal": deals.amount is 50000, more than 10000, so this needs approval.',
        },
      ],
    });
  });

  it("treats numbers sent as text as numbers", () => {
    expect(evaluateChange(withRules, update("deals", { amount: "50000" })).decision).toBe(
      "approve",
    );
    expect(evaluateChange(withRules, update("deals", { amount: " 500 " })).decision).toBe("allow");
  });

  it("lets a number at or below the limit through", () => {
    expect(evaluateChange(withRules, update("deals", { amount: 10000 })).decision).toBe("allow");
  });

  it("supports lessThan, and labels unnamed rules by position", () => {
    const result = evaluateChange(withRules, update("deals", { amount: -5 }));
    expect(result.decision).toBe("deny");
    expect(result.reasons[1]).toEqual({
      decision: "deny",
      field: "amount",
      message: "Rule 2: deals.amount is -5, less than 0, so this is blocked.",
    });
  });

  it("applies number rules to values that aren't numbers, to be safe", () => {
    for (const amount of ["lots", "", null, true]) {
      const result = evaluateChange(withRules, update("deals", { amount }));
      // Both number rules apply, and the stricter one (lessThan 0 → deny) wins.
      expect(result.decision).toBe("deny");
      expect(result.reasons[1]?.message).toMatch(/can't be compared as a number/);
    }
  });

  it("supports equals", () => {
    expect(evaluateChange(withRules, update("deals", { dealstage: "closedwon" })).decision).toBe(
      "deny",
    );
    expect(evaluateChange(withRules, update("deals", { dealstage: "closedlost" })).decision).toBe(
      "allow",
    );
  });

  it("never loosens a decision", () => {
    // hs_object_id is on the deny list; the rule only says approve.
    expect(evaluateChange(withRules, update("deals", { hs_object_id: 7 })).decision).toBe("deny");
  });

  it("applies when creating records", () => {
    expect(evaluateChange(withRules, create("deals", { amount: 20000 })).decision).toBe("approve");
  });

  it("ignores changes that don't touch the rule's field or object", () => {
    expect(evaluateChange(withRules, update("deals", { closedate: "2027-01-01" })).decision).toBe(
      "allow",
    );
    const contactRule = parsePolicy(`
version: 1
crm: hubspot
objects:
  contacts:
    update: allow
rules:
  - when: { object: deals, field: amount, greaterThan: 1 }
    decision: deny
`);
    expect(evaluateChange(contactRule, update("contacts", { amount: 99 })).decision).toBe("allow");
  });

  it("doesn't apply to deletes", () => {
    const deletable = parsePolicy(`
version: 1
crm: hubspot
objects:
  deals:
    delete: allow
rules:
  - when: { object: deals, field: amount, greaterThan: 1 }
    decision: deny
`);
    expect(evaluateChange(deletable, remove("deals")).decision).toBe("allow");
  });
});

describe("evaluateChanges", () => {
  const limited = parsePolicy(`
version: 1
crm: hubspot
objects:
  contacts:
    update:
      allow: [firstname]
      approve: [email]
limits:
  maxChangesPerRequest: 2
`);

  it("returns one evaluation per change, in order, and the strictest overall", () => {
    const result = evaluateChanges(limited, [
      update("contacts", { firstname: "Ada" }),
      update("contacts", { email: "a@b.c" }),
    ]);
    expect(result.decision).toBe("approve");
    expect(result.reasons).toEqual([]);
    expect(result.changes.map((c) => c.decision)).toEqual(["allow", "approve"]);
  });

  it("holds a request with more changes than the limit", () => {
    const three = [1, 2, 3].map(() => update("contacts", { firstname: "Ada" }));
    const result = evaluateChanges(limited, three);
    expect(result.decision).toBe("approve");
    expect(result.reasons).toEqual([
      {
        decision: "approve",
        message: "This request has 3 changes, more than the limit of 2, so it needs approval.",
      },
    ]);
    expect(result.changes.map((c) => c.decision)).toEqual(["allow", "allow", "allow"]);
  });

  it("keeps a deny when the request is also over the limit", () => {
    const result = evaluateChanges(limited, [
      update("contacts", { firstname: "Ada" }),
      update("contacts", { firstname: "Bo" }),
      update("contacts", { phone: "555" }),
    ]);
    expect(result.decision).toBe("deny");
  });

  it("allows an empty request", () => {
    expect(evaluateChanges(limited, [])).toEqual({ decision: "allow", reasons: [], changes: [] });
  });

  it("has no limit unless the file sets one", () => {
    const many = Array.from({ length: 50 }, () => update("contacts", { firstname: "Ada" }));
    expect(evaluateChanges(policy, many).decision).toBe("allow");
  });
});
