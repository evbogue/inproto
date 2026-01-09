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
const pushSection = document.getElementById('push-section')
const routeRoot = document.getElementById('route-root')
const targetPubkeyInput = document.getElementById('target-pubkey')
const pushBodyInput = document.getElementById('push-body')
const sendPushButton = document.getElementById('send-push')
const sendStatus = document.getElementById('send-status')
let pushButton = null
const storageKeys = {
  keypair: 'inproto:keypair',
  publicKey: 'inproto:publicKey',
}
const textEncoder = new TextEncoder()

function setKeyStatus(text) {
  keyStatus.textContent = text
}

function setOwnPubkey(text) {
  ownPubkey.textContent = text
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
  const registration = await navigator.serviceWorker.ready.catch(() => null)
  if (!registration?.active) return
  const pubkey = getStoredPublicKey()
  const curveSecret = getCurveSecretKey()
  if (!pubkey || !curveSecret) {
    registration.active.postMessage({ type: 'inproto:clear-key' })
    return
  }
  registration.active.postMessage({
    type: 'inproto:set-key',
    pubkey,
    curveSecret: encode(curveSecret),
  })
}

function getRoute() {
  const hash = window.location.hash.replace(/^#/, '').trim()
  if (hash === 'key') return { type: 'key' }
  return { type: 'home' }
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
    renderSections([keySection])
    return
  }
  renderSections([keySection, pushSection])
}

function encryptMessage(messageText, recipientPubKey) {
  const curveSecret = getCurveSecretKey()
  const recipientCurve = getCurvePublicKey(recipientPubKey)
  if (!curveSecret || !recipientCurve) return null
  const nonce = nacl.randomBytes(24)
  const boxed = nacl.box(textEncoder.encode(messageText), nonce, recipientCurve, curveSecret)
  return { nonce: encode(nonce), box: encode(boxed) }
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
  const targetPubKey = targetPubkeyInput?.value.trim()
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
loadStoredKeys()
updateView()

const pushMount = document.getElementById('notifications-controls')
const notificationsStatus = document.getElementById('notifications-status')
pushButton = notificationsButton({
  className: 'icon-link',
  iconOn: 'notifications_active',
  iconOff: 'notifications',
  buttonEl: pushMount,
  serviceWorkerUrl: '/sw.js',
  vapidKeyUrl: '/vapid-public-key',
  subscribeUrl: '/subscribe',
  unsubscribeUrl: '/unsubscribe',
  titleOn: 'Notifications on',
  titleOff: 'Notifications off',
  onStatus: (text) => {
    if (notificationsStatus) notificationsStatus.textContent = text || ''
  },
})
