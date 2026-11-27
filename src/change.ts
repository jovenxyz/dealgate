/** A value a CRM field can hold. `null` clears the field. */
export type FieldValue = string | number | boolean | null;

/** One write an agent wants to make to the CRM. Object and field names are the CRM's own. */
export type Change =
  | { action: "create"; object: string; fields: Record<string, FieldValue> }
  | { action: "update"; object: string; recordId: string; fields: Record<string, FieldValue> }
  | { action: "delete"; object: string; recordId: string };
