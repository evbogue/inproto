import { serveDir } from 'https://deno.land/std@0.224.0/http/file_server.ts'
import { createNotificationsService } from './notifications_server.js'

const notifications = await createNotificationsService()
const port = Number(Deno.env.get('PORT') ?? 8787)
const hostname = Deno.env.get('HOST') ?? '::'

Deno.serve({ port, hostname }, async (req) => {
  const handled = await notifications.handleRequest(req)
  if (handled) return handled
  return serveDir(req, { quiet: true })
})
