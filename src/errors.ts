/**
 * Typed error handling for the genjutsu-db library.
 */

export type GenjutsuErrorKind =
  | "AUTH_ERROR"
  | "PERMISSION_ERROR"
  | "RATE_LIMIT"
  | "NETWORK_ERROR"
  | "VALIDATION_ERROR"
  | "SCHEMA_ERROR"
  | "MIGRATION_ERROR"
  | "API_ERROR";

export interface ValidationIssue {
  field: string;
  message: string;
  value?: unknown;
}

export class GenjutsuError extends Error {
  readonly kind: GenjutsuErrorKind;
  readonly cause?: unknown;
  readonly retryAfterMs?: number;
  readonly validationIssues?: ValidationIssue[];
  readonly migrationVersion?: number;
  readonly migrationName?: string;

  constructor(
    kind: GenjutsuErrorKind,
    message: string,
    options?: {
      cause?: unknown;
      retryAfterMs?: number;
      validationIssues?: ValidationIssue[];
      migrationVersion?: number;
      migrationName?: string;
    },
  ) {
    super(message);
    this.name = "GenjutsuError";
    this.kind = kind;
    this.cause = options?.cause;
    this.retryAfterMs = options?.retryAfterMs;
    this.validationIssues = options?.validationIssues;
    this.migrationVersion = options?.migrationVersion;
    this.migrationName = options?.migrationName;
  }
}

/** @deprecated Use GenjutsuError instead */
export const SheetsDbError = GenjutsuError;

export function isGenjutsuError(err: unknown): err is GenjutsuError {
  return err instanceof GenjutsuError;
}

/** @deprecated Use isGenjutsuError instead */
export const isSheetsDbError = isGenjutsuError;

export function authError(message: string, cause?: unknown): GenjutsuError {
  return new GenjutsuError("AUTH_ERROR", message, { cause });
}

export function permissionError(message: string, cause?: unknown): GenjutsuError {
  return new GenjutsuError("PERMISSION_ERROR", message, { cause });
}

export function rateLimitError(
  message: string,
  retryAfterMs?: number,
  cause?: unknown,
): GenjutsuError {
  return new GenjutsuError("RATE_LIMIT", message, { cause, retryAfterMs });
}

export function networkError(message: string, cause?: unknown): GenjutsuError {
  return new GenjutsuError("NETWORK_ERROR", message, { cause });
}

export function validationError(
  message: string,
  issues: ValidationIssue[],
): GenjutsuError {
  return new GenjutsuError("VALIDATION_ERROR", message, {
    validationIssues: issues,
  });
}

export function schemaError(message: string, cause?: unknown): GenjutsuError {
  return new GenjutsuError("SCHEMA_ERROR", message, { cause });
}

export function migrationError(
  message: string,
  version: number,
  name: string,
  cause?: unknown,
): GenjutsuError {
  return new GenjutsuError("MIGRATION_ERROR", message, {
    cause,
    migrationVersion: version,
    migrationName: name,
  });
}

export function apiError(message: string, cause?: unknown): GenjutsuError {
  return new GenjutsuError("API_ERROR", message, { cause });
}
