/**
 * Relations module for the genjutsu-db library.
 * Provides FK validation on write and eager loading via include.
 */

import type { SheetSchema, RelationDefinition } from "./types";
import type { TransportContext } from "./transport";
import { getSheetValues, batchGetValues } from "./transport";
import { validationError } from "./errors";

/**
 * Validate foreign key references for a record before write.
 * Reads the target model's sheet and checks if the referenced record exists.
 */
export async function validateForeignKeys<T>(
  record: T,
  schema: SheetSchema<T>,
  allSchemas: Record<string, SheetSchema<any>>,
  ctx: TransportContext,
  changedFields?: Set<string>,
): Promise<void> {
  if (!schema.relations || schema.relations.length === 0) return;

  for (const relation of schema.relations) {
    // If changedFields is provided (for update), only validate changed FK fields
    if (changedFields && !changedFields.has(relation.sourceField)) continue;

    const fkValue = (record as Record<string, unknown>)[relation.sourceField];
    if (fkValue === null || fkValue === undefined) continue;

    // Find the target schema by model key
    const targetSchema = allSchemas[relation.targetModel];
    if (!targetSchema) continue; // Should have been caught at registration time

    // Read target model's data
    const rows = await getSheetValues(ctx, targetSchema.readRange, "UNFORMATTED_VALUE");
    const targetPk = targetSchema.primaryKey ?? relation.targetField;

    // Find the PK column index
    const pkIndex = targetSchema.headers.indexOf(targetPk);
    if (pkIndex === -1) continue;

    // Check if the referenced record exists
    const exists = rows.some((row) => {
      const cellValue = row[pkIndex];
      return cellValue !== undefined && cellValue !== null && String(cellValue) === String(fkValue);
    });

    if (!exists) {
      throw validationError(
        `Foreign key validation failed: ${relation.sourceField} references ${relation.targetModel}.${relation.targetField} but value "${String(fkValue)}" not found`,
        [
          {
            field: relation.sourceField,
            message: `Referenced ${relation.targetModel}.${relation.targetField} "${String(fkValue)}" not found`,
            value: fkValue,
          },
        ],
      );
    }
  }
}

/**
 * Load related records for a set of parent records using batchGet.
 * Attaches related records as arrays on each parent by matching FK values.
 */
export async function loadRelated<T>(
  records: T[],
  schema: SheetSchema<T>,
  includeMap: Record<string, true>,
  allSchemas: Record<string, SheetSchema<any>>,
  ctx: TransportContext,
): Promise<T[]> {
  if (!includeMap || Object.keys(includeMap).length === 0) return records;

  // Find all related schemas that should be loaded
  const relatedRanges: string[] = [];
  const relatedSchemaKeys: string[] = [];

  for (const includeKey of Object.keys(includeMap)) {
    const relatedSchema = allSchemas[includeKey];
    if (!relatedSchema) continue;
    relatedRanges.push(relatedSchema.readRange);
    relatedSchemaKeys.push(includeKey);
  }

  if (relatedRanges.length === 0) return records;

  // Use batchGet for all related schemas at once
  const batchResult = await batchGetValues(ctx, relatedRanges, "UNFORMATTED_VALUE");

  // For each related schema, find the relation pointing to the current schema
  const pk = schema.primaryKey;
  if (!pk) return records;

  // Build a map of parent PK values to their records for fast lookup
  const enhancedRecords = records.map((r) => ({ ...r } as Record<string, unknown>));

  for (let i = 0; i < relatedSchemaKeys.length; i++) {
    const relatedKey = relatedSchemaKeys[i];
    const relatedSchema = allSchemas[relatedKey];

    // Find the relation in the related schema that points to the current model
    const relation = findRelationToModel(relatedSchema, allSchemas, schema);

    // Parse the related rows
    const range = relatedRanges[i];
    const rows = batchResult.get(range) ?? [];
    const relatedRecords: Record<string, unknown>[] = [];

    for (let j = 0; j < rows.length; j++) {
      const entity = relatedSchema.parseRow(rows[j], j);
      if (entity != null) relatedRecords.push(entity as Record<string, unknown>);
    }

    // Attach related records to each parent
    for (const parent of enhancedRecords) {
      const parentPk = parent[pk];
      if (relation) {
        parent[relatedKey] = relatedRecords.filter(
          (child) => String(child[relation.sourceField]) === String(parentPk),
        );
      } else {
        parent[relatedKey] = [];
      }
    }
  }

  return enhancedRecords as T[];
}

/**
 * Find a relation in the related schema that points back to the current model.
 */
function findRelationToModel(
  relatedSchema: SheetSchema<any>,
  allSchemas: Record<string, SheetSchema<any>>,
  targetSchema: SheetSchema<any>,
): RelationDefinition | undefined {
  if (!relatedSchema.relations) return undefined;

  // Find which key in allSchemas corresponds to targetSchema
  const targetKey = Object.entries(allSchemas).find(
    ([, s]) => s.sheetName === targetSchema.sheetName,
  )?.[0];
  if (!targetKey) return undefined;

  return relatedSchema.relations.find(
    (r) => r.targetModel === targetKey,
  );
}
