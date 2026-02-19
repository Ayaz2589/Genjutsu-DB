/**
 * Tests for FK validation and eager loading (src/relations.ts + client integration).
 * T028: FK validation through client CRUD operations.
 * T029: Eager loading via `include` option on findMany() and readAll().
 */

import { describe, test, expect, afterEach, mock } from "bun:test";
import { createClient } from "../src/client";
import { defineModel, field } from "../src/model";
import { isGenjutsuError, GenjutsuError } from "../src/errors";
import { SHEETS_API } from "../src/transport";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

/** Create a mock Response with JSON body. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

const Order = defineModel("Orders", {
  id: field.string().primaryKey(),
  customerName: field.string(),
});

const OrderItem = defineModel("OrderItems", {
  id: field.string().primaryKey(),
  orderId: field.string().references("orders", "id"),
  product: field.string(),
  quantity: field.number(),
});

/** A model with no FK references. */
const Category = defineModel("Categories", {
  id: field.string().primaryKey(),
  name: field.string(),
});

// ---------------------------------------------------------------------------
// Client factory helper
// ---------------------------------------------------------------------------

function testClient() {
  return createClient({
    spreadsheetId: "test-id",
    auth: "test-token",
    schemas: { orders: Order, orderItems: OrderItem },
  });
}

function clientWithCategory() {
  return createClient({
    spreadsheetId: "test-id",
    auth: "test-token",
    schemas: { orders: Order, orderItems: OrderItem, categories: Category },
  });
}

// ===========================================================================
// T028: FK Validation Tests
// ===========================================================================

