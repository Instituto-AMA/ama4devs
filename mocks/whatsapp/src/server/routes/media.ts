/**
 * Media, as the Cloud API keeps it.
 *
 * - `POST /{phone-number-id}/media` takes the multipart upload Meta takes
 *   (`file`, `type`, `messaging_product`), checks the type and the size
 *   against Meta's limits and answers the media id;
 * - `GET /{media-id}` answers the URL, the type, the hash and the size;
 * - `DELETE /{media-id}` deletes it;
 * - the URL is served at `/whatsapp_business/attachments/?mid=…`, the path
 *   Meta's download URLs have, and wants the access token like Meta's.
 *
 * The panel reads the bytes at `/settings/media/{id}` (no token: it is the
 * mock's own page).
 */
import type { Context } from 'hono'
import { Hono } from 'hono'
import { graphError, invalidParameter, unknownObject } from '../graph-error.ts'
import {
	type MediaStore,
	mediaKindOf,
	type StoredMedia,
} from '../store/media-store.ts'

/** The extension Meta's URL carries, from the media type. */
function extensionOf(mimeType: string): string {
	const sub = mimeType.split('/')[1]?.split(';')[0] ?? 'bin'
	return sub === 'jpeg' ? 'jpg' : sub.replace(/^vnd\..*$/, 'bin')
}

/** Where the media can be downloaded, on this mock's address. */
export function mediaUrl(origin: string, media: StoredMedia): string {
	return `${origin}/whatsapp_business/attachments/?mid=${media.id}&ext=${extensionOf(media.mimeType)}&hash=${media.sha256.slice(0, 16)}`
}

function describeMedia(c: Context, media: StoredMedia) {
	return {
		messaging_product: 'whatsapp',
		url: mediaUrl(new URL(c.req.url).origin, media),
		mime_type: media.mimeType,
		sha256: media.sha256,
		file_size: String(media.fileSize),
		id: media.id,
	}
}

/** The bytes of a media, with its type and name. */
function serveBytes(c: Context, store: MediaStore, media: StoredMedia) {
	const bytes = store.bytes(media.id)
	if (!bytes) return unknownObject(c, media.id)
	return new Response(new Uint8Array(bytes), {
		headers: {
			'Content-Type': media.mimeType,
			'Content-Length': String(bytes.byteLength),
			...(media.fileName
				? {
						'Content-Disposition': `inline; filename="${media.fileName.replaceAll('"', '')}"`,
					}
				: {}),
		},
	})
}

/** The Cloud API calls, mounted under the version beside the other nodes. */
export function createMediaRouter(store: MediaStore) {
	const router = new Hono()

	router.post('/:phoneNumberId/media', async (c) => {
		const { phoneNumberId } = c.req.param()
		let form: FormData
		try {
			form = await c.req.formData()
		} catch {
			return invalidParameter(
				c,
				'The upload must be multipart/form-data with a file.'
			)
		}
		if (form.get('messaging_product') !== 'whatsapp') {
			return invalidParameter(c, 'messaging_product must be whatsapp.')
		}
		const file = form.get('file')
		if (!(file instanceof Blob)) return invalidParameter(c, 'file is required.')
		const mimeType = String(form.get('type') || file.type || '')
		const kind = mediaKindOf(mimeType)
		if (!kind) {
			return graphError(c, {
				message: `(#131053) Media upload error: ${mimeType || 'this type'} is not a media type the Cloud API supports.`,
				code: 131053,
			})
		}
		if (file.size > kind.max) {
			return graphError(c, {
				message: `(#131053) Media upload error: the ${kind.kind} is ${file.size} bytes, more than the ${kind.max} the Cloud API takes.`,
				code: 131053,
			})
		}
		const media = store.save({
			phoneNumberId,
			mimeType,
			fileName: file instanceof File && file.name ? file.name : null,
			bytes: new Uint8Array(await file.arrayBuffer()),
		})
		return c.json({ id: media.id })
	})

	// The engine sends a media id here; any other id goes on to the other nodes.
	router.get('/:id', async (c, next) => {
		const id = c.req.param('id')
		if (!store.known(id)) return next()
		const media = store.get(id)
		if (!media) return unknownObject(c, id)
		return c.json(describeMedia(c, media))
	})

	router.delete('/:id', async (c, next) => {
		const id = c.req.param('id')
		if (!store.known(id)) return next()
		if (!store.remove(id)) return unknownObject(c, id)
		return c.json({ success: true })
	})

	return router
}

/** Meta's download URL: the bytes, for whoever holds an access token. */
export function createMediaDownloadRouter(store: MediaStore) {
	const router = new Hono()
	router.get('/whatsapp_business/attachments/', (c) => {
		if (!/^Bearer\s+\S+/i.test(c.req.header('authorization') ?? '')) {
			return c.json(
				{
					error: {
						message: 'Invalid OAuth access token - Cannot parse access token',
						type: 'OAuthException',
						code: 190,
					},
				},
				401
			)
		}
		const media = store.get(c.req.query('mid') ?? '')
		if (!media) return unknownObject(c, c.req.query('mid') ?? '')
		return serveBytes(c, store, media)
	})
	return router
}

/** The panel's view of a media: the bytes, without a token. */
export function serveMediaForPanel(c: Context, store: MediaStore) {
	const media = store.get(c.req.param('id') ?? '')
	if (!media) return unknownObject(c, c.req.param('id') ?? '')
	return serveBytes(c, store, media)
}
