import { serveDir } from 'https://deno.land/std@0.224.0/http/file_server.ts'
import { dirname, fromFileUrl, join } from 'https://deno.land/std@0.224.0/path/mod.ts'
import { createNotificationsService } from './notifications_server.js'

const BASE_DIR = dirname(fromFileUrl(import.meta.url))
const notifications = await createNotificationsService()
const port = Number(Deno.env.get('PORT') ?? 8787)
const hostname = Deno.env.get('HOST') ?? '::'

Deno.serve({ port, hostname }, async (req) => {
  const url = new URL(req.url)
  if (req.method === 'GET') {
    const jsOverrides = new Map([
      ['/sw.js', { file: 'sw.js', sw: true }],
      ['/lib/nacl-fast-es.js', { file: 'lib/nacl-fast-es.js' }],
      ['/lib/base64.js', { file: 'lib/base64.js' }],
      ['/lib/ed2curve.js', { file: 'lib/ed2curve.js' }],
    ])
    const override = jsOverrides.get(url.pathname)
    if (override) {
      const filePath = join(BASE_DIR, override.file)
      const body = await Deno.readFile(filePath)
      const headers = new Headers({
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-store',
      })
      if (override.sw) headers.set('service-worker-allowed', '/')
      return new Response(body, { headers })
    }
  }
  const handled = await notifications.handleRequest(req)
  if (handled) return handled
  return serveDir(req, { quiet: true })
})
