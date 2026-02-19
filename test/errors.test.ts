import { describe, test, expect } from "bun:test";
import {
  GenjutsuError,
  SheetsDbError,
  isGenjutsuError,
  isSheetsDbError,
  authError,
  permissionError,
  rateLimitError,
  networkError,
  validationError,
  schemaError,
  migrationError,
  apiError,
  type GenjutsuErrorKind,
  type ValidationIssue,
} from "../src/errors";

// ---------------------------------------------------------------------------
// 1. GenjutsuError creation — each of the 8 error kinds
// ---------------------------------------------------------------------------
describe("GenjutsuError creation", () => {
  const kinds: GenjutsuErrorKind[] = [
    "AUTH_ERROR",
    "PERMISSION_ERROR",
    "RATE_LIMIT",
    "NETWORK_ERROR",
    "VALIDATION_ERROR",
    "SCHEMA_ERROR",
    "MIGRATION_ERROR",
    "API_ERROR",
  ];

  for (const kind of kinds) {
    test(`creates error with kind "${kind}"`, () => {
      const err = new GenjutsuError(kind, `test ${kind}`);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(GenjutsuError);
      expect(err.kind).toBe(kind);
      expect(err.message).toBe(`test ${kind}`);
      expect(err.name).toBe("GenjutsuError");
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Error properties — kind, message, cause, retryAfterMs, etc.
// ---------------------------------------------------------------------------
describe("Error properties", () => {
  test("sets kind and message", () => {
    const err = new GenjutsuError("API_ERROR", "something broke");
    expect(err.kind).toBe("API_ERROR");
    expect(err.message).toBe("something broke");
  });

  test("sets cause when provided", () => {
    const original = new Error("root cause");
    const err = new GenjutsuError("NETWORK_ERROR", "fetch failed", {
      cause: original,
    });
    expect(err.cause).toBe(original);
  });

  test("cause is undefined when not provided", () => {
    const err = new GenjutsuError("NETWORK_ERROR", "fetch failed");
    expect(err.cause).toBeUndefined();
  });

  test("sets retryAfterMs when provided", () => {
    const err = new GenjutsuError("RATE_LIMIT", "slow down", {
      retryAfterMs: 5000,
    });
    expect(err.retryAfterMs).toBe(5000);
  });

  test("retryAfterMs is undefined when not provided", () => {
    const err = new GenjutsuError("RATE_LIMIT", "slow down");
    expect(err.retryAfterMs).toBeUndefined();
  });

  test("sets validationIssues when provided", () => {
    const issues: ValidationIssue[] = [
      { field: "name", message: "required" },
      { field: "age", message: "must be a number", value: "abc" },
    ];
    const err = new GenjutsuError("VALIDATION_ERROR", "invalid input", {
      validationIssues: issues,
    });
    expect(err.validationIssues).toEqual(issues);
    expect(err.validationIssues).toHaveLength(2);
    expect(err.validationIssues![1].value).toBe("abc");
  });

  test("validationIssues is undefined when not provided", () => {
    const err = new GenjutsuError("VALIDATION_ERROR", "invalid");
    expect(err.validationIssues).toBeUndefined();
  });

  test("sets migrationVersion and migrationName when provided", () => {
    const err = new GenjutsuError("MIGRATION_ERROR", "migration failed", {
      migrationVersion: 3,
      migrationName: "add_users_table",
    });
    expect(err.migrationVersion).toBe(3);
    expect(err.migrationName).toBe("add_users_table");
  });

  test("migrationVersion and migrationName are undefined when not provided", () => {
    const err = new GenjutsuError("MIGRATION_ERROR", "migration failed");
    expect(err.migrationVersion).toBeUndefined();
    expect(err.migrationName).toBeUndefined();
  });

  test("sets all optional properties simultaneously", () => {
    const cause = new Error("original");
    const issues: ValidationIssue[] = [{ field: "x", message: "bad" }];
    const err = new GenjutsuError("API_ERROR", "everything at once", {
      cause,
      retryAfterMs: 1000,
      validationIssues: issues,
      migrationVersion: 7,
      migrationName: "big_migration",
    });
    expect(err.cause).toBe(cause);
    expect(err.retryAfterMs).toBe(1000);
    expect(err.validationIssues).toEqual(issues);
    expect(err.migrationVersion).toBe(7);
    expect(err.migrationName).toBe("big_migration");
  });

  test("name property is always 'GenjutsuError'", () => {
    const err = new GenjutsuError("AUTH_ERROR", "no token");
    expect(err.name).toBe("GenjutsuError");
  });

  test("inherits from Error", () => {
    const err = new GenjutsuError("AUTH_ERROR", "no token");
    expect(err).toBeInstanceOf(Error);
    expect(err.stack).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 3. isGenjutsuError type guard
// ---------------------------------------------------------------------------
describe("isGenjutsuError", () => {
  test("returns true for a GenjutsuError instance", () => {
    const err = new GenjutsuError("AUTH_ERROR", "expired");
    expect(isGenjutsuError(err)).toBe(true);
  });

  test("returns true for errors created via factory functions", () => {
    expect(isGenjutsuError(authError("test"))).toBe(true);
    expect(isGenjutsuError(apiError("test"))).toBe(true);
  });

  test("returns false for a regular Error", () => {
    const err = new Error("plain error");
    expect(isGenjutsuError(err)).toBe(false);
  });

  test("returns false for a string", () => {
    expect(isGenjutsuError("error string")).toBe(false);
  });

  test("returns false for null", () => {
    expect(isGenjutsuError(null)).toBe(false);
  });

  test("returns false for undefined", () => {
    expect(isGenjutsuError(undefined)).toBe(false);
  });

  test("returns false for a number", () => {
    expect(isGenjutsuError(42)).toBe(false);
  });

  test("returns false for a plain object with similar shape", () => {
    const fake = {
      kind: "AUTH_ERROR",
      message: "fake",
      name: "GenjutsuError",
    };
    expect(isGenjutsuError(fake)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Deprecated SheetsDbError alias
// ---------------------------------------------------------------------------
describe("SheetsDbError (deprecated alias)", () => {
  test("SheetsDbError is the same class as GenjutsuError", () => {
    expect(SheetsDbError).toBe(GenjutsuError);
  });

  test("instance created with SheetsDbError is a GenjutsuError", () => {
    const err = new SheetsDbError("API_ERROR", "old alias");
    expect(err).toBeInstanceOf(GenjutsuError);
    expect(err.kind).toBe("API_ERROR");
    expect(err.name).toBe("GenjutsuError");
  });

  test("isGenjutsuError recognizes SheetsDbError instances", () => {
    const err = new SheetsDbError("NETWORK_ERROR", "connection lost");
    expect(isGenjutsuError(err)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Deprecated isSheetsDbError alias
// ---------------------------------------------------------------------------
describe("isSheetsDbError (deprecated alias)", () => {
  test("isSheetsDbError is the same function as isGenjutsuError", () => {
    expect(isSheetsDbError).toBe(isGenjutsuError);
  });

  test("returns true for GenjutsuError", () => {
    const err = new GenjutsuError("AUTH_ERROR", "test");
    expect(isSheetsDbError(err)).toBe(true);
  });

  test("returns false for regular Error", () => {
    expect(isSheetsDbError(new Error("plain"))).toBe(false);
  });

  test("returns false for non-errors", () => {
    expect(isSheetsDbError(null)).toBe(false);
    expect(isSheetsDbError("string")).toBe(false);
    expect(isSheetsDbError(123)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Factory functions
// ---------------------------------------------------------------------------
describe("authError()", () => {
  test("returns GenjutsuError with AUTH_ERROR kind", () => {
    const err = authError("token expired");
    expect(err).toBeInstanceOf(GenjutsuError);
    expect(err.kind).toBe("AUTH_ERROR");
    expect(err.message).toBe("token expired");
  });

  test("includes cause when provided", () => {
    const cause = new Error("oauth failure");
    const err = authError("auth failed", cause);
    expect(err.cause).toBe(cause);
  });

  test("cause is undefined when omitted", () => {
    const err = authError("no token");
    expect(err.cause).toBeUndefined();
  });
});

describe("permissionError()", () => {
  test("returns GenjutsuError with PERMISSION_ERROR kind", () => {
    const err = permissionError("access denied");
    expect(err).toBeInstanceOf(GenjutsuError);
    expect(err.kind).toBe("PERMISSION_ERROR");
    expect(err.message).toBe("access denied");
  });

  test("includes cause when provided", () => {
    const cause = new Error("forbidden");
    const err = permissionError("no access", cause);
    expect(err.cause).toBe(cause);
  });

  test("cause is undefined when omitted", () => {
    const err = permissionError("denied");
    expect(err.cause).toBeUndefined();
  });
});

describe("rateLimitError()", () => {
  test("returns GenjutsuError with RATE_LIMIT kind", () => {
    const err = rateLimitError("too many requests");
    expect(err).toBeInstanceOf(GenjutsuError);
    expect(err.kind).toBe("RATE_LIMIT");
    expect(err.message).toBe("too many requests");
  });

  test("includes retryAfterMs when provided", () => {
    const err = rateLimitError("slow down", 3000);
    expect(err.retryAfterMs).toBe(3000);
  });

  test("retryAfterMs is undefined when omitted", () => {
    const err = rateLimitError("slow down");
    expect(err.retryAfterMs).toBeUndefined();
  });

  test("includes cause when provided", () => {
    const cause = new Error("429");
    const err = rateLimitError("rate limited", 5000, cause);
    expect(err.cause).toBe(cause);
    expect(err.retryAfterMs).toBe(5000);
  });

  test("cause is undefined when omitted", () => {
    const err = rateLimitError("rate limited", 1000);
    expect(err.cause).toBeUndefined();
  });
});

describe("networkError()", () => {
  test("returns GenjutsuError with NETWORK_ERROR kind", () => {
    const err = networkError("connection refused");
    expect(err).toBeInstanceOf(GenjutsuError);
    expect(err.kind).toBe("NETWORK_ERROR");
    expect(err.message).toBe("connection refused");
  });

  test("includes cause when provided", () => {
    const cause = new TypeError("Failed to fetch");
    const err = networkError("network down", cause);
    expect(err.cause).toBe(cause);
  });

  test("cause is undefined when omitted", () => {
    const err = networkError("timeout");
    expect(err.cause).toBeUndefined();
  });
});

describe("validationError()", () => {
  test("returns GenjutsuError with VALIDATION_ERROR kind", () => {
    const issues: ValidationIssue[] = [
      { field: "email", message: "invalid format" },
    ];
    const err = validationError("validation failed", issues);
    expect(err).toBeInstanceOf(GenjutsuError);
    expect(err.kind).toBe("VALIDATION_ERROR");
    expect(err.message).toBe("validation failed");
  });

  test("includes validation issues", () => {
    const issues: ValidationIssue[] = [
      { field: "name", message: "required" },
      { field: "age", message: "must be positive", value: -1 },
    ];
    const err = validationError("bad data", issues);
    expect(err.validationIssues).toEqual(issues);
    expect(err.validationIssues).toHaveLength(2);
  });

  test("works with empty issues array", () => {
    const err = validationError("no specific issues", []);
    expect(err.validationIssues).toEqual([]);
    expect(err.validationIssues).toHaveLength(0);
  });

  test("does not set cause", () => {
    const err = validationError("invalid", [{ field: "x", message: "bad" }]);
    expect(err.cause).toBeUndefined();
  });
});

describe("schemaError()", () => {
  test("returns GenjutsuError with SCHEMA_ERROR kind", () => {
    const err = schemaError("schema mismatch");
    expect(err).toBeInstanceOf(GenjutsuError);
    expect(err.kind).toBe("SCHEMA_ERROR");
    expect(err.message).toBe("schema mismatch");
  });

  test("includes cause when provided", () => {
    const cause = new Error("missing column");
    const err = schemaError("bad schema", cause);
    expect(err.cause).toBe(cause);
  });

  test("cause is undefined when omitted", () => {
    const err = schemaError("schema drift");
    expect(err.cause).toBeUndefined();
  });
});

describe("migrationError()", () => {
  test("returns GenjutsuError with MIGRATION_ERROR kind", () => {
    const err = migrationError("migration failed", 5, "add_index");
    expect(err).toBeInstanceOf(GenjutsuError);
    expect(err.kind).toBe("MIGRATION_ERROR");
    expect(err.message).toBe("migration failed");
  });

  test("sets migrationVersion and migrationName", () => {
    const err = migrationError("could not apply", 12, "rename_column");
    expect(err.migrationVersion).toBe(12);
    expect(err.migrationName).toBe("rename_column");
  });

  test("includes cause when provided", () => {
    const cause = new Error("SQL error");
    const err = migrationError("rollback needed", 1, "init", cause);
    expect(err.cause).toBe(cause);
  });

  test("cause is undefined when omitted", () => {
    const err = migrationError("failed", 2, "add_table");
    expect(err.cause).toBeUndefined();
  });

  test("works with version 0", () => {
    const err = migrationError("initial setup failed", 0, "init");
    expect(err.migrationVersion).toBe(0);
  });
});

describe("apiError()", () => {
  test("returns GenjutsuError with API_ERROR kind", () => {
    const err = apiError("unexpected response");
    expect(err).toBeInstanceOf(GenjutsuError);
    expect(err.kind).toBe("API_ERROR");
    expect(err.message).toBe("unexpected response");
  });

  test("includes cause when provided", () => {
    const cause = { status: 500, body: "Internal Server Error" };
    const err = apiError("server error", cause);
    expect(err.cause).toBe(cause);
  });

  test("cause is undefined when omitted", () => {
    const err = apiError("bad response");
    expect(err.cause).toBeUndefined();
  });
});