describe("T028: FK Validation", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // -------------------------------------------------------------------------
  // 1. create() with valid FK succeeds
  // -------------------------------------------------------------------------
  test("create() with valid FK succeeds", async () => {
    const calls: { url: string; method: string }[] = [];

    globalThis.fetch = mock((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method });

      // Read OrderItems sheet to check PK uniqueness — no existing items
      if (url.includes("OrderItems") && url.includes("values") && !init?.method) {
        return Promise.resolve(
          jsonResponse({ values: [] }),
        );
      }

      // Read Orders sheet to validate FK — the referenced order exists
      if (url.includes("Orders") && url.includes("values") && !init?.method) {
        return Promise.resolve(
          jsonResponse({ values: [["order-1", "Alice"]] }),
        );
      }

      // Append call for the new OrderItem
      if (url.includes(":append")) {
        return Promise.resolve(jsonResponse({}));
      }

      return Promise.resolve(jsonResponse({}));
    });

    const db = testClient();
    const result = await db.repo("orderItems").create({
      id: "item-1",
      orderId: "order-1",
      product: "Widget",
      quantity: 3,
    });

    expect(result).toBeDefined();
    expect(result.id).toBe("item-1");
    expect(result.orderId).toBe("order-1");
    expect(result.product).toBe("Widget");
    expect(result.quantity).toBe(3);

    // Should have made calls to read OrderItems (PK check), read Orders (FK check), and append
    const readOrderItemsCall = calls.find(
      (c) => c.url.includes("OrderItems") && c.method === "GET",
    );
    expect(readOrderItemsCall).toBeDefined();

    const readOrdersCall = calls.find(
      (c) => c.url.includes("Orders") && c.method === "GET",
    );
    expect(readOrdersCall).toBeDefined();

    const appendCall = calls.find((c) => c.url.includes(":append"));
    expect(appendCall).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 2. create() with invalid FK throws VALIDATION_ERROR
  // -------------------------------------------------------------------------
  test("create() with invalid FK throws VALIDATION_ERROR", async () => {
    globalThis.fetch = mock((url: string, init?: RequestInit) => {
      // Read OrderItems sheet to check PK uniqueness — no existing items
      if (url.includes("OrderItems") && url.includes("values") && !init?.method) {
        return Promise.resolve(
          jsonResponse({ values: [] }),
        );
      }

      // Read Orders sheet to validate FK — no matching order
      if (url.includes("Orders") && url.includes("values") && !init?.method) {
        return Promise.resolve(
          jsonResponse({ values: [] }),
        );
      }

      return Promise.resolve(jsonResponse({}));
    });

    const db = testClient();

    try {
      await db.repo("orderItems").create({
        id: "item-1",
        orderId: "nonexistent-order",
        product: "Widget",
        quantity: 3,
      });
      throw new Error("Expected VALIDATION_ERROR to be thrown");
    } catch (err) {
      expect(isGenjutsuError(err)).toBe(true);
      const gErr = err as GenjutsuError;
      expect(gErr.kind).toBe("VALIDATION_ERROR");
      expect(gErr.message).toContain("orderId");
    }
  });

  // -------------------------------------------------------------------------
  // 3. update() validates FK on changed fields
  // -------------------------------------------------------------------------
  test("update() validates FK on changed fields", async () => {
    globalThis.fetch = mock((url: string, init?: RequestInit) => {
      // Read OrderItems to find existing record for update
      if (url.includes("OrderItems") && url.includes("values") && !init?.method) {
        return Promise.resolve(
          jsonResponse({
            values: [["item-1", "order-1", "Widget", "3"]],
          }),
        );
      }

      // Read Orders sheet to validate the new FK value — no matching order
      if (url.includes("Orders") && url.includes("values") && !init?.method) {
        return Promise.resolve(
          jsonResponse({ values: [["order-1", "Alice"]] }),
        );
      }

      // clear + write
      return Promise.resolve(jsonResponse({}));
    });

    const db = testClient();

    // Updating orderId to a non-existent order should fail
    try {
      await db.repo("orderItems").update("item-1", {
        orderId: "nonexistent-order",
      });
      throw new Error("Expected VALIDATION_ERROR to be thrown");
    } catch (err) {
      expect(isGenjutsuError(err)).toBe(true);
      const gErr = err as GenjutsuError;
      expect(gErr.kind).toBe("VALIDATION_ERROR");
      expect(gErr.message).toContain("orderId");
    }
  });

  // -------------------------------------------------------------------------
  // 4. skipFkValidation: true bypasses FK check
  // -------------------------------------------------------------------------
  test("skipFkValidation: true bypasses FK check", async () => {
    const calls: { url: string; method: string }[] = [];

    globalThis.fetch = mock((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method });

      // Read OrderItems sheet to check PK uniqueness — no existing items
      if (url.includes("OrderItems") && url.includes("values") && !init?.method) {
        return Promise.resolve(
          jsonResponse({ values: [] }),
        );
      }

      // Orders sheet is empty — FK would normally fail
      if (url.includes("Orders") && url.includes("values") && !init?.method) {
        return Promise.resolve(
          jsonResponse({ values: [] }),
        );
      }

      // Append call
      if (url.includes(":append")) {
        return Promise.resolve(jsonResponse({}));
      }

      return Promise.resolve(jsonResponse({}));
    });

    const db = testClient();
    const result = await db.repo("orderItems").create(
      {
        id: "item-1",
        orderId: "nonexistent-order",
        product: "Widget",
        quantity: 3,
      },
      { skipFkValidation: true },
    );

    expect(result).toBeDefined();
    expect(result.id).toBe("item-1");

    // Should NOT have read the Orders sheet for FK validation
    const readOrdersCall = calls.find(
      (c) => c.url.includes("Orders") && c.method === "GET",
    );
    expect(readOrdersCall).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 5. Models without FK have no validation overhead
  // -------------------------------------------------------------------------
  test("models without FK declarations have no validation overhead", async () => {
    const calls: { url: string; method: string }[] = [];

    globalThis.fetch = mock((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method });

      // Read Categories sheet to check PK — no existing records
      if (url.includes("Categories") && url.includes("values") && !init?.method) {
        return Promise.resolve(
          jsonResponse({ values: [] }),
        );
      }

      // Append
      if (url.includes(":append")) {
        return Promise.resolve(jsonResponse({}));
      }

      return Promise.resolve(jsonResponse({}));
    });

    const db = clientWithCategory();
    const result = await db.repo("categories").create({
      id: "cat-1",
      name: "Electronics",
    });

    expect(result).toBeDefined();
    expect(result.id).toBe("cat-1");
    expect(result.name).toBe("Electronics");

    // Should NOT have read Orders or OrderItems sheets (no FK to validate)
    const otherSheetCalls = calls.filter(
      (c) =>
        (c.url.includes("Orders") || c.url.includes("OrderItems")) &&
        c.method === "GET",
    );
    expect(otherSheetCalls.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 6. references() target model validation at client creation
  // -------------------------------------------------------------------------
  test("references() target model validation at client creation throws SCHEMA_ERROR", () => {
    const BadItem = defineModel("BadItems", {
      id: field.string().primaryKey(),
      categoryId: field.string().references("nonexistent", "id"),
    });

    try {
      createClient({
        spreadsheetId: "test-id",
        auth: "test-token",
        schemas: { badItems: BadItem },
      });
      throw new Error("Expected SCHEMA_ERROR to be thrown");
    } catch (err) {
      expect(isGenjutsuError(err)).toBe(true);
      const gErr = err as GenjutsuError;
      expect(gErr.kind).toBe("SCHEMA_ERROR");
    }
  });
});

// ===========================================================================
// T029: Eager Loading Tests
// ===========================================================================

