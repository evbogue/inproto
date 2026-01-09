import { an } from './an.js'
import { notificationsButton } from './notifications.js'
import nacl from './lib/nacl-fast-es.js'
import { decode, encode } from './lib/base64.js'
import { convertPublicKey, convertSecretKey } from './lib/ed2curve.js'

const generateButton = document.getElementById('generate')
const clearButton = document.getElementById('clear-keys')
const keyStatus = document.getElementById('key-status')
const ownPubkey = document.getElementById('own-pubkey')
const combinedKeyArea = document.getElementById('combined-key')
const keySection = document.getElementById('key-section')
const profileSection = document.getElementById('profile-section')
const pushSection = document.getElementById('push-section')
const routeRoot = document.getElementById('route-root')
const profilePubkey = document.getElementById('profile-pubkey')
const qrToggle = document.getElementById('qr-toggle')
const targetStatus = document.getElementById('target-status')
const pushBodyInput = document.getElementById('push-body')
const sendPushButton = document.getElementById('send-push')
const sendStatus = document.getElementById('send-status')
const inboxSection = document.getElementById('inbox-section')
const inboxStatus = document.getElementById('inbox-status')
const inboxList = document.getElementById('inbox-list')
const swSelftestButton = document.getElementById('sw-selftest')
const swSelftestStatus = document.getElementById('sw-selftest-status')
let pushButton = null
const storageKeys = {
  keypair: 'inproto:keypair',
  publicKey: 'inproto:publicKey',
}
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function setKeyStatus(text) {
  keyStatus.textContent = text
}

function setOwnPubkey(text) {
  ownPubkey.textContent = text
}

function setSwSelftestStatus(text) {
  if (swSelftestStatus) swSelftestStatus.textContent = text || ''
}

function getStoredKeypair() {
  return localStorage.getItem(storageKeys.keypair)
}

function getStoredPublicKey() {
  const combined = getStoredKeypair()
  if (!combined) return null
  return localStorage.getItem(storageKeys.publicKey) || combined.slice(0, 44)
}

function getEdSecretKeyBytes() {
  const combined = getStoredKeypair()
  if (!combined) return null
  try {
    return decode(combined.slice(44))
  } catch {
    return null
  }
}

function getCurveSecretKey() {
  const secret = getEdSecretKeyBytes()
  if (!secret) return null
  return convertSecretKey(secret)
}

function getCurvePublicKey(pubkey) {
  if (!pubkey) return null
  try {
    const edBytes = decode(pubkey)
    return convertPublicKey(edBytes)
  } catch {
    return null
  }
}

async function syncServiceWorkerKey() {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.ready.catch((err) => {
    console.warn('service worker ready failed', err)
    return null
  })
  if (!registration?.active) return
  const pubkey = getStoredPublicKey()
  const curveSecret = getCurveSecretKey()
  if (!pubkey || !curveSecret) {
    registration.active.postMessage({ type: 'inproto:clear-key' })
    return
  }
  try {
    registration.active.postMessage({
      type: 'inproto:set-key',
      pubkey,
      curveSecret: encode(curveSecret),
    })
  } catch (err) {
    console.warn('service worker key sync failed', err)
  }
}

async function refreshServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration().catch((err) => {
    console.warn('service worker registration lookup failed', err)
    return null
  })
  if (registration) {
    await registration.update().catch((err) => {
      console.warn('service worker update failed', err)
    })
    return
  }
  try {
    await navigator.serviceWorker.register('/sw.js', { type: 'module' })
    console.log('service worker registered')
  } catch (err) {
    console.error('service worker register failed', err)
  }
}

function ensureServiceWorkerKeySync() {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.ready.then(() => {
    syncServiceWorkerKey().catch(() => {})
  }).catch(() => {})
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    syncServiceWorkerKey().catch(() => {})
  })
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data
    if (!data || typeof data !== 'object') return
    if (data.type === 'inproto:request-key') {
      syncServiceWorkerKey().catch(() => {})
    }
    if (data.type === 'inproto:sw-log') {
      if (data.data !== undefined) {
        console.log(`[inproto-sw] ${data.step}`, data.data)
      } else {
        console.log(`[inproto-sw] ${data.step}`)
      }
    }
    if (data.type === 'inproto:selftest-result') {
      if (data.data?.ok) {
        setSwSelftestStatus('self-test ok')
      } else {
        setSwSelftestStatus(data.data?.detail || 'self-test failed')
      }
    }
  })
}

