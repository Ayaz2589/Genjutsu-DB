/**
 * Generic utility functions for the genjutsu-db library.
 * Domain-agnostic helpers for date parsing, amount parsing,
 * header validation, ID generation, and row detection.
 */

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(date: string): boolean {
  return ISO_DATE_PATTERN.test(date);
}

function serialToIsoDate(serial: number): string {
  const epoch = new Date(1899, 11, 30).getTime();
  const ms = serial * 86400000 + epoch;
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function tryRepairDate(value: string): string | null {
  if (ISO_DATE_PATTERN.test(value.trim())) return value.trim();
  const num = parseFloat(value.replace(/[$,\s]/g, ""));
  if (!Number.isNaN(num) && num > 0 && num < 1000000) {
    return serialToIsoDate(num);
  }
  return null;
}

export function normalizeDate(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (ISO_DATE_PATTERN.test(s)) return s;
  return tryRepairDate(s);
}

export function looksLikeIsoDate(value: string): boolean {
  return ISO_DATE_PATTERN.test(value.trim());
}

export function parseAmount(value: unknown): number | null {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  const s = String(value ?? "").replace(/[$,\s]/g, "");
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

export function hasIdColumn(
  row: unknown[],
  minLength: number,
  looksLikeDate: (v: string) => boolean,
): boolean {
  const first = String(row[0] ?? "").trim();
  return row.length >= minLength && first.length > 0 && !looksLikeDate(first);
}

export function findMissingHeaders(
  actualHeaders: string[],
  requiredHeaders: string[],
): string[] {
  const normalized = new Set(actualHeaders.map((h) => h.trim().toLowerCase()));
  return requiredHeaders.filter((h) => !normalized.has(h.toLowerCase()));
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
