import nacl from './lib/nacl-fast-es.js'
import { decode } from './lib/base64.js'
import { convertPublicKey } from './lib/ed2curve.js'

const DB_NAME = 'inproto'
const STORE_NAME = 'keys'
const KEY_NAME = 'curve'

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function getStoredKey() {
  const db = await openDb()
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.get(KEY_NAME)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
}

async function setStoredKey(value) {
  const db = await openDb()
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    if (value) {
      store.put(value, KEY_NAME)
    } else {
      store.delete(KEY_NAME)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function decodeKey(value) {
  if (!value?.curveSecret || typeof value.curveSecret !== 'string') return null
  try {
    return decode(value.curveSecret)
  } catch {
    return null
  }
}

function decryptPayload(payload, curveSecret) {
  const from = typeof payload.from === 'string' ? payload.from : ''
  if (!from) return null
  let senderCurve
  try {
    senderCurve = convertPublicKey(decode(from))
  } catch {
    return null
  }
  if (!senderCurve) return null
  const boxes = Array.isArray(payload.boxes) ? payload.boxes : []
  for (const entry of boxes) {
    if (!entry || typeof entry !== 'object') continue
    try {
      const nonce = decode(entry.nonce)
      const box = decode(entry.box)
      const opened = nacl.box.open(box, nonce, senderCurve, curveSecret)
      if (!opened) continue
      const text = new TextDecoder().decode(opened)
      return JSON.parse(text)
    } catch {
      continue
    }
  }
  return null
}

self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || typeof data !== 'object') return
  if (data.type === 'inproto:set-key') {
    event.waitUntil(setStoredKey({ pubkey: data.pubkey, curveSecret: data.curveSecret }))
  }
  if (data.type === 'inproto:clear-key') {
    event.waitUntil(setStoredKey(null))
  }
})

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload = null
    if (event.data) {
      try {
        payload = event.data.json()
      } catch {
        try {
          payload = JSON.parse(event.data.text())
        } catch {
          payload = null
        }
      }
    }
    if (!payload || payload.type !== 'dm') return

    const stored = await getStoredKey().catch(() => null)
    const curveSecret = decodeKey(stored)
    if (!curveSecret) return

    const message = decryptPayload(payload, curveSecret)
    if (!message || typeof message !== 'object') return

    const title = message.from
      ? `Message from ${message.from.substring(0, 10)}`
      : 'Inproto'
    const body = typeof message.body === 'string' ? message.body : 'New message'
    const targetUrl = typeof message.url === 'string' ? message.url : '/'
    const options = {
      body,
      data: { url: targetUrl },
      icon: payload.icon || '/dovepurple_sm.png',
    }

    await self.registration.showNotification(title, options)
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(target) && 'focus' in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(target)
      return undefined
    }),
  )
})