function formatRelativeTime(tsValue) {
  const ts = Number(tsValue)
  if (!Number.isFinite(ts)) return 'unknown time'
  let diff = Math.max(0, Date.now() - ts)
  const seconds = Math.round(diff / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.round(days / 7)
  if (weeks < 5) return `${weeks}w`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo`
  const years = Math.round(days / 365)
  return `${years}y`
}

function buildShareUrl(pubkey) {
  if (!pubkey) return ''
  return `${window.location.origin}${window.location.pathname}#${pubkey}`
}

let lastQrValue = ''
let qrContainer = null
let qrCanvas = null

function ensureQrCanvas(value) {
  if (!qrCanvas) {
    qrCanvas = document.createElement('canvas')
    qrCanvas.id = 'qr-canvas'
  }
  if (!value || value === lastQrValue) return
  if (typeof QRious !== 'function') {
    console.error('QRious is not loaded')
    return
  }
  const size = 200
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1))
  qrCanvas.width = size * dpr
  qrCanvas.height = size * dpr
  qrCanvas.style.width = `${size}px`
  qrCanvas.style.height = `${size}px`
  new QRious({
    element: qrCanvas,
    value,
    size: size * dpr,
    background: '#fff',
    foreground: '#1c1c1c',
  })
  lastQrValue = value
}

function openQr() {
  if (qrContainer) return
  qrContainer = document.createElement('div')
  qrContainer.id = 'qr-container'
  qrContainer.appendChild(qrCanvas)
  profileSection.appendChild(qrContainer)
}

