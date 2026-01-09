self.cryptoModulesPromise = null

function swLog(step, data) {
  try {
    if (data !== undefined) {
      console.log(`[inproto-sw] ${step}`, data)
    } else {
      console.log(`[inproto-sw] ${step}`)
    }
  } catch {}
  if (!self.clients?.matchAll) return
  self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((clients) => {
      for (const client of clients) {
        try {
          client.postMessage({
            type: 'inproto:sw-log',
            step,
            data,
            ts: Date.now(),
          })
        } catch {}
      }
    })
    .catch(() => {})
}

function loadCryptoModules() {
  swLog('loadCryptoModules:start')
  if (!self.cryptoModulesPromise) {
    self.cryptoModulesPromise = Promise.all([
      import('./lib/nacl-fast-es.js'),
      import('./lib/base64.js'),
      import('./lib/ed2curve.js'),
    ]).then(([naclMod, base64Mod, ed2curveMod]) => ({
      nacl: naclMod.default ?? naclMod,
      decode: base64Mod.decode,
      convertPublicKey: ed2curveMod.convertPublicKey,
    }))
  }
  return self.cryptoModulesPromise.then((mods) => {
    swLog('loadCryptoModules:ready')
    return mods
  })
}

const DB_NAME = 'inproto'
const STORE_NAME = 'keys'
const KEY_NAME = 'curve'

function openDb() {
  swLog('openDb:start', { db: DB_NAME, store: STORE_NAME })
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      swLog('openDb:onupgradeneeded')
      request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => {
      swLog('openDb:success')
      resolve(request.result)
    }
    request.onerror = () => {
      swLog('openDb:error', request.error)
      reject(request.error)
    }
  })
}

async function getStoredKey() {
  swLog('getStoredKey:start')
  const db = await openDb()
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.get(KEY_NAME)
    req.onsuccess = () => {
      swLog('getStoredKey:success', { hasValue: Boolean(req.result) })
      resolve(req.result || null)
    }
    req.onerror = () => {
      swLog('getStoredKey:error', req.error)
      reject(req.error)
    }
  })
}

async function setStoredKey(value) {
  swLog('setStoredKey:start', { hasValue: Boolean(value) })
  const db = await openDb()
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    if (value) {
      store.put(value, KEY_NAME)
    } else {
      store.delete(KEY_NAME)
    }
    tx.oncomplete = () => {
      swLog('setStoredKey:complete')
      resolve()
    }
    tx.onerror = () => {
      swLog('setStoredKey:error', tx.error)
      reject(tx.error)
    }
  })
}

async function decodeKey(value) {
  if (!value?.curveSecret || typeof value.curveSecret !== 'string') {
    swLog('decodeKey:missing')
    return null
  }
  try {
    const { decode } = await loadCryptoModules()
    const decoded = decode(value.curveSecret)
    swLog('decodeKey:success')
    return decoded
  } catch (err) {
    swLog('decodeKey:error', {
      message: err instanceof Error ? err.message : String(err),
      curveSecretLength: value.curveSecret.length,
    })
    return null
  }
}

async function decryptPayload(payload, curveSecret) {
  swLog('decryptPayload:start')
  const { nacl, decode, convertPublicKey } = await loadCryptoModules()
  const from = typeof payload.from === 'string' ? payload.from : ''
  if (!from) {
    swLog('decryptPayload:missing-from')
    return null
  }
  let senderCurve
  try {
    senderCurve = convertPublicKey(decode(from))
  } catch {
    swLog('decryptPayload:bad-from')
    return null
  }
  if (!senderCurve) {
    swLog('decryptPayload:convert-failed')
    return null
  }
  const boxes = Array.isArray(payload.boxes) ? payload.boxes : []
  swLog('decryptPayload:boxes', { count: boxes.length })
  for (const entry of boxes) {
    if (!entry || typeof entry !== 'object') continue
    try {
      const nonce = decode(entry.nonce)
      const box = decode(entry.box)
      const opened = nacl.box.open(box, nonce, senderCurve, curveSecret)
      if (!opened) continue
      const text = new TextDecoder().decode(opened)
      const parsed = JSON.parse(text)
      swLog('decryptPayload:success')
      return parsed
    } catch {
      continue
    }
  }
  swLog('decryptPayload:failed')
  return null
}

self.addEventListener('message', (event) => {
  const data = event.data
  swLog('message:event', { hasData: Boolean(data) })
  if (!data || typeof data !== 'object') {
    swLog('message:invalid')
    return
  }
  if (data.type === 'inproto:set-key') {
    swLog('message:set-key', {
      pubkey: data.pubkey,
      curveSecret: data.curveSecret,
    })
    event.waitUntil(setStoredKey({ pubkey: data.pubkey, curveSecret: data.curveSecret }))
  }
  if (data.type === 'inproto:clear-key') {
    swLog('message:clear-key')
    event.waitUntil(setStoredKey(null))
  }
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    swLog('activate:start')
    if (self.clients?.claim) {
      await self.clients.claim()
    }
    if (!self.clients?.matchAll) return
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clients) {
      try {
        client.postMessage({ type: 'inproto:request-key' })
        swLog('activate:request-key', { client: client.url })
      } catch {
        continue
      }
    }
    swLog('activate:done')
  })())
})

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    swLog('push:start')
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

    if (!payload) {
      swLog('push:no-payload')
      return
    }
    swLog('push:payload', payload)
    if (payload.type !== 'dm') {
      swLog('push:ignored', { type: payload.type })
      return
    }

    const stored = await getStoredKey().catch(() => null)
    const curveSecret = await decodeKey(stored)
    if (!curveSecret) {
      swLog('push:no-curve-secret')
      return
    }

    const message = await decryptPayload(payload, curveSecret)
    if (!message || typeof message !== 'object') {
      swLog('push:bad-message')
      return
    }
    swLog('push:decrypted', message)
    if (typeof message.body !== 'string' || !message.body.trim()) {
      swLog('push:empty-body')
      return
    }
    if (message.body.trim() === 'undefined') {
      swLog('push:undefined-body')
      return
    }

    const senderPubkey = typeof message.from === 'string' ? message.from : payload.from
    const title = senderPubkey || 'Inproto'
    const body = message.body
    const targetUrl = typeof message.url === 'string' ? message.url : '/'
    const options = {
      body,
      data: { url: targetUrl, message },
      icon: payload.icon || '/dovepurple_sm.png',
    }

    swLog('push:show-notification', { title, targetUrl })
    await self.registration.showNotification(title, options)
    swLog('push:shown')
  })())
})

self.addEventListener('notificationclick', (event) => {
  swLog('notificationclick:start')
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
