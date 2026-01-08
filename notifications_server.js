import webpush from 'npm:web-push@3.6.7'
import { apds } from 'https://esm.sh/gh/evbogue/apds@d9326cb/apds.js'
import { dirname, fromFileUrl, join } from 'https://deno.land/std@0.224.0/path/mod.ts'
import nacl from './lib/nacl-fast-es.js'
import { decode } from './lib/base64.js'
import { an } from './an.js'

const BASE_DIR = dirname(fromFileUrl(import.meta.url))
const DATA_DIR = join(BASE_DIR, 'data')

const DEFAULTS = {
  latestUrl: 'https://pub.wiredove.net/latest',
  pollMs: 15000,
  dataDir: DATA_DIR,
  subsFile: join(DATA_DIR, 'subscriptions.json'),
  stateFile: join(DATA_DIR, 'state.json'),
  configFile: join(BASE_DIR, 'config.json'),
  vapidSubject: 'mailto:ops@wiredove.net',
  pushIconUrl: '/dovepurple_sm.png',
  apdsCache: 'inproto',
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000
const challenges = new Map()

function pruneChallenges(now = Date.now()) {
  for (const [challenge, entry] of challenges.entries()) {
    if (entry.expiresAt <= now) challenges.delete(challenge)
  }
}

function issueChallenge(pubkey) {
  pruneChallenges()
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const challenge = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  const now = Date.now()
  challenges.set(challenge, {
    pubkey,
    issuedAt: now,
    expiresAt: now + CHALLENGE_TTL_MS,
  })
  return { challenge, issuedAt: now }
}

function consumeChallenge(pubkey, challenge) {
  pruneChallenges()
  const entry = challenges.get(challenge)
  if (!entry) return false
  if (entry.pubkey !== pubkey) return false
  if (entry.expiresAt <= Date.now()) return false
  challenges.delete(challenge)
  return true
}

function openSignedMessage(signature) {
  if (!signature || signature.length < 45) return null
  const pub = signature.substring(0, 44)
  const signed = signature.substring(44)
  const opened = nacl.sign.open(decode(signed), decode(pub))
  if (!opened) return null
  const message = new TextDecoder().decode(opened)
  return { pub, message }
}

function verifyChallengeSignature(pubkey, signature, challenge) {
  const opened = openSignedMessage(signature)
  if (!opened) return false
  if (opened.pub !== pubkey) return false
  return opened.message.endsWith(challenge)
}

async function readJsonFile(path, fallback) {
  try {
    const raw = await Deno.readTextFile(path)
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

async function writeJsonFile(path, value) {
  const raw = JSON.stringify(value, null, 2)
  await Deno.writeTextFile(path, raw)
}

async function ensureVapidConfig(configPath, subject) {
  const fallback = {
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: subject,
  }
  const config = await readJsonFile(configPath, fallback)

  if (!config.vapidPublicKey || !config.vapidPrivateKey) {
    const keys = webpush.generateVAPIDKeys()
    const nextConfig = {
      vapidPublicKey: keys.publicKey,
      vapidPrivateKey: keys.privateKey,
      vapidSubject: config.vapidSubject || subject,
    }
    await writeJsonFile(configPath, nextConfig)
    return nextConfig
  }

  if (!config.vapidSubject) {
    config.vapidSubject = subject
    await writeJsonFile(configPath, config)
  }

  return config
}

function subscriptionId(endpoint) {
  return btoa(endpoint).replaceAll('=', '')
}

async function hashText(text) {
  const data = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(digest)
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

async function parsePostText(text) {
  if (!text || typeof text !== 'string') return {}

  const raw = text.trim()
  let yamlBlock = ''
  let bodyText = ''

  if (raw.startsWith('---')) {
    const lines = raw.split('\n')
    const endIndex = lines.indexOf('---', 1)
    if (endIndex !== -1) {
      yamlBlock = lines.slice(1, endIndex).join('\n')
      bodyText = lines.slice(endIndex + 1).join('\n')
    }
  }

  let name
  let yamlBody
  try {
    const parsed = await apds.parseYaml(raw)
    if (parsed && typeof parsed === 'object') {
      name = typeof parsed.name === 'string' ? parsed.name.trim() : undefined
      yamlBody = typeof parsed.body === 'string' ? parsed.body.trim() : undefined
    }
  } catch {
    if (yamlBlock) {
      try {
        const parsed = await apds.parseYaml(yamlBlock)
        if (parsed && typeof parsed === 'object') {
          name = typeof parsed.name === 'string' ? parsed.name.trim() : undefined
          yamlBody = typeof parsed.body === 'string' ? parsed.body.trim() : undefined
        }
      } catch {
        // Fall back to raw body if YAML parsing fails.
      }
    }
  }

  const body = bodyText.trim() || (yamlBody || '').trim()

  return {
    name: name || undefined,
    body: body || undefined,
  }
}

function formatPushTitle(name, author) {
  const authorLabel = name || (author ? author.substring(0, 10) : 'Someone')
  return authorLabel
}

function formatPushBody(body) {
  if (body && body.trim()) return body.trim()
  return 'Tap to view the latest update'
}

async function toPushPayload(latest, pushIconUrl) {
  const record = latest && typeof latest === 'object' ? latest : null
  const hash = record && typeof record.hash === 'string' ? record.hash : ''
  const targetUrl = hash ? `https://wiredove.net/#${hash}` : 'https://wiredove.net/'
  const rawText = record && typeof record.text === 'string' ? record.text : ''
  const parsed = rawText ? await parsePostText(rawText) : {}
  const bodyText = parsed.body || ''
  if (!bodyText.trim()) return null
  const title = formatPushTitle(parsed.name, record?.author)
  const body = formatPushBody(bodyText)
  return JSON.stringify({
    title,
    body,
    url: targetUrl,
    hash,
    icon: pushIconUrl,
    latest,
  })
}

function summarizeLatest(record) {
  const text = typeof record.text === 'string' ? record.text : ''
  const preview = text.length > 400 ? `${text.slice(0, 400)}…` : text
  return {
    hash: typeof record.hash === 'string' ? record.hash : undefined,
    author: typeof record.author === 'string' ? record.author : undefined,
    ts: typeof record.ts === 'string' ? record.ts : undefined,
    textPreview: preview || undefined,
  }
}

export async function createNotificationsService(options = {}) {
  const settings = {
    latestUrl: Deno.env.get('LATEST_URL') ?? DEFAULTS.latestUrl,
    pollMs: Number(Deno.env.get('POLL_MS') ?? DEFAULTS.pollMs),
    dataDir: DEFAULTS.dataDir,
    subsFile: DEFAULTS.subsFile,
    stateFile: DEFAULTS.stateFile,
    configFile: Deno.env.get('VAPID_CONFIG_PATH') ?? DEFAULTS.configFile,
    vapidSubject: Deno.env.get('VAPID_SUBJECT') ?? DEFAULTS.vapidSubject,
    pushIconUrl: Deno.env.get('PUSH_ICON_URL') ?? DEFAULTS.pushIconUrl,
    apdsCache: Deno.env.get('APDS_CACHE') ?? DEFAULTS.apdsCache,
    ...options,
  }

  await Deno.mkdir(settings.dataDir, { recursive: true })
  await apds.start(settings.apdsCache)

  const config = await ensureVapidConfig(settings.configFile, settings.vapidSubject)
  webpush.setVapidDetails(
    config.vapidSubject,
    config.vapidPublicKey,
    config.vapidPrivateKey,
  )

  async function loadSubscriptions() {
    return await readJsonFile(settings.subsFile, [])
  }

  async function saveSubscriptions(subs) {
    await writeJsonFile(settings.subsFile, subs)
  }

  async function loadState() {
    return await readJsonFile(settings.stateFile, {})
  }

  async function saveState(state) {
    await writeJsonFile(settings.stateFile, state)
  }

  async function pollLatest(force = false) {
    try {
      const res = await fetch(settings.latestUrl, { cache: 'no-store' })
      if (!res.ok) {
        console.error(`Latest fetch failed: ${res.status}`)
        return { changed: false, sent: false, reason: 'latest fetch failed' }
      }
      const bodyText = await res.text()
      if (!bodyText.trim()) {
        return { changed: false, sent: false, reason: 'empty response' }
      }

      let latestId = ''
      let latestJson = bodyText
      let latestRecord = null

      try {
        latestJson = JSON.parse(bodyText)
        if (Array.isArray(latestJson)) {
          if (latestJson.length === 0) {
            return { changed: false, sent: false, reason: 'empty response' }
          }
          const sorted = [...latestJson]
            .filter((item) => item && typeof item === 'object')
            .sort((a, b) => {
              const at = Number(a.ts ?? a.timestamp ?? 0)
              const bt = Number(b.ts ?? b.timestamp ?? 0)
              if (!Number.isNaN(bt - at)) return bt - at
              return 0
            })
          latestRecord = sorted[0] ?? null
        } else if (latestJson && typeof latestJson === 'object') {
          latestRecord = latestJson
        }

        if (latestRecord) {
          const candidate =
            latestRecord.hash ??
            latestRecord.sig ??
            latestRecord.id ??
            latestRecord.timestamp ??
            latestRecord.ts
          if (typeof candidate === 'string' || typeof candidate === 'number') {
            latestId = String(candidate)
          }
        }
      } catch {
        // Non-JSON is allowed; fallback to hashing.
      }

      const state = await loadState()
      const latestHash = latestId ? '' : await hashText(bodyText)
      const latestSummary = latestRecord ? summarizeLatest(latestRecord) : undefined

      const isNew = latestId
        ? latestId !== state.lastSeenId
        : latestHash !== state.lastSeenHash

      if (!isNew && !force) {
        return {
          changed: false,
          sent: false,
          reason: 'no new messages',
          latest: latestSummary,
        }
      }

      if (isNew) {
        await saveState({
          lastSeenId: latestId || undefined,
          lastSeenHash: latestHash || undefined,
        })
      }

      const subs = await loadSubscriptions()
      if (subs.length === 0) {
        return {
          changed: true,
          sent: false,
          reason: 'no subscriptions',
          latest: latestSummary,
        }
      }

      const payload = await toPushPayload(latestRecord ?? latestJson, settings.pushIconUrl)
      if (!payload) {
        return {
          changed: false,
          sent: false,
          reason: 'no content',
          latest: latestSummary,
        }
      }
      const now = new Date().toISOString()
      const nextSubs = []

      for (const sub of subs) {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: sub.keys,
            },
            payload,
          )
          nextSubs.push({ ...sub, lastNotifiedAt: now })
        } catch (err) {
          const status = err && typeof err === 'object' ? err.statusCode : undefined
          if (status === 404 || status === 410) {
            console.warn(`Removing expired subscription: ${sub.id}`)
            continue
          }
          console.error(`Push failed for ${sub.id}`, err)
          nextSubs.push(sub)
        }
      }

      await saveSubscriptions(nextSubs)
      return { changed: true, sent: true, latest: latestSummary }
    } catch (err) {
      console.error('Poll error', err)
      return { changed: false, sent: false, reason: 'poll error' }
    }
  }

  async function handleRequest(req) {
    const url = new URL(req.url)

    if (req.method === 'GET' && url.pathname === '/vapid-public-key') {
      return Response.json({ key: config.vapidPublicKey })
    }

    if (req.method === 'GET' && url.pathname === '/peers') {
      const pubkey = url.searchParams.get('pubkey')
      if (!pubkey) {
        return Response.json({ error: 'missing pubkey' }, { status: 400 })
      }
      const subs = await loadSubscriptions()
      const peers = []
      const seen = new Set()
      for (const sub of subs) {
        if (sub.userPubKey !== pubkey) continue
        const target = typeof sub.targetPubKey === 'string'
          ? sub.targetPubKey.trim()
          : ''
        if (!target || seen.has(target)) continue
        seen.add(target)
        peers.push(target)
      }
      return Response.json({ peers })
    }

    if (req.method === 'GET' && url.pathname === '/messages') {
      const pubkey = url.searchParams.get('pubkey')
      if (!pubkey) {
        return Response.json({ error: 'missing pubkey' }, { status: 400 })
      }
      let log = []
      try {
        log = await apds.getOpenedLog()
      } catch (err) {
        console.error('apds getOpenedLog failed', err)
        return Response.json({ error: 'apds unavailable' }, { status: 503 })
      }

      const messages = []
      for (const entry of log) {
        if (!entry || typeof entry.text !== 'string') continue
        let parsed
        try {
          parsed = JSON.parse(entry.text)
        } catch {
          continue
        }
        if (parsed?.type !== 'dm') continue
        if (parsed?.to !== pubkey) continue
        messages.push({
          hash: entry.hash,
          sig: entry.sig,
          author: entry.author,
          ts: parsed.ts ?? entry.ts,
          human: await apds.human(parsed.ts ?? entry.ts),
          from: parsed.from ?? entry.author,
          to: parsed.to,
          body: parsed.body,
        })
      }

      return Response.json({ messages })
    }

    if (req.method === 'GET' && url.pathname === '/messages/sent') {
      const pubkey = url.searchParams.get('pubkey')
      if (!pubkey) {
        return Response.json({ error: 'missing pubkey' }, { status: 400 })
      }
      let log = []
      try {
        log = await apds.getOpenedLog()
      } catch (err) {
        console.error('apds getOpenedLog failed', err)
        return Response.json({ error: 'apds unavailable' }, { status: 503 })
      }

      const messages = []
      for (const entry of log) {
        if (!entry || typeof entry.text !== 'string') continue
        if (entry.author !== pubkey) continue
        let parsed
        try {
          parsed = JSON.parse(entry.text)
        } catch {
          continue
        }
        if (parsed?.type !== 'dm') continue
        messages.push({
          hash: entry.hash,
          sig: entry.sig,
          author: entry.author,
          ts: parsed.ts ?? entry.ts,
          human: await apds.human(parsed.ts ?? entry.ts),
          from: parsed.from ?? entry.author,
          to: parsed.to,
          body: parsed.body,
        })
      }

      return Response.json({ messages })
    }

    if (req.method === 'GET' && url.pathname === '/subscribe/challenge') {
      const pubkey = url.searchParams.get('pubkey')
      if (!pubkey) {
        return Response.json({ error: 'missing pubkey' }, { status: 400 })
      }
      const issued = issueChallenge(pubkey)
      return Response.json(issued)
    }

    if (req.method === 'POST' && url.pathname === '/subscribe') {
      const body = await req.json().catch(() => null)
      if (!body || typeof body !== 'object') {
        return Response.json({ error: 'invalid subscription' }, { status: 400 })
      }

      const sub = body.subscription ?? body
      const userPubKey = body.userPubKey
      const targetPubKey = body.targetPubKey || userPubKey
      const challenge = body.challenge
      const signature = body.signature
      if (!userPubKey) {
        return Response.json({ error: 'missing pubkey' }, { status: 400 })
      }
      if (!challenge || !signature) {
        return Response.json({ error: 'missing proof' }, { status: 400 })
      }
      if (!consumeChallenge(userPubKey, challenge)) {
        return Response.json({ error: 'invalid challenge' }, { status: 400 })
      }
      if (!verifyChallengeSignature(userPubKey, signature, challenge)) {
        return Response.json({ error: 'invalid signature' }, { status: 400 })
      }
      if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
        return Response.json({ error: 'missing fields' }, { status: 400 })
      }

      const subs = await loadSubscriptions()
      const id = subscriptionId(sub.endpoint)
      const existing = subs.find((item) => item.id === id)
      if (!existing) {
        subs.push({
          id,
          endpoint: sub.endpoint,
          keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
          userPubKey,
          targetPubKey,
          createdAt: new Date().toISOString(),
        })
        await saveSubscriptions(subs)
      } else if (
        existing.userPubKey !== userPubKey ||
        existing.targetPubKey !== targetPubKey
      ) {
        existing.userPubKey = userPubKey
        existing.targetPubKey = targetPubKey
        await saveSubscriptions(subs)
      }

      return new Response('ok', { status: 200 })
    }

    if (req.method === 'POST' && url.pathname === '/unsubscribe') {
      const body = await req.json().catch(() => null)
      const endpoint = body?.endpoint
      if (!endpoint) {
        return Response.json({ error: 'missing endpoint' }, { status: 400 })
      }

      const subs = await loadSubscriptions()
      const id = subscriptionId(endpoint)
      const nextSubs = subs.filter((item) => item.id !== id)
      if (nextSubs.length !== subs.length) await saveSubscriptions(nextSubs)

      return new Response('ok', { status: 200 })
    }

    if (req.method === 'POST' && url.pathname === '/poll-now') {
      const result = await pollLatest()
      return Response.json(result)
    }

    if (req.method === 'POST' && url.pathname === '/push-latest') {
      const result = await pollLatest(true)
      return Response.json(result)
    }

    if (req.method === 'POST' && url.pathname === '/message') {
      const body = await req.json().catch(() => null)
      if (!body || typeof body !== 'object') {
        return Response.json({ error: 'invalid payload' }, { status: 400 })
      }

      const sig = typeof body.sig === 'string' ? body.sig : ''
      const payloadText = typeof body.body === 'string' ? body.body : ''
      if (!sig || !payloadText) {
        return Response.json({ error: 'missing sig or body' }, { status: 400 })
      }

      const opened = await an.open(sig)
      if (!opened) {
        return Response.json({ error: 'invalid signature' }, { status: 400 })
      }
      const expectedHash = opened.substring(13)
      const payloadHash = await an.hash(payloadText)
      if (expectedHash !== payloadHash) {
        return Response.json({ error: 'hash mismatch' }, { status: 400 })
      }

      let messagePayload
      try {
        messagePayload = JSON.parse(payloadText)
      } catch {
        return Response.json({ error: 'invalid body json' }, { status: 400 })
      }

      const author = sig.substring(0, 44)
      if (messagePayload.from && messagePayload.from !== author) {
        return Response.json({ error: 'author mismatch' }, { status: 400 })
      }

      const targetPubKey = messagePayload.to
      if (!targetPubKey) {
        return Response.json({ error: 'missing target' }, { status: 400 })
      }

      const title = author
      const message =
        typeof messagePayload.body === 'string' ? messagePayload.body : ''
      if (!message.trim()) {
        return Response.json({ error: 'missing body' }, { status: 400 })
      }

      const urlValue = `/#${author}`
      const pushPayload = JSON.stringify({
        title,
        body: message,
        url: urlValue,
        icon: settings.pushIconUrl,
      })

      try {
        await apds.put(payloadHash, payloadText)
        await apds.add(sig)
      } catch (err) {
        console.error('apds store failed', err)
      }

      const subs = await loadSubscriptions()
      const targets = subs.filter((sub) => sub.targetPubKey === targetPubKey)
      if (targets.length === 0) {
        return Response.json({ error: 'no subscriptions' }, { status: 404 })
      }

      let sent = 0
      const now = new Date().toISOString()
      const nextSubs = []

      for (const sub of subs) {
        if (sub.targetPubKey !== targetPubKey) {
          nextSubs.push(sub)
          continue
        }

        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: sub.keys,
            },
            pushPayload,
          )
          sent += 1
          nextSubs.push({ ...sub, lastNotifiedAt: now })
        } catch (err) {
          const status = err && typeof err === 'object' ? err.statusCode : undefined
          if (status === 404 || status === 410) {
            console.warn(`Removing expired subscription: ${sub.id}`)
            continue
          }
          console.error(`Push failed for ${sub.id}`, err)
          nextSubs.push(sub)
        }
      }

      await saveSubscriptions(nextSubs)
      return Response.json({ sent, targetPubKey })
    }

    return null
  }

  function startPolling() {
    console.log(`Polling ${settings.latestUrl} every ${settings.pollMs}ms`)
    pollLatest()
    setInterval(() => {
      pollLatest()
    }, settings.pollMs)
  }

  return {
    config,
    handleRequest,
    pollLatest,
    startPolling,
  }
}
