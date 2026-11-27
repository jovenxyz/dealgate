import { readFile } from "node:fs/promises";
import { parse, YAMLError } from "yaml";
import type { core } from "zod";
import { type Policy, policySchema } from "./schema.js";

/** The rules file couldn't be read as valid YAML, or doesn't match the expected format. */
export class PolicyError extends Error {
  override readonly name = "PolicyError";
  /** Where the rules came from, usually a file path. */
  readonly source: string;
  /** One readable line per problem, each starting with where in the file it is. */
  readonly problems: readonly string[];

  constructor(source: string, problems: readonly string[]) {
    super(`Invalid rules file ${source}:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.source = source;
    this.problems = problems;
  }
}

/** Reads and validates a rules file from YAML text. Throws `PolicyError` on any problem. */
export function parsePolicy(text: string, source = "dealgate.yaml"): Policy {
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    if (error instanceof YAMLError) {
      // The first line of the message says what's wrong and where; the rest is a code excerpt.
      throw new PolicyError(source, [error.message.split("\n")[0] ?? error.message]);
    }
    throw error;
  }

  if (data === null || data === undefined) {
    throw new PolicyError(source, ["the file is empty"]);
  }

  const result = policySchema.safeParse(data);
  if (!result.success) {
    throw new PolicyError(source, result.error.issues.map(formatIssue));
  }
  return result.data;
}

/** Reads and validates a rules file from disk. Throws `PolicyError` on any problem. */
export async function loadPolicy(path: string): Promise<Policy> {
  return parsePolicy(await readFile(path, "utf8"), path);
}

function formatIssue(issue: core.$ZodIssue): string {
  const where = formatPath(issue.path);
  if (issue.code === "unrecognized_keys") {
    const keys = issue.keys.map((key) => `"${key}"`).join(", ");
    return `${where}: unknown ${issue.keys.length === 1 ? "key" : "keys"} ${keys}`;
  }
  return `${where}: ${issue.message}`;
}

/** Turns ["objects", "deals", "update", "allow", 0] into "objects.deals.update.allow[0]". */
function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const key of path) {
    if (typeof key === "number") {
      out += `[${key}]`;
    } else {
      out += out === "" ? String(key) : `.${String(key)}`;
    }
  }
  return out === "" ? "top level" : out;
}
