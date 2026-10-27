/**
 * Where the mock keeps what it knows, so a restart forgets nothing.
 *
 * One SQLite file (`bun:sqlite`, built into Bun and into the compiled binary)
 * holds the conversations, the webhook calls, the settings, the numbers'
 * webhooks and state, and the template library. The bytes of an uploaded
 * media are files beside it (`media/`); the database keeps their metadata.
 *
 * `WHAP_DATA_DIR` is the folder (default `./data`, `/app/data` in the image,
 * a volume). `WHAP_DB=:memory:` keeps everything in memory; the tests run
 * that way, each store on its own database.
 */
import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** The folder of the database file and of the media. */
export function dataDir(): string {
	return resolve(process.cwd(), process.env.WHAP_DATA_DIR ?? 'data')
}

/** Where the bytes of the uploaded media live; a run in memory keeps them in a temp folder. */
export function mediaDir(): string {
	if (inMemory()) return join(tmpdir(), `whap-media-${process.pid}`)
	return resolve(dataDir(), 'media')
}

const MIGRATIONS = [
	`CREATE TABLE IF NOT EXISTS messages (
		id TEXT PRIMARY KEY,
		seq INTEGER NOT NULL,
		phone_number_id TEXT NOT NULL,
		contact TEXT NOT NULL,
		data TEXT NOT NULL
	)`,
	'CREATE INDEX IF NOT EXISTS messages_conversation ON messages (phone_number_id, contact, seq)',
	'CREATE INDEX IF NOT EXISTS messages_seq ON messages (seq)',
	`CREATE TABLE IF NOT EXISTS webhook_events (
		id TEXT PRIMARY KEY,
		seq INTEGER NOT NULL,
		data TEXT NOT NULL
	)`,
	'CREATE INDEX IF NOT EXISTS webhook_events_seq ON webhook_events (seq)',
	`CREATE TABLE IF NOT EXISTS settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS webhook_overrides (
		phone_number_id TEXT PRIMARY KEY,
		url TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS phone_numbers (
		id TEXT PRIMARY KEY,
		data TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS templates (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		language TEXT NOT NULL,
		data TEXT NOT NULL,
		UNIQUE (name, language)
	)`,
	`CREATE TABLE IF NOT EXISTS template_seeds (
		name TEXT NOT NULL,
		language TEXT NOT NULL,
		hash TEXT NOT NULL,
		PRIMARY KEY (name, language)
	)`,
	`CREATE TABLE IF NOT EXISTS media (
		id TEXT PRIMARY KEY,
		phone_number_id TEXT NOT NULL,
		mime_type TEXT NOT NULL,
		sha256 TEXT NOT NULL,
		file_size INTEGER NOT NULL,
		file_name TEXT,
		created_at TEXT NOT NULL,
		deleted_at TEXT
	)`,
	// The accounts Meta arranges above the numbers: a business owns WABAs.
	`CREATE TABLE IF NOT EXISTS businesses (
		id TEXT PRIMARY KEY,
		data TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS wabas (
		id TEXT PRIMARY KEY,
		business_id TEXT NOT NULL,
		data TEXT NOT NULL
	)`,
	// Voice calls (Calling API) and the users' permissions to be called.
	`CREATE TABLE IF NOT EXISTS calls (
		id TEXT PRIMARY KEY,
		phone_number_id TEXT NOT NULL,
		contact TEXT NOT NULL,
		created_at TEXT NOT NULL,
		data TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS call_permissions (
		phone_number_id TEXT NOT NULL,
		contact TEXT NOT NULL,
		data TEXT NOT NULL,
		PRIMARY KEY (phone_number_id, contact)
	)`,
]

/** Open a database and bring its tables up to date. */
export function openDatabase(file: string): Database {
	if (file !== ':memory:') mkdirSync(resolve(file, '..'), { recursive: true })
	const db = new Database(file, { create: true, strict: true })
	db.exec('PRAGMA journal_mode = WAL')
	db.exec('PRAGMA synchronous = NORMAL')
	db.exec('PRAGMA busy_timeout = 2000')
	for (const statement of MIGRATIONS) db.exec(statement)
	return db
}

function inMemory(): boolean {
	return process.env.WHAP_DB === ':memory:' || !!process.env.VITEST
}

let shared: Database | null = null

/**
 * The database a store opens by default: the process's file, shared by every
 * store. In memory, each call is a fresh database, so two stores of a test
 * never see each other.
 */
export function storeDatabase(): Database {
	if (inMemory()) return openDatabase(':memory:')
	shared ??= openDatabase(resolve(dataDir(), 'whap.db'))
	return shared
}

/** A value of the settings table, read as JSON. */
export function readSetting<T>(db: Database, key: string): T | undefined {
	const row = db
		.query<{ value: string }, [string]>(
			'SELECT value FROM settings WHERE key = ?'
		)
		.get(key)
	return row ? (JSON.parse(row.value) as T) : undefined
}

export function writeSetting(db: Database, key: string, value: unknown): void {
	db.query(
		'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
	).run(key, JSON.stringify(value))
}
