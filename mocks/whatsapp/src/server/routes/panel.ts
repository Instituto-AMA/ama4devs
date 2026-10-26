import { Hono } from 'hono'
import { panelHtml } from '../ui/panel.ts'

const panelRouter = new Hono()

// GET / - Serve the inline web panel
panelRouter.get('/', (c) => c.html(panelHtml))

export { panelRouter }
