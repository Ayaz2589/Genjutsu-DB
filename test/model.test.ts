import { describe, test, expect } from "bun:test";
import { field, defineModel } from "../src/model";
import { GenjutsuError } from "../src/errors";

// ---------------------------------------------------------------------------
// T021: Field Builder Tests
// ---------------------------------------------------------------------------
describe("field builder", () => {
  // -------------------------------------------------------------------------
  // 1. field.string() returns FieldDef with type "string"
  // -------------------------------------------------------------------------
  test('field.string() returns FieldDef with type "string"', () => {
    const f = field.string();
    expect(f._type).toBe("string");
    expect(f._isPrimaryKey).toBe(false);
    expect(f._isOptional).toBe(false);
    expect(f._defaultValue).toBeUndefined();
    expect(f._references).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 2. field.number() returns FieldDef with type "number"
  // -------------------------------------------------------------------------
  test('field.number() returns FieldDef with type "number"', () => {
    const f = field.number();
    expect(f._type).toBe("number");
    expect(f._isPrimaryKey).toBe(false);
    expect(f._isOptional).toBe(false);
    expect(f._defaultValue).toBeUndefined();
    expect(f._references).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 3. field.date() returns FieldDef with type "date"
  // -------------------------------------------------------------------------
  test('field.date() returns FieldDef with type "date"', () => {
    const f = field.date();
    expect(f._type).toBe("date");
    expect(f._isPrimaryKey).toBe(false);
    expect(f._isOptional).toBe(false);
    expect(f._defaultValue).toBeUndefined();
    expect(f._references).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 4. field.boolean() returns FieldDef with type "boolean"
  // -------------------------------------------------------------------------
  test('field.boolean() returns FieldDef with type "boolean"', () => {
    const f = field.boolean();
    expect(f._type).toBe("boolean");
    expect(f._isPrimaryKey).toBe(false);
    expect(f._isOptional).toBe(false);
    expect(f._defaultValue).toBeUndefined();
    expect(f._references).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 5. .primaryKey() sets isPrimaryKey to true
  // -------------------------------------------------------------------------
  test(".primaryKey() sets isPrimaryKey to true", () => {
    const f = field.string().primaryKey();
    expect(f._isPrimaryKey).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 6. .optional() sets isOptional to true
  // -------------------------------------------------------------------------
  test(".optional() sets isOptional to true", () => {
    const f = field.string().optional();
    expect(f._isOptional).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 7. .default(value) stores defaultValue
  // -------------------------------------------------------------------------
  test(".default(value) stores defaultValue", () => {
    const f = field.number().default(42);
    expect(f._defaultValue).toBe(42);
  });

  test(".default(value) stores string defaultValue", () => {
    const f = field.string().default("hello");
    expect(f._defaultValue).toBe("hello");
  });

  test(".default(value) stores boolean defaultValue", () => {
    const f = field.boolean().default(false);
    expect(f._defaultValue).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 8. .references(model, field) stores references object
  // -------------------------------------------------------------------------
  test(".references(model, field) stores references object", () => {
    const f = field.string().references("Users", "id");
    expect(f._references).toEqual({ model: "Users", field: "id" });
  });

  // -------------------------------------------------------------------------
  // 9. Methods are chainable
  // -------------------------------------------------------------------------
  test("methods are chainable", () => {
    const f = field
      .string()
      .primaryKey()
      .optional()
      .default("auto")
      .references("Other", "pk");

    expect(f._type).toBe("string");
    expect(f._isPrimaryKey).toBe(true);
    expect(f._isOptional).toBe(true);
    expect(f._defaultValue).toBe("auto");
    expect(f._references).toEqual({ model: "Other", field: "pk" });
  });

  test("chaining order does not matter", () => {
    const f = field
      .number()
      .optional()
      .default(0)
      .primaryKey();

    expect(f._type).toBe("number");
    expect(f._isPrimaryKey).toBe(true);
    expect(f._isOptional).toBe(true);
    expect(f._defaultValue).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T022: defineModel Tests
// ---------------------------------------------------------------------------
describe("defineModel", () => {
  // Helper: minimal 3-field model for reuse
  function createTestModel() {
    return defineModel("Tasks", {
      id: field.string().primaryKey(),
      title: field.string(),
      done: field.boolean(),
    });
  }

  // -------------------------------------------------------------------------
  // 1. Generates correct headers from field names
  // -------------------------------------------------------------------------
  test("generates correct headers from field names", () => {
    const schema = createTestModel();
    expect(schema.headers).toEqual(["id", "title", "done"]);
  });

  test("headers preserve field declaration order", () => {
    const schema = defineModel("Items", {
      sku: field.string().primaryKey(),
      name: field.string(),
      price: field.number(),
      inStock: field.boolean(),
      createdAt: field.date(),
    });
    expect(schema.headers).toEqual(["sku", "name", "price", "inStock", "createdAt"]);
  });

  // -------------------------------------------------------------------------
  // 2. Generates correct readRange / writeRange / clearRange
  // -------------------------------------------------------------------------
  test("generates correct ranges for 3 fields (column C)", () => {
    const schema = createTestModel();
    expect(schema.sheetName).toBe("Tasks");
    expect(schema.readRange).toBe("Tasks!A2:C");
    expect(schema.writeRange).toBe("Tasks!A1:C");
    expect(schema.clearRange).toBe("Tasks!A2:C");
  });

  test("generates correct ranges for 1 field (column A)", () => {
    const schema = defineModel("Single", {
      id: field.string().primaryKey(),
    });
    expect(schema.readRange).toBe("Single!A2:A");
    expect(schema.writeRange).toBe("Single!A1:A");
    expect(schema.clearRange).toBe("Single!A2:A");
  });

  test("generates correct ranges for 5 fields (column E)", () => {
    const schema = defineModel("Wide", {
      id: field.string().primaryKey(),
      a: field.string(),
      b: field.number(),
      c: field.boolean(),
      d: field.date(),
    });
    expect(schema.readRange).toBe("Wide!A2:E");
    expect(schema.writeRange).toBe("Wide!A1:E");
    expect(schema.clearRange).toBe("Wide!A2:E");
  });

  test("generates correct ranges for 26 fields (column Z)", () => {
    const fields: Record<string, ReturnType<typeof field.string>> = {};
    fields["id"] = field.string().primaryKey();
    for (let i = 1; i < 26; i++) {
      fields[`col${i}`] = field.string();
    }
    const schema = defineModel("Big", fields);
    expect(schema.readRange).toBe("Big!A2:Z");
    expect(schema.writeRange).toBe("Big!A1:Z");
    expect(schema.clearRange).toBe("Big!A2:Z");
  });

  // -------------------------------------------------------------------------
  // 3. Sets primaryKey to the field marked with .primaryKey()
  // -------------------------------------------------------------------------
  test("sets primaryKey to the field marked with .primaryKey()", () => {
    const schema = createTestModel();
    expect(schema.primaryKey).toBe("id");
  });

  test("primaryKey can be a non-first field", () => {
    const schema = defineModel("Orders", {
      name: field.string(),
      orderId: field.string().primaryKey(),
      amount: field.number(),
    });
    expect(schema.primaryKey).toBe("orderId");
  });

  // -------------------------------------------------------------------------
  // 4. parseRow deserializes correctly
  // -------------------------------------------------------------------------
  test("parseRow deserializes string, number, boolean, date correctly", () => {
    const schema = defineModel("Mixed", {
      id: field.string().primaryKey(),
      count: field.number(),
      active: field.boolean(),
      createdAt: field.date(),
    });

    const row = ["abc-123", "42", "TRUE", "2026-01-15"];
    const result = schema.parseRow(row, 0);

    expect(result).not.toBeNull();
    expect(result!.id).toBe("abc-123");
    expect(result!.count).toBe(42);
    expect(result!.active).toBe(true);
    expect(result!.createdAt).toBe("2026-01-15");
  });

  test("parseRow converts number strings to numbers", () => {
    const schema = defineModel("Nums", {
      id: field.string().primaryKey(),
      value: field.number(),
    });

    const result = schema.parseRow(["x", "3.14"], 0);
    expect(result).not.toBeNull();
    expect(result!.value).toBe(3.14);
  });

  test('parseRow converts "true" (lowercase) to boolean true', () => {
    const schema = defineModel("Bools", {
      id: field.string().primaryKey(),
      flag: field.boolean(),
    });

    const result = schema.parseRow(["x", "true"], 0);
    expect(result).not.toBeNull();
    expect(result!.flag).toBe(true);
  });

  test('parseRow converts "TRUE" (uppercase) to boolean true', () => {
    const schema = defineModel("Bools", {
      id: field.string().primaryKey(),
      flag: field.boolean(),
    });

    const result = schema.parseRow(["x", "TRUE"], 0);
    expect(result).not.toBeNull();
    expect(result!.flag).toBe(true);
  });

  test("parseRow converts boolean true value to boolean true", () => {
    const schema = defineModel("Bools", {
      id: field.string().primaryKey(),
      flag: field.boolean(),
    });

    const result = schema.parseRow(["x", true], 0);
    expect(result).not.toBeNull();
    expect(result!.flag).toBe(true);
  });

  test("parseRow converts non-true values to boolean false", () => {
    const schema = defineModel("Bools", {
      id: field.string().primaryKey(),
      flag: field.boolean(),
    });

    const result = schema.parseRow(["x", "FALSE"], 0);
    expect(result).not.toBeNull();
    expect(result!.flag).toBe(false);

    const result2 = schema.parseRow(["x", ""], 0);
    expect(result2).not.toBeNull();
    expect(result2!.flag).toBe(false);

    const result3 = schema.parseRow(["x", "no"], 0);
    expect(result3).not.toBeNull();
    expect(result3!.flag).toBe(false);
  });

  test("parseRow returns date fields as strings", () => {
    const schema = defineModel("Dates", {
      id: field.string().primaryKey(),
      when: field.date(),
    });

    const result = schema.parseRow(["x", "2026-02-19"], 0);
    expect(result).not.toBeNull();
    expect(typeof result!.when).toBe("string");
    expect(result!.when).toBe("2026-02-19");
  });

  // -------------------------------------------------------------------------
  // 5. parseRow returns null for empty first cell
  // -------------------------------------------------------------------------
  test("parseRow returns null when first cell is empty string", () => {
    const schema = createTestModel();
    const result = schema.parseRow(["", "some title", "TRUE"], 0);
    expect(result).toBeNull();
  });

  test("parseRow returns null when first cell is undefined", () => {
    const schema = createTestModel();
    const result = schema.parseRow([undefined, "some title", "TRUE"], 0);
    expect(result).toBeNull();
  });

  test("parseRow returns null when first cell is null", () => {
    const schema = createTestModel();
    const result = schema.parseRow([null, "some title", "TRUE"], 0);
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 6. toRow serializes entity to correct array order
  // -------------------------------------------------------------------------
  test("toRow serializes entity to correct array order", () => {
    const schema = createTestModel();
    const entity = { id: "task-1", title: "Write tests", done: true };
    const row = schema.toRow(entity);
    expect(row).toEqual(["task-1", "Write tests", true]);
  });

  test("toRow maintains header order regardless of object key order", () => {
    const schema = createTestModel();
    // Object keys in different order than headers
    const entity = { done: false, id: "task-2", title: "Review PR" };
    const row = schema.toRow(entity);
    expect(row).toEqual(["task-2", "Review PR", false]);
  });

  test("toRow handles all field types", () => {
    const schema = defineModel("Mixed", {
      id: field.string().primaryKey(),
      count: field.number(),
      active: field.boolean(),
      createdAt: field.date(),
    });

    const entity = {
      id: "m-1",
      count: 99,
      active: false,
      createdAt: "2026-02-19",
    };
    const row = schema.toRow(entity);
    expect(row).toEqual(["m-1", 99, false, "2026-02-19"]);
  });

  // -------------------------------------------------------------------------
  // 7. validate passes for valid entity
  // -------------------------------------------------------------------------
  test("validate passes for valid entity", () => {
    const schema = createTestModel();
    const entity = { id: "task-1", title: "Test", done: false };
    // Should not throw
    expect(() => schema.validate!(entity)).not.toThrow();
  });

  test("validate passes for entity with all required fields present", () => {
    const schema = defineModel("Full", {
      id: field.string().primaryKey(),
      name: field.string(),
      age: field.number(),
      active: field.boolean(),
      joined: field.date(),
    });

    const entity = {
      id: "u-1",
      name: "Alice",
      age: 30,
      active: true,
      joined: "2026-01-01",
    };
    expect(() => schema.validate!(entity)).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // 8. validate throws VALIDATION_ERROR for missing required field
  // -------------------------------------------------------------------------
  test("validate throws VALIDATION_ERROR for null required field", () => {
    const schema = createTestModel();
    const entity = { id: "task-1", title: null, done: true };

    expect(() => schema.validate!(entity as any)).toThrow(GenjutsuError);
    try {
      schema.validate!(entity as any);
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("VALIDATION_ERROR");
    }
  });

  test("validate throws VALIDATION_ERROR for undefined required field", () => {
    const schema = createTestModel();
    const entity = { id: "task-1", done: true } as any;

    expect(() => schema.validate!(entity)).toThrow(GenjutsuError);
    try {
      schema.validate!(entity);
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("VALIDATION_ERROR");
    }
  });

  // -------------------------------------------------------------------------
  // 9. Rejects zero fields (throws SCHEMA_ERROR)
  // -------------------------------------------------------------------------
  test("rejects zero fields with SCHEMA_ERROR", () => {
    expect(() => defineModel("Empty", {})).toThrow(GenjutsuError);
    try {
      defineModel("Empty", {});
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("SCHEMA_ERROR");
    }
  });

  // -------------------------------------------------------------------------
  // 10. Rejects multiple primaryKey fields (throws SCHEMA_ERROR)
  // -------------------------------------------------------------------------
  test("rejects multiple primaryKey fields with SCHEMA_ERROR", () => {
    expect(() =>
      defineModel("Multi", {
        id1: field.string().primaryKey(),
        id2: field.string().primaryKey(),
        name: field.string(),
      }),
    ).toThrow(GenjutsuError);

    try {
      defineModel("Multi", {
        id1: field.string().primaryKey(),
        id2: field.string().primaryKey(),
        name: field.string(),
      });
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("SCHEMA_ERROR");
    }
  });

  // -------------------------------------------------------------------------
  // 11. Rejects no primaryKey field (throws SCHEMA_ERROR)
  // -------------------------------------------------------------------------
  test("rejects no primaryKey field with SCHEMA_ERROR", () => {
    expect(() =>
      defineModel("NoPK", {
        name: field.string(),
        age: field.number(),
      }),
    ).toThrow(GenjutsuError);

    try {
      defineModel("NoPK", {
        name: field.string(),
        age: field.number(),
      });
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("SCHEMA_ERROR");
    }
  });

  // -------------------------------------------------------------------------
  // 12. fields property contains FieldDefinition objects
  // -------------------------------------------------------------------------
  test("fields property contains FieldDefinition objects with correct properties", () => {
    const schema = defineModel("Detailed", {
      id: field.string().primaryKey(),
      name: field.string(),
      score: field.number().optional().default(0),
      active: field.boolean().default(true),
      ref: field.string().references("Other", "otherId"),
    });

    expect(schema.fields).toBeDefined();
    expect(schema.fields!.length).toBe(5);

    // id field
    const idField = schema.fields!.find((f) => f.name === "id")!;
    expect(idField.type).toBe("string");
    expect(idField.isPrimaryKey).toBe(true);
    expect(idField.isOptional).toBeFalsy();

    // name field
    const nameField = schema.fields!.find((f) => f.name === "name")!;
    expect(nameField.type).toBe("string");
    expect(nameField.isPrimaryKey).toBeFalsy();
    expect(nameField.isOptional).toBeFalsy();

    // score field (optional with default)
    const scoreField = schema.fields!.find((f) => f.name === "score")!;
    expect(scoreField.type).toBe("number");
    expect(scoreField.isOptional).toBe(true);
    expect(scoreField.defaultValue).toBe(0);

    // active field (with default)
    const activeField = schema.fields!.find((f) => f.name === "active")!;
    expect(activeField.type).toBe("boolean");
    expect(activeField.defaultValue).toBe(true);

    // ref field (with references)
    const refField = schema.fields!.find((f) => f.name === "ref")!;
    expect(refField.type).toBe("string");
    expect(refField.references).toEqual({ model: "Other", field: "otherId" });
  });

  // -------------------------------------------------------------------------
  // 13. Handles .default() values in parseRow
  // -------------------------------------------------------------------------
  test("parseRow uses default value when cell is undefined for a field with default", () => {
    const schema = defineModel("Defaults", {
      id: field.string().primaryKey(),
      status: field.string().default("pending"),
      count: field.number().default(0),
    });

    // Row with only id, missing status and count
    const result = schema.parseRow(["item-1", undefined, undefined], 0);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("item-1");
    expect(result!.status).toBe("pending");
    expect(result!.count).toBe(0);
  });

  test("parseRow uses default value when cell is empty string for a field with default", () => {
    const schema = defineModel("Defaults2", {
      id: field.string().primaryKey(),
      status: field.string().default("active"),
    });

    const result = schema.parseRow(["item-2", ""], 0);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("active");
  });

  test("parseRow uses provided value over default when cell has a value", () => {
    const schema = defineModel("Defaults3", {
      id: field.string().primaryKey(),
      status: field.string().default("pending"),
    });

    const result = schema.parseRow(["item-3", "completed"], 0);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("completed");
  });

  // -------------------------------------------------------------------------
  // 14. Handles .optional() fields: validate allows null for optional fields
  // -------------------------------------------------------------------------
  test("validate allows null for optional fields", () => {
    const schema = defineModel("OptFields", {
      id: field.string().primaryKey(),
      nickname: field.string().optional(),
      bio: field.string().optional(),
    });

    const entity = { id: "u-1", nickname: null, bio: undefined };
    expect(() => schema.validate!(entity as any)).not.toThrow();
  });

  test("validate allows undefined for optional fields", () => {
    const schema = defineModel("OptFields2", {
      id: field.string().primaryKey(),
      notes: field.string().optional(),
    });

    const entity = { id: "u-2" } as any;
    expect(() => schema.validate!(entity)).not.toThrow();
  });

  test("validate still requires non-optional fields even when optional fields exist", () => {
    const schema = defineModel("MixedReq", {
      id: field.string().primaryKey(),
      name: field.string(),
      nickname: field.string().optional(),
    });

    // Missing required 'name', but optional 'nickname' is fine to omit
    const entity = { id: "u-3", nickname: "Bob" } as any;
    expect(() => schema.validate!(entity)).toThrow(GenjutsuError);
    try {
      schema.validate!(entity);
    } catch (err) {
      expect((err as GenjutsuError).kind).toBe("VALIDATION_ERROR");
    }
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe("defineModel edge cases", () => {
  test("sheetName is set correctly", () => {
    const schema = defineModel("MySheet", {
      id: field.string().primaryKey(),
    });
    expect(schema.sheetName).toBe("MySheet");
  });

  test("parseRow handles short rows (fewer cells than headers)", () => {
    const schema = defineModel("Short", {
      id: field.string().primaryKey(),
      name: field.string().optional(),
      age: field.number().optional(),
    });

    // Only 1 cell provided, name and age are missing
    const result = schema.parseRow(["x"], 0);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("x");
  });

  test("parseRow passes rowIndex through correctly", () => {
    const schema = defineModel("Indexed", {
      id: field.string().primaryKey(),
    });

    // Parsing at different indices should not affect the result for valid rows
    const result0 = schema.parseRow(["a"], 0);
    const result5 = schema.parseRow(["b"], 5);
    expect(result0).not.toBeNull();
    expect(result5).not.toBeNull();
    expect(result0!.id).toBe("a");
    expect(result5!.id).toBe("b");
  });
});
