/**
 * The images of a payment link.
 *
 * A table of its own (and not a JSON inside `payment_links`) because the Asaas API
 * treats each image as a RESOURCE: it has its own id, is retrievable on its own,
 * removable on its own, and exactly one of them is the main one (`main`). Storing
 * that in a JSON array would turn "set the main image" into a read-modify-write of
 * the whole link — and two concurrent requests would lose one of the images.
 */
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { bool, datetime } from './_conventions.ts'
import { paymentLinks } from './misc.ts'

export const paymentLinkImages = sqliteTable(
  'payment_link_images',
  {
    id: text('id').primaryKey(), // UUID
    paymentLinkId: text('payment_link_id')
      .notNull()
      .references(() => paymentLinks.id),
    /** Exactly one image per link is the main one. */
    main: bool('main').notNull(),
    originalName: text('original_name').notNull(),
    /** The file size in bytes. It is NOT money — that is why it has no Cents suffix. */
    size: integer('size', { mode: 'number' }).notNull(),
    extension: text('extension').notNull(),
    /** The opaque token that makes up the preview/download URLs, as in Asaas. */
    publicToken: text('public_token').notNull(),
    dateCreated: datetime('date_created').notNull(),
  },
  (t) => [index('payment_link_images_link_idx').on(t.paymentLinkId)],
)