function getRoute() {
  const hash = window.location.hash.replace(/^#/, '').trim()
  if (hash === 'key') return { type: 'key' }
  if (hash === 'inbox') return { type: 'inbox' }
  if (hash) return { type: 'profile', pubkey: hash }
  return { type: 'home' }
}

function getTargetPubKey() {
  const route = getRoute()
  if (route.type === 'profile') return route.pubkey
  if (route.type === 'home') return getStoredPublicKey()
  return null
}

function renderSections(sections) {
  routeRoot.classList.add('ready')
  routeRoot.replaceChildren(...sections)
  for (const section of sections) {
    section.classList.remove('route-view')
    void section.offsetWidth
    section.classList.add('route-view')
  }
}

function updateView() {
  const route = getRoute()
  if (route.type === 'key') {
    targetStatus.textContent = ''
    if (qrContainer) qrContainer.remove()
    qrContainer = null
    qrToggle.setAttribute('aria-expanded', 'false')
    renderSections([keySection])
    return
  }

  if (route.type === 'inbox') {
    targetStatus.textContent = ''
    if (qrContainer) qrContainer.remove()
    qrContainer = null
    qrToggle.setAttribute('aria-expanded', 'false')
    renderSections([inboxSection])
    loadInbox().catch((err) => {
      console.error(err)
      setInboxStatus('failed to load inbox')
    })
    return
  }

  const target = getTargetPubKey()
  if (!target) {
    targetStatus.textContent = 'no pubkey yet (generate one)'
    if (qrContainer) qrContainer.remove()
    qrContainer = null
    qrToggle.setAttribute('aria-expanded', 'false')
    renderSections([keySection])
    return
  }

  targetStatus.textContent = ''
  profilePubkey.textContent = target
  ensureQrCanvas(buildShareUrl(target))
  if (qrContainer) qrContainer.remove()
  qrContainer = null
  qrToggle.setAttribute('aria-expanded', 'false')
  renderSections([profileSection, pushSection])
}

function setInboxStatus(text) {
  inboxStatus.textContent = text
}

function renderMessagesList(listEl, messages) {
  listEl.replaceChildren()
  for (const item of messages) {
    const card = document.createElement('li')
    card.className = 'message-card'
    const meta = document.createElement('div')
    meta.className = 'message-meta'
    const tsValue = item.ts ?? item.receivedAt
    const ts = tsValue ? `${formatRelativeTime(tsValue)} ago` : 'unknown time'
    const from = item.from || 'unknown'
    const to = item.to || 'unknown'
    const metaLine1 = document.createElement('div')
    const metaLine1Prefix = document.createElement('span')
    metaLine1Prefix.className = 'meta-label'
    metaLine1Prefix.textContent = `${ts} • from `
    const fromLink = document.createElement('a')
    fromLink.href = from !== 'unknown' ? `#${from}` : '#'
    fromLink.textContent = from
    metaLine1.appendChild(metaLine1Prefix)
    metaLine1.appendChild(fromLink)
    const metaLine2 = document.createElement('div')
    const metaLine2Prefix = document.createElement('span')
    metaLine2Prefix.className = 'meta-label'
    metaLine2Prefix.textContent = 'to '
    const toLink = document.createElement('a')
    toLink.href = to !== 'unknown' ? `#${to}` : '#'
    toLink.textContent = to
    metaLine2.appendChild(metaLine2Prefix)
    metaLine2.appendChild(toLink)
    meta.appendChild(metaLine1)
    meta.appendChild(metaLine2)
    const body = document.createElement('div')
    body.className = 'message-body'
    body.textContent = item.body || ''
    card.appendChild(meta)
    card.appendChild(body)
    listEl.appendChild(card)
  }
}

function encryptMessage(messageText, recipientPubKey) {
  const curveSecret = getCurveSecretKey()
  const recipientCurve = getCurvePublicKey(recipientPubKey)
  if (!curveSecret || !recipientCurve) return null
  const nonce = nacl.randomBytes(24)
  const boxed = nacl.box(textEncoder.encode(messageText), nonce, recipientCurve, curveSecret)
  return { nonce: encode(nonce), box: encode(boxed) }
}

function decryptEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') return null
  const curveSecret = getCurveSecretKey()
  if (!curveSecret) return null
  const senderCurve = getCurvePublicKey(envelope.from)
  if (!senderCurve) return null
  const boxes = Array.isArray(envelope.boxes) ? envelope.boxes : []
  for (const entry of boxes) {
    if (!entry || typeof entry !== 'object') continue
    try {
      const nonce = decode(entry.nonce)
      const box = decode(entry.box)
      const opened = nacl.box.open(box, nonce, senderCurve, curveSecret)
      if (!opened) continue
      const text = textDecoder.decode(opened)
      const parsed = JSON.parse(text)
      return {
        ...parsed,
        from: parsed.from || envelope.from,
        receivedAt: envelope.receivedAt,
      }
    } catch {
      continue
    }
  }
  return null
}

async function fetchEncryptedMessages(url = '/messages') {
  const res = await fetch(url)
  if (!res.ok) return []
  const data = await res.json().catch(() => null)
  return Array.isArray(data?.messages) ? data.messages : []
}

async function loadInbox() {
  const pubkey = getStoredPublicKey()
  if (!pubkey) {
    setInboxStatus('generate a keypair first')
    renderMessagesList(inboxList, [])
    return
  }
  setInboxStatus('loading...')
  const encrypted = await fetchEncryptedMessages()
  const messages = []
  for (const envelope of encrypted) {
    const decrypted = decryptEnvelope(envelope)
    if (!decrypted) continue
    if (decrypted.to !== pubkey && decrypted.from !== pubkey) continue
    messages.push(decrypted)
  }
  messages.sort((a, b) => {
    const at = Number(a.ts ?? a.receivedAt ?? 0)
    const bt = Number(b.ts ?? b.receivedAt ?? 0)
    return bt - at
  })
  if (messages.length === 0) {
    setInboxStatus('no messages yet')
  } else {
    setInboxStatus('')
  }
  renderMessagesList(inboxList, messages)
}

function loadStoredKeys() {
  const combined = getStoredKeypair()
  if (!combined) {
    setOwnPubkey('no pubkey yet')
    syncServiceWorkerKey().catch(() => {})
    return
  }
  const publicKey = getStoredPublicKey()
  if (!publicKey) {
    setOwnPubkey('no pubkey yet')
    syncServiceWorkerKey().catch(() => {})
    return
  }
  localStorage.setItem(storageKeys.keypair, combined)
  localStorage.setItem(storageKeys.publicKey, publicKey)
  combinedKeyArea.value = combined
  setOwnPubkey(publicKey)
  setKeyStatus('loaded from localStorage')
  syncServiceWorkerKey().catch(() => {})
}

