import { serveDir } from 'https://deno.land/std@0.224.0/http/file_server.ts'
import { dirname, fromFileUrl, join } from 'https://deno.land/std@0.224.0/path/mod.ts'
import { createNotificationsService } from './notifications_server.js'

const BASE_DIR = dirname(fromFileUrl(import.meta.url))
const notifications = await createNotificationsService()
const port = Number(Deno.env.get('PORT') ?? 8787)
const hostname = Deno.env.get('HOST') ?? '::'

Deno.serve({ port, hostname }, async (req) => {
  const url = new URL(req.url)
  if (req.method === 'GET' && url.pathname === '/sw.js') {
    const swPath = join(BASE_DIR, 'sw.js')
    const body = await Deno.readFile(swPath)
    const headers = new Headers({
      'content-type': 'text/javascript; charset=utf-8',
      'service-worker-allowed': '/',
      'cache-control': 'no-store',
    })
    return new Response(body, { headers })
  }
  const handled = await notifications.handleRequest(req)
  if (handled) return handled
  return serveDir(req, { quiet: true })
})
