/**
 * genjutsu-db standalone demo.
 *
 * Usage:
 *   1. Go to https://developers.google.com/oauthplayground/
 *   2. Select "Google Sheets API v4" → "https://www.googleapis.com/auth/spreadsheets"
 *   3. Authorize and get an access token
 *   4. Run:
 *        GOOGLE_TOKEN="your-token-here" bun run demo.ts
 *
 *      Or to use an existing spreadsheet:
 *        GOOGLE_TOKEN="your-token" SHEET_ID="your-spreadsheet-id" bun run demo.ts
 */

import { createClient, createSpreadsheet, defineModel, field, generateId } from "./src/index";

const token = process.env.GOOGLE_TOKEN;
if (!token) {
  console.error("Missing GOOGLE_TOKEN environment variable.");
  console.error("Get one from: https://developers.google.com/oauthplayground/");
  console.error('  Scope: "https://www.googleapis.com/auth/spreadsheets"');
  console.error("");
  console.error('Run: GOOGLE_TOKEN="your-token" bun run demo.ts');
  process.exit(1);
}

// --- Define models ---

const Contact = defineModel("Contacts", {
  id: field.string().primaryKey(),
  name: field.string(),
  email: field.string().optional(),
  age: field.number().optional(),
});

const Note = defineModel("Notes", {
  id: field.string().primaryKey(),
  contactId: field.string().references("contacts", "id"),
  text: field.string(),
  createdAt: field.date(),
});

// --- Create or connect to spreadsheet ---

let spreadsheetId = process.env.SHEET_ID;

if (!spreadsheetId) {
  console.log("Creating a new spreadsheet...");
  const result = await createSpreadsheet("genjutsu-db Demo", token);
  spreadsheetId = result.spreadsheetId;
  console.log(`Created: ${result.spreadsheetUrl}`);
} else {
  console.log(`Using existing spreadsheet: ${spreadsheetId}`);
}

// --- Create client ---

const db = createClient({
  spreadsheetId,
  auth: token,
  schemas: { contacts: Contact, notes: Note },
});

// --- Ensure sheet tabs exist ---

console.log("\nEnsuring schema...");
await db.ensureSchema();
console.log("Schema ready.");

// --- CRUD demo ---

console.log("\n--- CREATE ---");
const alice = await db.repo("contacts").create({
  id: generateId(),
  name: "Alice",
  email: "alice@example.com",
  age: 30,
});
console.log("Created:", alice);

const bob = await db.repo("contacts").create({
  id: generateId(),
  name: "Bob",
  email: "bob@example.com",
  age: 25,
});
console.log("Created:", bob);

// Create notes referencing contacts
const note1 = await db.repo("notes").create({
  id: generateId(),
  contactId: alice.id,
  text: "Met at conference",
  createdAt: new Date().toISOString().split("T")[0],
});
console.log("Created note:", note1);

const note2 = await db.repo("notes").create({
  id: generateId(),
  contactId: alice.id,
  text: "Follow up on proposal",
  createdAt: new Date().toISOString().split("T")[0],
});
console.log("Created note:", note2);

console.log("\n--- READ ---");
const allContacts = await db.repo("contacts").readAll();
console.log(`All contacts (${allContacts.length}):`, allContacts);

console.log("\n--- FIND BY ID ---");
const found = await db.repo("contacts").findById(alice.id);
console.log("Found Alice:", found);

console.log("\n--- FIND MANY (filter) ---");
const over27 = await db.repo("contacts").findMany((c) => (c.age ?? 0) > 27);
console.log("Contacts over 27:", over27);

console.log("\n--- UPDATE ---");
const updated = await db.repo("contacts").update(bob.id, { age: 26 });
console.log("Updated Bob:", updated);

console.log("\n--- EAGER LOADING ---");
const contactsWithNotes = await db.repo("contacts").findMany(undefined, {
  include: { notes: true },
});
for (const c of contactsWithNotes) {
  const contact = c as any;
  console.log(`${contact.name}: ${contact.notes?.length ?? 0} notes`);
}

console.log("\n--- DELETE ---");
await db.repo("contacts").delete(bob.id);
const remaining = await db.repo("contacts").readAll();
console.log(`Remaining contacts (${remaining.length}):`, remaining.map((c) => c.name));

console.log("\nDone! Check your spreadsheet to see the data.");
