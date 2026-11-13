export type LocatorKind = "css" | "xpath" | "role";

export interface LocatorSpecV1 {
  kind: LocatorKind;
  selector?: string;
  role?: string;
  name?: string;
  exact?: boolean;
  includeHidden?: boolean;
  framePath?: string[];
  index?: number | null;
}

const KNOWN_KEYS: ReadonlySet<string> = new Set<string>([
  "kind",
  "selector",
  "role",
  "name",
  "exact",
  "includeHidden",
  "framePath",
  "index",
]);

const CSS_XPATH_ALLOWED_KEYS: ReadonlySet<string> = new Set<string>([
  "kind",
  "selector",
  "framePath",
  "index",
]);

const ROLE_ALLOWED_KEYS: ReadonlySet<string> = new Set<string>([
  "kind",
  "role",
  "name",
  "exact",
  "includeHidden",
  "framePath",
  "index",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function validateLocatorSpec(spec: unknown): string[] {
  const errors: string[] = [];

  if (!isPlainObject(spec)) {
    return ["spec must be a plain object"];
  }

  for (const key of Object.keys(spec)) {
    if (!KNOWN_KEYS.has(key)) {
      errors.push(`unknown key: ${key}`);
    }
  }

  const kind = spec["kind"];
  if (kind !== "css" && kind !== "xpath" && kind !== "role") {
    errors.push('kind must be one of "css", "xpath", "role"');
  }

  if (kind === "css" || kind === "xpath") {
    if (!isNonEmptyString(spec["selector"])) {
      errors.push(`selector must be a non-empty string when kind is "${kind}"`);
    }
    for (const key of Object.keys(spec)) {
      if (!CSS_XPATH_ALLOWED_KEYS.has(key)) {
        errors.push(`"${key}" is not allowed when kind is "${kind}"`);
      }
    }
  }

  if (kind === "role") {
    if (!isNonEmptyString(spec["role"])) {
      errors.push('role must be a non-empty string when kind is "role"');
    }
    for (const key of Object.keys(spec)) {
      if (!ROLE_ALLOWED_KEYS.has(key)) {
        errors.push(`"${key}" is not allowed when kind is "role"`);
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(spec, "name")) {
    if (!isNonEmptyString(spec["name"])) {
      errors.push("name must be a non-empty string if present");
    }
  }

  if (Object.prototype.hasOwnProperty.call(spec, "exact")) {
    if (typeof spec["exact"] !== "boolean") {
      errors.push("exact must be a boolean if present");
    }
  }

  if (Object.prototype.hasOwnProperty.call(spec, "includeHidden")) {
    if (typeof spec["includeHidden"] !== "boolean") {
      errors.push("includeHidden must be a boolean if present");
    }
  }

  if (Object.prototype.hasOwnProperty.call(spec, "framePath")) {
    const framePath = spec["framePath"];
    if (!Array.isArray(framePath)) {
      errors.push("framePath must be an array of 0-2 non-empty strings");
    } else {
      if (framePath.length > 2) {
        errors.push("framePath must contain at most 2 entries");
      }
      for (let i = 0; i < framePath.length; i += 1) {
        if (!isNonEmptyString(framePath[i])) {
          errors.push(`framePath[${i}] must be a non-empty string`);
        }
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(spec, "index")) {
    const index = spec["index"];
    if (index !== null && index !== undefined) {
      if (!isNonNegativeInteger(index)) {
        errors.push("index must be null/undefined or a non-negative integer");
      }
    }
  }

  return errors;
}

export function parseLocatorSpec(spec: unknown): LocatorSpecV1 {
  const errors = validateLocatorSpec(spec);
  if (errors.length > 0) {
    throw new Error(`Invalid LocatorSpecV1: ${errors.join("; ")}`);
  }
  return spec as LocatorSpecV1;
}

export function normalizeLocatorSpec(spec: LocatorSpecV1): LocatorSpecV1 {
  const normalized: LocatorSpecV1 = {
    kind: spec.kind,
  };
  if (spec.selector !== undefined) {
    normalized.selector = spec.selector;
  }
  if (spec.role !== undefined) {
    normalized.role = spec.role;
  }
  if (spec.name !== undefined) {
    normalized.name = spec.name;
  }
  normalized.exact = spec.exact ?? false;
  normalized.includeHidden = spec.includeHidden ?? false;
  normalized.framePath = spec.framePath !== undefined ? [...spec.framePath] : [];
  normalized.index = spec.index ?? null;
  return normalized;
}
