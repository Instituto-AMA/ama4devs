/**
 * The media of the numbers: what `POST /{phone-number-id}/media` uploaded and
 * a message sends by id. The bytes are files in the data folder
 * (`media/<id>`); the database keeps who uploaded what (`media` table).
 */
import type { Database } from 'bun:sqlite'
import { createHash, randomInt } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mediaDir, storeDatabase } from './database.ts'

export interface StoredMedia {
	id: string
	phoneNumberId: string
	mimeType: string
	sha256: string
	fileSize: number
	fileName: string | null
	createdAt: string
}

/** The media types Meta takes and the largest file of each (bytes). */
export const MEDIA_LIMITS: Array<{
	kind: string
	types: string[]
	max: number
}> = [
	{ kind: 'image', types: ['image/jpeg', 'image/png'], max: 5 * 1024 * 1024 },
	{ kind: 'sticker', types: ['image/webp'], max: 500 * 1024 },
	{ kind: 'video', types: ['video/mp4', 'video/3gpp'], max: 16 * 1024 * 1024 },
	{
		kind: 'audio',
		types: ['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg'],
		max: 16 * 1024 * 1024,
	},
	{
		kind: 'document',
		types: [
			'text/plain',
			'application/pdf',
			'application/vnd.ms-excel',
			'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'application/msword',
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			'application/vnd.ms-powerpoint',
			'application/vnd.openxmlformats-officedocument.presentationml.presentation',
		],
		max: 100 * 1024 * 1024,
	},
]

/** The kind of message a media type is sent as, and its limit; null when Meta refuses it. */
export function mediaKindOf(
	mimeType: string
): { kind: string; max: number } | null {
	const base = mimeType.split(';')[0].trim().toLowerCase()
	const found = MEDIA_LIMITS.find((entry) => entry.types.includes(base))
	return found ? { kind: found.kind, max: found.max } : null
}

type Row = {
	id: string
	phone_number_id: string
	mime_type: string
	sha256: string
	file_size: number
	file_name: string | null
	created_at: string
}

const toMedia = (row: Row): StoredMedia => ({
	id: row.id,
	phoneNumberId: row.phone_number_id,
	mimeType: row.mime_type,
	sha256: row.sha256,
	fileSize: row.file_size,
	fileName: row.file_name,
	createdAt: row.created_at,
})

export class MediaStore {
	readonly db: Database
	private readonly dir: string

	constructor(db: Database = storeDatabase(), dir: string = mediaDir()) {
		this.db = db
		this.dir = dir
		mkdirSync(dir, { recursive: true })
	}

	/** Keep an upload: a sixteen-digit id, as Meta gives. */
	save(input: {
		phoneNumberId: string
		mimeType: string
		fileName: string | null
		bytes: Uint8Array
	}): StoredMedia {
		let id = ''
		do {
			// randomInt draws below 2^48: two halves make the fifteen digits.
			id = `${randomInt(1, 10)}${String(randomInt(0, 1e8)).padStart(8, '0')}${String(randomInt(0, 1e7)).padStart(7, '0')}`
		} while (this.get(id))
		const media: StoredMedia = {
			id,
			phoneNumberId: input.phoneNumberId,
			mimeType: input.mimeType,
			sha256: createHash('sha256').update(input.bytes).digest('hex'),
			fileSize: input.bytes.byteLength,
			fileName: input.fileName,
			createdAt: new Date().toISOString(),
		}
		writeFileSync(join(this.dir, id), input.bytes)
		this.db
			.query(
				`INSERT INTO media (id, phone_number_id, mime_type, sha256, file_size, file_name, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				media.id,
				media.phoneNumberId,
				media.mimeType,
				media.sha256,
				media.fileSize,
				media.fileName,
				media.createdAt
			)
		return media
	}

	get(id: string): StoredMedia | undefined {
		const row = this.db
			.query<Row, [string]>(
				'SELECT * FROM media WHERE id = ? AND deleted_at IS NULL'
			)
			.get(id)
		return row ? toMedia(row) : undefined
	}

	/**
	 * Whether the id was ever a media, deleted or not: a deleted media is
	 * still a media id, and Meta answers it as an object that does not exist.
	 */
	known(id: string): boolean {
		return !!this.db.query('SELECT 1 FROM media WHERE id = ?').get(id)
	}

	/** The bytes of a media, or null when its file is gone. */
	bytes(id: string): Uint8Array | null {
		try {
			return readFileSync(join(this.dir, id))
		} catch {
			return null
		}
	}

	/** Delete the bytes; the row stays as a tombstone of the id. */
	remove(id: string): boolean {
		const removed = this.db
			.query(
				'UPDATE media SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL'
			)
			.run(new Date().toISOString(), id)
		rmSync(join(this.dir, id), { force: true })
		return removed.changes > 0
	}
}

export const mediaStore = new MediaStore()