describe("T029: Eager Loading", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // -------------------------------------------------------------------------
  // 7. findMany() with include attaches related records
  // -------------------------------------------------------------------------
  test("findMany() with include: { orderItems: true } attaches related records", async () => {
    globalThis.fetch = mock((url: string, init?: RequestInit) => {
      // Read Orders sheet
      if (url.includes("Orders") && url.includes("values") && !init?.method) {
        return Promise.resolve(
          jsonResponse({
            values: [
              ["order-1", "Alice"],
              ["order-2", "Bob"],
            ],
          }),
        );
      }

      // batchGet or read for OrderItems sheet
      if (url.includes("batchGet") || (url.includes("OrderItems") && url.includes("values") && !init?.method)) {
        // If batchGet, return both ranges
        if (url.includes("batchGet")) {
          return Promise.resolve(
            jsonResponse({
              valueRanges: [
                {
                  range: "OrderItems!A2:D",
                  values: [
                    ["item-1", "order-1", "Widget", "3"],
                    ["item-2", "order-1", "Gadget", "1"],
                    ["item-3", "order-2", "Doohickey", "5"],
                  ],
                },
              ],
            }),
          );
        }
        return Promise.resolve(
          jsonResponse({
            values: [
              ["item-1", "order-1", "Widget", "3"],
              ["item-2", "order-1", "Gadget", "1"],
              ["item-3", "order-2", "Doohickey", "5"],
            ],
          }),
        );
      }

      return Promise.resolve(jsonResponse({}));
    });

    const db = testClient();
    const orders = await db
      .repo("orders")
      .findMany(undefined, { include: { orderItems: true } });

    expect(orders.length).toBe(2);

    // Order 1 should have 2 items
    const order1 = orders.find((o: any) => o.id === "order-1") as any;
    expect(order1).toBeDefined();
    expect(order1.orderItems).toBeDefined();
    expect(Array.isArray(order1.orderItems)).toBe(true);
    expect(order1.orderItems.length).toBe(2);
    expect(order1.orderItems[0].product).toBe("Widget");
    expect(order1.orderItems[1].product).toBe("Gadget");

    // Order 2 should have 1 item
    const order2 = orders.find((o: any) => o.id === "order-2") as any;
    expect(order2).toBeDefined();
    expect(order2.orderItems).toBeDefined();
    expect(Array.isArray(order2.orderItems)).toBe(true);
    expect(order2.orderItems.length).toBe(1);
    expect(order2.orderItems[0].product).toBe("Doohickey");
  });

  // -------------------------------------------------------------------------
  // 8. readAll() with include works the same
  // -------------------------------------------------------------------------
  test("readAll() with include works the same as findMany()", async () => {
    globalThis.fetch = mock((url: string, init?: RequestInit) => {
      // Read Orders sheet
      if (url.includes("Orders") && url.includes("values") && !init?.method) {
        return Promise.resolve(
          jsonResponse({
            values: [
              ["order-1", "Alice"],
            ],
          }),
        );
      }

      // batchGet or read for OrderItems sheet
      if (url.includes("batchGet") || (url.includes("OrderItems") && url.includes("values") && !init?.method)) {
        if (url.includes("batchGet")) {
          return Promise.resolve(
            jsonResponse({
              valueRanges: [
                {
                  range: "OrderItems!A2:D",
                  values: [
                    ["item-1", "order-1", "Widget", "3"],
                  ],
                },
              ],
            }),
          );
        }
        return Promise.resolve(
          jsonResponse({
            values: [
              ["item-1", "order-1", "Widget", "3"],
            ],
          }),
        );
      }

      return Promise.resolve(jsonResponse({}));
    });

    const db = testClient();
    const orders = await db
      .repo("orders")
      .readAll({ include: { orderItems: true } });

    expect(orders.length).toBe(1);

    const order = orders[0] as any;
    expect(order.id).toBe("order-1");
    expect(order.orderItems).toBeDefined();
    expect(Array.isArray(order.orderItems)).toBe(true);
    expect(order.orderItems.length).toBe(1);
    expect(order.orderItems[0].product).toBe("Widget");
  });

  // -------------------------------------------------------------------------
  // 9. One-to-many: parent has array of children
  // -------------------------------------------------------------------------
  test("one-to-many: parent has array of children matched by FK", async () => {
    globalThis.fetch = mock((url: string, init?: RequestInit) => {
      // Read Orders sheet
      if (url.includes("Orders") && url.includes("values") && !init?.method) {
        return Promise.resolve(
          jsonResponse({
            values: [
              ["order-1", "Alice"],
              ["order-2", "Bob"],
              ["order-3", "Charlie"],
            ],
          }),
        );
      }

      // batchGet or read for OrderItems sheet
      if (url.includes("batchGet") || (url.includes("OrderItems") && url.includes("values") && !init?.method)) {
        const itemData = [
          ["item-1", "order-1", "Widget", "3"],
          ["item-2", "order-2", "Gadget", "1"],
          ["item-3", "order-1", "Bolt", "10"],
          ["item-4", "order-2", "Nut", "20"],
          ["item-5", "order-1", "Screw", "50"],
        ];
        if (url.includes("batchGet")) {
          return Promise.resolve(
            jsonResponse({
              valueRanges: [
                { range: "OrderItems!A2:D", values: itemData },
              ],
            }),
          );
        }
        return Promise.resolve(jsonResponse({ values: itemData }));
      }

      return Promise.resolve(jsonResponse({}));
    });

    const db = testClient();
    const orders = await db
      .repo("orders")
      .findMany(undefined, { include: { orderItems: true } });

    expect(orders.length).toBe(3);

    // Order 1 should have 3 items
    const order1 = orders.find((o: any) => o.id === "order-1") as any;
    expect(order1.orderItems.length).toBe(3);
    const order1Products = order1.orderItems.map((i: any) => i.product);
    expect(order1Products).toContain("Widget");
    expect(order1Products).toContain("Bolt");
    expect(order1Products).toContain("Screw");

    // Order 2 should have 2 items
    const order2 = orders.find((o: any) => o.id === "order-2") as any;
    expect(order2.orderItems.length).toBe(2);
    const order2Products = order2.orderItems.map((i: any) => i.product);
    expect(order2Products).toContain("Gadget");
    expect(order2Products).toContain("Nut");

    // Order 3 should have 0 items
    const order3 = orders.find((o: any) => o.id === "order-3") as any;
    expect(order3.orderItems).toBeDefined();
    expect(order3.orderItems.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 10. Uses batchGet for related sheets
  // -------------------------------------------------------------------------
  test("uses batchGet for related sheets (not individual getSheetValues)", async () => {
    const calls: { url: string; method: string }[] = [];

    globalThis.fetch = mock((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method });

      // Read Orders sheet (primary query)
      if (url.includes("Orders") && url.includes("values") && !url.includes("batchGet") && !init?.method) {
        return Promise.resolve(
          jsonResponse({
            values: [
              ["order-1", "Alice"],
            ],
          }),
        );
      }

      // batchGet for related OrderItems
      if (url.includes("batchGet")) {
        return Promise.resolve(
          jsonResponse({
            valueRanges: [
              {
                range: "OrderItems!A2:D",
                values: [
                  ["item-1", "order-1", "Widget", "3"],
                ],
              },
            ],
          }),
        );
      }

      // Fallback for individual OrderItems read (should NOT be called)
      if (url.includes("OrderItems") && url.includes("values") && !init?.method) {
        return Promise.resolve(
          jsonResponse({
            values: [
              ["item-1", "order-1", "Widget", "3"],
            ],
          }),
        );
      }

      return Promise.resolve(jsonResponse({}));
    });

    const db = testClient();
    await db
      .repo("orders")
      .findMany(undefined, { include: { orderItems: true } });

    // Verify batchGet was called for related data
    const batchGetCalls = calls.filter((c) => c.url.includes("batchGet"));
    expect(batchGetCalls.length).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // 11. include with no matching related records returns empty arrays
  // -------------------------------------------------------------------------
  test("include with no matching related records returns empty arrays", async () => {
    globalThis.fetch = mock((url: string, init?: RequestInit) => {
      // Read Orders sheet
      if (url.includes("Orders") && url.includes("values") && !init?.method) {
        return Promise.resolve(
          jsonResponse({
            values: [
              ["order-1", "Alice"],
              ["order-2", "Bob"],
            ],
          }),
        );
      }

      // batchGet or read for OrderItems sheet — empty
      if (url.includes("batchGet") || (url.includes("OrderItems") && url.includes("values") && !init?.method)) {
        if (url.includes("batchGet")) {
          return Promise.resolve(
            jsonResponse({
              valueRanges: [
                { range: "OrderItems!A2:D", values: [] },
              ],
            }),
          );
        }
        return Promise.resolve(jsonResponse({ values: [] }));
      }

      return Promise.resolve(jsonResponse({}));
    });

    const db = testClient();
    const orders = await db
      .repo("orders")
      .findMany(undefined, { include: { orderItems: true } });

    expect(orders.length).toBe(2);

    // Both orders should have empty orderItems arrays
    for (const order of orders) {
      const o = order as any;
      expect(o.orderItems).toBeDefined();
      expect(Array.isArray(o.orderItems)).toBe(true);
      expect(o.orderItems.length).toBe(0);
    }
  });
});
