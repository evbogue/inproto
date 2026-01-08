import { an } from './an.js'
import { notificationsButton } from './notifications.js'

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

function setKeyStatus(text) {
  keyStatus.textContent = text
}

function setOwnPubkey(text) {
  ownPubkey.textContent = text
}

function getStoredKeypair() {
  return localStorage.getItem('anproto:keypair')
}

function getStoredPublicKey() {
  const combined = getStoredKeypair()
  if (!combined) return null
  return localStorage.getItem('anproto:publicKey') || combined.slice(0, 44)
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
  if (!hash) return { type: 'home' }
  if (hash === 'key') return { type: 'key' }
  return { type: 'profile', pubkey: hash }
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

function loadStoredKeys() {
  const combined = getStoredKeypair()
  if (!combined) {
    setOwnPubkey('no pubkey yet')
    return
  }
  const publicKey = getStoredPublicKey()
  if (!publicKey) {
    setOwnPubkey('no pubkey yet')
    return
  }
  combinedKeyArea.value = combined
  setOwnPubkey(publicKey)
  setKeyStatus('loaded from localStorage')
}

async function generateKeypair() {
  const hadKey = !!getStoredKeypair()
  setKeyStatus('generating...')
  try {
    const combined = await an.gen()
    const publicKey = combined.slice(0, 44)
    localStorage.setItem('anproto:keypair', combined)
    localStorage.setItem('anproto:publicKey', publicKey)
    combinedKeyArea.value = combined
    setOwnPubkey(publicKey)
    setKeyStatus('ready (stored in localStorage)')
    if (!hadKey) {
      window.location.hash = publicKey
      updateView()
    }
  } catch (err) {
    console.error(err)
    setKeyStatus('failed to generate keypair')
  }
}

generateButton.addEventListener('click', generateKeypair)
clearButton.addEventListener('click', () => {
  localStorage.removeItem('anproto:keypair')
  localStorage.removeItem('anproto:publicKey')
  combinedKeyArea.value = ''
  setOwnPubkey('no pubkey yet')
  setKeyStatus('cleared localStorage')
})
sendPushButton.addEventListener('click', async () => {
  const targetPubKey = getTargetPubKey()
  if (!targetPubKey) {
    sendStatus.textContent = 'no target pubkey set'
    return
  }
  const combined = getStoredKeypair()
  const fromPubKey = getStoredPublicKey()
  if (!combined || !fromPubKey) {
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
      url: buildShareUrl(targetPubKey),
    }
    const payloadText = JSON.stringify(payload)
    const hash = await an.hash(payloadText)
    const sig = await an.sign(hash, combined)
    const res = await fetch('/message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sig,
        body: payloadText,
      }),
    })
    if (!res.ok) throw new Error('send failed')
    sendStatus.textContent = 'sent'
  } catch (err) {
    console.error(err)
    sendStatus.textContent = 'send failed'
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
loadStoredKeys()
updateView()

const pushMount = document.getElementById('push-controls')
const pushButton = notificationsButton({
  serviceWorkerUrl: '/sw.js',
  vapidKeyUrl: '/vapid-public-key',
  subscribeUrl: '/subscribe',
  unsubscribeUrl: '/unsubscribe',
  titleOn: 'Notifications on',
  titleOff: 'Notifications off',
  getUserPubKey: () => {
    const publicKey = getStoredPublicKey()
    if (!publicKey) throw new Error('Generate a keypair first')
    return publicKey
  },
  getTargetPubKey: () => getTargetPubKey(),
  signChallenge: async (challenge) => {
    const combined = getStoredKeypair()
    if (!combined) throw new Error('Generate a keypair first')
    return await an.sign(challenge, combined)
  },
  welcomeTitle: 'Welcome to anproto-in',
  welcomeBody: 'Notifications are on.',
  goodbyeTitle: 'Notifications off',
  goodbyeBody: 'Notifications are off.',
})

pushMount.appendChild(pushButton)
