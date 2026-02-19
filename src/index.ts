/**
 * genjutsu-db — public API barrel export.
 * A TypeScript-first Google Sheets database library with zero runtime dependencies.
 */

// Client factory
export { createClient } from "./client";

// Transport
export { extractSpreadsheetId, createSpreadsheet } from "./transport";

// Error types
export {
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
} from "./errors";
export type { GenjutsuErrorKind, ValidationIssue } from "./errors";

// Types
export type {
  SheetSchema,
  InferEntity,
  FormattingRule,
  HeaderFormat,
  FieldDefinition,
  RelationDefinition,
  Repository,
  ClientConfig,
  GenjutsuClient,
  FindOptions,
  ReadOptions,
  WriteOptions,
  Migration,
  MigrationContext,
} from "./types";

// Model definition
export { defineModel, field } from "./model";
export type { FieldDef } from "./model";

// Utilities
export {
  generateId,
  isValidDate,
  normalizeDate,
  looksLikeIsoDate,
  parseAmount,
  hasIdColumn,
  findMissingHeaders,
} from "./utils";