async function generateKeypair() {
  setKeyStatus('generating...')
  try {
    const combined = await an.gen()
    const publicKey = combined.slice(0, 44)
    localStorage.setItem(storageKeys.keypair, combined)
    localStorage.setItem(storageKeys.publicKey, publicKey)
    combinedKeyArea.value = combined
    setOwnPubkey(publicKey)
    setKeyStatus('ready (stored in localStorage)')
    syncServiceWorkerKey().catch(() => {})
  } catch (err) {
    console.error(err)
    setKeyStatus('failed to generate keypair')
  }
}

generateButton.addEventListener('click', generateKeypair)
clearButton.addEventListener('click', () => {
  localStorage.removeItem(storageKeys.keypair)
  localStorage.removeItem(storageKeys.publicKey)
  combinedKeyArea.value = ''
  setOwnPubkey('no pubkey yet')
  setKeyStatus('cleared localStorage')
  syncServiceWorkerKey().catch(() => {})
})
sendPushButton.addEventListener('click', async () => {
  const targetPubKey = getTargetPubKey()
  if (!targetPubKey) {
    sendStatus.textContent = 'no target pubkey set'
    return
  }
  const fromPubKey = getStoredPublicKey()
  const curveSecret = getCurveSecretKey()
  if (!fromPubKey || !curveSecret) {
    sendStatus.textContent = 'generate a keypair first'
    return
  }
  const body = pushBodyInput.value.trim()
  if (!body) {
    sendStatus.textContent = 'message body required'
    return
  }
  sendStatus.textContent = 'sending...'
  try {
    const payload = {
      type: 'dm',
      from: fromPubKey,
      to: targetPubKey,
      ts: Date.now(),
      body,
    }
    const payloadText = JSON.stringify(payload)
    const targetBox = encryptMessage(payloadText, targetPubKey)
    const selfBox = encryptMessage(payloadText, fromPubKey)
    if (!targetBox || !selfBox) {
      throw new Error('send failed: encryption error')
    }
    const res = await fetch('/message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from: fromPubKey,
        boxes: [targetBox, selfBox],
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(detail ? `send failed: ${detail}` : 'send failed')
    }
    sendStatus.textContent = 'sent'
  } catch (err) {
    console.error(err)
    sendStatus.textContent = err instanceof Error ? err.message : 'send failed'
  }
})
window.addEventListener('hashchange', updateView)
qrToggle.addEventListener('click', (event) => {
  event.preventDefault()
  const targetPubKey = getTargetPubKey()
  if (!targetPubKey) return
  const isOpen = !!qrContainer
  if (isOpen) {
    qrContainer.remove()
    qrContainer = null
    qrToggle.setAttribute('aria-expanded', 'false')
  } else {
    ensureQrCanvas(buildShareUrl(targetPubKey))
    openQr()
    qrToggle.setAttribute('aria-expanded', 'true')
  }
})
refreshServiceWorker().catch(() => {})
ensureServiceWorkerKeySync()
loadStoredKeys()
updateView()

const pushMount = document.getElementById('notifications-controls')
const notificationsStatus = document.getElementById('notifications-status')
pushButton = notificationsButton({
  className: 'icon-link',
  iconOn: 'notifications_active',
  iconOff: 'notifications',
  buttonEl: pushMount,
  vapidKeyUrl: '/vapid-public-key',
  subscribeUrl: '/subscribe',
  unsubscribeUrl: '/unsubscribe',
  titleOn: 'Notifications on',
  titleOff: 'Notifications off',
  onStatus: (text) => {
    if (notificationsStatus) notificationsStatus.textContent = text || ''
  },
})

if (swSelftestButton) {
  swSelftestButton.addEventListener('click', async () => {
    if (!('serviceWorker' in navigator)) {
      setSwSelftestStatus('service worker unsupported')
      return
    }
    setSwSelftestStatus('running...')
    const registration = await navigator.serviceWorker.ready.catch(() => null)
    if (!registration?.active) {
      setSwSelftestStatus('service worker not ready')
      return
    }
    registration.active.postMessage({ type: 'inproto:selftest' })
  })
}
