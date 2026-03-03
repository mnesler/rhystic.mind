// Singleton node:sqlite database client.
// Applies the schema on first open so callers never need to worry about
// whether tables exist.

import { DatabaseSync } from "node:sqlite";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";
import { applySchema } from "./schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Default DB path: mtg/data/mtg.db  (two levels up from src/db/)
const DEFAULT_DB_PATH = join(__dirname, "../../data/mtg.db");

let _db: DatabaseSync | null = null;

export function getDb(dbPath: string = DEFAULT_DB_PATH): DatabaseSync {
  if (_db) return _db;

  // Ensure the data directory exists
  const dir = dirname(dbPath);
  mkdirSync(dir, { recursive: true });

  _db = new DatabaseSync(dbPath);

  // Performance pragmas — safe for our write patterns
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA foreign_keys = ON");
  _db.exec("PRAGMA synchronous = NORMAL");

  applySchema(_db);

  return _db;
}

export type { DatabaseSync };
