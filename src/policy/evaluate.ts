import type { Change, FieldValue } from "../change.js";
import type { ObjectRules, Policy, Rule } from "./schema.js";

/** What dealgate does with a change: make it, hold it for a person, or block it. */
export type Decision = "allow" | "approve" | "deny";

/** One check that contributed to a decision, in words a person or an agent can read. */
export interface Reason {
  decision: Decision;
  message: string;
  /** The field this reason is about, if any. */
  field?: string;
  /** The rule's name, if a named rule produced this reason. */
  rule?: string;
}

export interface Evaluation {
  /** The strictest decision among the reasons. */
  decision: Decision;
  reasons: Reason[];
}

export interface BatchEvaluation extends Evaluation {
  /** Reasons that apply to the request as a whole, such as the change limit. */
  reasons: Reason[];
  /** One evaluation per change, in the same order as the changes. */
  changes: Evaluation[];
}

const strictness: Record<Decision, number> = { allow: 0, approve: 1, deny: 2 };

/** Returns the strictest decision (deny > approve > allow). An empty list means allow. */
export function strictest(decisions: Iterable<Decision>): Decision {
  let result: Decision = "allow";
  for (const decision of decisions) {
    if (strictness[decision] > strictness[result]) result = decision;
  }
  return result;
}

/** Decides what to do with one change. */
export function evaluateChange(policy: Policy, change: Change): Evaluation {
  // Object.hasOwn keeps names like "constructor" from matching built-in object properties.
  const rules = Object.hasOwn(policy.objects, change.object)
    ? policy.objects[change.object]
    : undefined;

  const reasons = [...actionReasons(policy, rules, change), ...ruleReasons(policy, change)];
  return { decision: strictest(reasons.map((r) => r.decision)), reasons };
}

/** Decides what to do with a request of one or more changes, including request-wide limits. */
export function evaluateChanges(policy: Policy, changes: readonly Change[]): BatchEvaluation {
  const results = changes.map((change) => evaluateChange(policy, change));
  const reasons: Reason[] = [];

  const max = policy.limits.maxChangesPerRequest;
  if (max !== undefined && changes.length > max) {
    reasons.push({
      decision: "approve",
      message: `This request has ${changes.length} changes, more than the limit of ${max}, so it needs approval.`,
    });
  }

  const decision = strictest([
    ...results.map((r) => r.decision),
    ...reasons.map((r) => r.decision),
  ]);
  return { decision, reasons, changes: results };
}

function actionReasons(policy: Policy, rules: ObjectRules | undefined, change: Change): Reason[] {
  const { object } = change;

  if (change.action === "create" || change.action === "delete") {
    const subject = `${change.action === "create" ? "Creating" : "Deleting"} ${object}`;
    const setting = rules?.[change.action];
    return [
      setting === undefined ? byDefault(policy, subject) : listed(setting, subject, undefined),
    ];
  }

  const update = rules?.update;
  if (update === undefined) {
    return [byDefault(policy, `Updating ${object}`)];
  }
  if (typeof update === "string") {
    return [listed(update, `Updating ${object}`, undefined)];
  }

  const fields = Object.keys(change.fields);
  if (fields.length === 0) {
    return [{ decision: "allow", message: `This update to ${object} changes no fields.` }];
  }
  return fields.map((field) => {
    const subject = `Changing ${object}.${field}`;
    const setting = update.allow?.includes(field)
      ? "allow"
      : update.approve?.includes(field)
        ? "approve"
        : update.deny?.includes(field)
          ? "deny"
          : undefined;
    return setting === undefined
      ? { ...byDefault(policy, subject), field }
      : listed(setting, subject, field);
  });
}

function ruleReasons(policy: Policy, change: Change): Reason[] {
  if (change.action === "delete") return [];

  const reasons: Reason[] = [];
  for (const [index, rule] of policy.rules.entries()) {
    const { object, field } = rule.when;
    if (object !== change.object || !Object.hasOwn(change.fields, field)) continue;

    const detail = matchRule(rule, change.fields[field] ?? null);
    if (detail === undefined) continue;

    const label = rule.name === undefined ? `Rule ${index + 1}` : `Rule "${rule.name}"`;
    reasons.push({
      decision: rule.decision,
      message: `${label}: ${object}.${field} is ${detail}, so this ${verb(rule.decision)}.`,
      field,
      ...(rule.name === undefined ? {} : { rule: rule.name }),
    });
  }
  return reasons;
}

/**
 * Returns a description of the value when the rule applies, or undefined when it doesn't.
 * Number comparisons on a value that isn't a number apply the rule, so unclear values
 * are never let through.
 */
function matchRule(rule: Rule, value: FieldValue): string | undefined {
  const { greaterThan, lessThan, equals } = rule.when;

  if (greaterThan !== undefined || lessThan !== undefined) {
    const number = toNumber(value);
    if (number === undefined) return `${show(value)}, which can't be compared as a number`;
    if (greaterThan !== undefined) {
      return number > greaterThan ? `${show(value)}, more than ${greaterThan}` : undefined;
    }
    if (lessThan !== undefined) {
      return number < lessThan ? `${show(value)}, less than ${lessThan}` : undefined;
    }
  }

  if (equals !== undefined && value !== null && String(value) === String(equals)) {
    return show(value);
  }
  return undefined;
}

/** CRMs often send numbers as text ("50000"), so numeric text counts as a number. */
function toNumber(value: FieldValue): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  return undefined;
}

function show(value: FieldValue): string {
  if (value === null) return "empty";
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function verb(decision: Decision): string {
  switch (decision) {
    case "allow":
      return "is allowed";
    case "approve":
      return "needs approval";
    case "deny":
      return "is blocked";
  }
}

function listed(decision: Decision, subject: string, field: string | undefined): Reason {
  return {
    decision,
    message: `${subject} ${verb(decision)}.`,
    ...(field === undefined ? {} : { field }),
  };
}

function byDefault(policy: Policy, subject: string): Reason {
  return {
    decision: policy.default,
    message: `${subject} isn't covered by the rules file, so it ${verb(policy.default)} by default.`,
  };
}
