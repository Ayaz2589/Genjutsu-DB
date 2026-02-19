import { describe, test, expect } from "bun:test";
import {
  generateId,
  isValidDate,
  normalizeDate,
  parseAmount,
  findMissingHeaders,
  looksLikeIsoDate,
  hasIdColumn,
} from "../src/utils";

describe("generateId", () => {
  test("returns a string", () => {
    const id = generateId();
    expect(typeof id).toBe("string");
  });

  test("contains a timestamp", () => {
    const before = Date.now();
    const id = generateId();
    const after = Date.now();
    const timestamp = parseInt(id.split("-")[0], 10);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });

  test("generates unique values across calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe("isValidDate", () => {
  test("returns true for YYYY-MM-DD format", () => {
    expect(isValidDate("2024-01-15")).toBe(true);
    expect(isValidDate("1999-12-31")).toBe(true);
    expect(isValidDate("2000-01-01")).toBe(true);
  });

  test("returns false for invalid formats", () => {
    expect(isValidDate("01-15-2024")).toBe(false);
    expect(isValidDate("2024/01/15")).toBe(false);
    expect(isValidDate("Jan 15, 2024")).toBe(false);
    expect(isValidDate("20240115")).toBe(false);
    expect(isValidDate("2024-1-5")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isValidDate("")).toBe(false);
  });
});

describe("normalizeDate", () => {
  test("returns null for null", () => {
    expect(normalizeDate(null)).toBeNull();
  });

  test("returns null for undefined", () => {
    expect(normalizeDate(undefined)).toBeNull();
  });

  test("returns ISO string for valid YYYY-MM-DD date", () => {
    expect(normalizeDate("2024-01-15")).toBe("2024-01-15");
    expect(normalizeDate("2000-06-30")).toBe("2000-06-30");
  });

  test("trims whitespace from valid dates", () => {
    expect(normalizeDate("  2024-01-15  ")).toBe("2024-01-15");
  });

  test("handles serial date numbers (Excel-style)", () => {
    // Serial number 45306 corresponds to 2024-01-15 in the Excel epoch
    const result = normalizeDate("45306");
    expect(result).not.toBeNull();
    expect(isValidDate(result!)).toBe(true);
  });

  test("handles numeric values passed as numbers", () => {
    const result = normalizeDate(45306);
    expect(result).not.toBeNull();
    expect(isValidDate(result!)).toBe(true);
  });

  test("returns null for invalid strings", () => {
    expect(normalizeDate("not-a-date")).toBeNull();
    expect(normalizeDate("hello")).toBeNull();
    expect(normalizeDate("abc123")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(normalizeDate("")).toBeNull();
  });
});

describe("parseAmount", () => {
  test("returns number for number input", () => {
    expect(parseAmount(42)).toBe(42);
    expect(parseAmount(3.14)).toBe(3.14);
    expect(parseAmount(0)).toBe(0);
  });

  test("parses currency string '$1,234.56' to 1234.56", () => {
    expect(parseAmount("$1,234.56")).toBe(1234.56);
  });

  test("parses string numbers", () => {
    expect(parseAmount("100")).toBe(100);
    expect(parseAmount("99.99")).toBe(99.99);
  });

  test("returns null for non-numeric strings", () => {
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("not a number")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });

  test("returns null for NaN number input", () => {
    expect(parseAmount(NaN)).toBeNull();
  });

  test("handles negative values", () => {
    expect(parseAmount(-50)).toBe(-50);
    expect(parseAmount("-25.75")).toBe(-25.75);
  });

  test("strips dollar signs and commas", () => {
    expect(parseAmount("$500")).toBe(500);
    expect(parseAmount("1,000")).toBe(1000);
    expect(parseAmount("$10,000.50")).toBe(10000.5);
  });

  test("returns null for null/undefined input", () => {
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
  });
});

describe("findMissingHeaders", () => {
  test("returns missing headers", () => {
    const actual = ["name", "age"];
    const required = ["name", "age", "email"];
    expect(findMissingHeaders(actual, required)).toEqual(["email"]);
  });

  test("is case-insensitive", () => {
    const actual = ["Name", "AGE", "Email"];
    const required = ["name", "age", "email"];
    expect(findMissingHeaders(actual, required)).toEqual([]);
  });

  test("returns empty array when all headers are present", () => {
    const actual = ["name", "age", "email"];
    const required = ["name", "age", "email"];
    expect(findMissingHeaders(actual, required)).toEqual([]);
  });

  test("returns all required headers when none are present", () => {
    const actual = ["foo", "bar"];
    const required = ["name", "age"];
    expect(findMissingHeaders(actual, required)).toEqual(["name", "age"]);
  });

  test("trims whitespace from actual headers", () => {
    const actual = ["  name  ", " age "];
    const required = ["name", "age"];
    expect(findMissingHeaders(actual, required)).toEqual([]);
  });
});

describe("looksLikeIsoDate", () => {
  test("returns true for '2024-01-15'", () => {
    expect(looksLikeIsoDate("2024-01-15")).toBe(true);
  });

  test("returns true for date with surrounding whitespace", () => {
    expect(looksLikeIsoDate("  2024-01-15  ")).toBe(true);
  });

  test("returns false for non-date strings", () => {
    expect(looksLikeIsoDate("hello")).toBe(false);
    expect(looksLikeIsoDate("12345")).toBe(false);
    expect(looksLikeIsoDate("01/15/2024")).toBe(false);
    expect(looksLikeIsoDate("")).toBe(false);
  });
});

describe("hasIdColumn", () => {
  test("returns true when first cell is non-empty and not a date", () => {
    const row = ["abc123", "some data", "more data"];
    expect(hasIdColumn(row, 2, looksLikeIsoDate)).toBe(true);
  });

  test("returns false when first cell looks like a date", () => {
    const row = ["2024-01-15", "some data", "more data"];
    expect(hasIdColumn(row, 2, looksLikeIsoDate)).toBe(false);
  });

  test("returns false when first cell is empty", () => {
    const row = ["", "some data", "more data"];
    expect(hasIdColumn(row, 2, looksLikeIsoDate)).toBe(false);
  });

  test("returns false when row length is less than minLength", () => {
    const row = ["abc123"];
    expect(hasIdColumn(row, 3, looksLikeIsoDate)).toBe(false);
  });

  test("trims whitespace from first cell", () => {
    const row = ["  abc123  ", "data"];
    expect(hasIdColumn(row, 2, looksLikeIsoDate)).toBe(true);
  });

  test("handles null/undefined first cell", () => {
    const row = [null, "data", "more"];
    expect(hasIdColumn(row as unknown[], 2, looksLikeIsoDate)).toBe(false);
  });
});
