import { z } from "zod";

/** Error message that says "is required" when the key is missing, and `message` otherwise. */
function orRequired(message: string) {
  return {
    error: (issue: { input?: unknown }) => (issue.input === undefined ? "is required" : message),
  };
}

const decision = z.enum(["allow", "approve", "deny"], {
  error: 'must be "allow", "approve" or "deny"',
});

const fieldName = z
  .string({ error: "must be a field name" })
  .min(1, { error: "must not be empty" });

const fieldList = z.array(fieldName, { error: "must be a list of field names" });

const fieldRules = z
  .strictObject({
    allow: fieldList.optional(),
    approve: fieldList.optional(),
    deny: fieldList.optional(),
  })
  .superRefine((lists, ctx) => {
    const seen = new Map<string, string>();
    for (const list of ["allow", "approve", "deny"] as const) {
      for (const [index, field] of (lists[list] ?? []).entries()) {
        const earlier = seen.get(field);
        if (earlier === undefined) {
          seen.set(field, list);
        } else {
          ctx.addIssue({
            code: "custom",
            path: [list, index],
            message: `"${field}" is already listed under ${earlier}`,
          });
        }
      }
    }
  });

const objectRules = z.strictObject(
  {
    create: decision.optional(),
    update: z
      .union([decision, fieldRules], {
        error: 'must be "allow", "approve", "deny", or field lists under allow, approve and deny',
      })
      .optional(),
    delete: decision.optional(),
  },
  { error: "must be a map with create, update and delete settings" },
);

const comparisons = ["greaterThan", "lessThan", "equals"] as const;

const condition = z
  .strictObject(
    {
      object: z.string(orRequired("must be an object name")).min(1, { error: "must not be empty" }),
      field: z.string(orRequired("must be a field name")).min(1, { error: "must not be empty" }),
      greaterThan: z.number({ error: "must be a number" }).optional(),
      lessThan: z.number({ error: "must be a number" }).optional(),
      equals: z
        .union([z.string(), z.number(), z.boolean()], {
          error: "must be text, a number, true or false",
        })
        .optional(),
    },
    orRequired("must be a map with object, field and one comparison"),
  )
  .superRefine((when, ctx) => {
    const used = comparisons.filter((key) => when[key] !== undefined);
    if (used.length !== 1) {
      ctx.addIssue({
        code: "custom",
        message:
          used.length === 0
            ? "needs one comparison: greaterThan, lessThan or equals"
            : `can only have one comparison, but has ${used.join(" and ")}`,
      });
    }
  });

const rule = z.strictObject(
  {
    name: z.string({ error: "must be text" }).min(1, { error: "must not be empty" }).optional(),
    when: condition,
    // Rules can only make a decision stricter, so "allow" isn't accepted here.
    decision: z.enum(
      ["approve", "deny"],
      orRequired('must be "approve" or "deny" (rules can only make a decision stricter)'),
    ),
  },
  { error: "must be a map with when and decision" },
);

const wholeNumber = { error: "must be a whole number above 0" };

const limits = z.strictObject(
  {
    maxChangesPerRequest: z.number(wholeNumber).int(wholeNumber).positive(wholeNumber).optional(),
  },
  { error: "must be a map of limits" },
);

/** Schema for the rules file (`dealgate.yaml`). */
export const policySchema = z.strictObject(
  {
    version: z.literal(1, orRequired("must be 1")),
    crm: z.enum(["hubspot"], orRequired('must be "hubspot", the only CRM supported so far')),
    default: z.enum(["deny", "approve"], { error: 'must be "deny" or "approve"' }).default("deny"),
    objects: z
      .record(z.string(), objectRules, { error: "must be a map of object names" })
      .default({}),
    rules: z.array(rule, { error: "must be a list of rules" }).default([]),
    limits: limits.default({}),
  },
  { error: "must be a map of settings (key: value)" },
);

/** A validated rules file, with defaults filled in. */
export type Policy = z.output<typeof policySchema>;

/** The rules for one CRM object, such as `deals`. */
export type ObjectRules = z.output<typeof objectRules>;

/** One entry under `rules:`. */
export type Rule = z.output<typeof rule>;
