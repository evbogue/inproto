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
const peersSection = document.getElementById('peers-section')
const peersStatus = document.getElementById('peers-status')
const peersList = document.getElementById('peers-list')
const profileMessagesStatus = document.getElementById('profile-messages-status')
const profileMessagesList = document.getElementById('profile-messages-list')
const inboxSection = document.getElementById('inbox-section')
const inboxStatus = document.getElementById('inbox-status')
const inboxList = document.getElementById('inbox-list')
const storageKeys = {
  keypair: 'inproto:keypair',
  publicKey: 'inproto:publicKey',
}
const legacyStorageKeys = {
  keypair: 'anproto:keypair',
  publicKey: 'anproto:publicKey',
}

function setKeyStatus(text) {
  keyStatus.textContent = text
}

function setOwnPubkey(text) {
  ownPubkey.textContent = text
}

function getStoredKeypair() {
  return localStorage.getItem(storageKeys.keypair) ||
    localStorage.getItem(legacyStorageKeys.keypair)
}

function getStoredPublicKey() {
  const combined = getStoredKeypair()
  if (!combined) return null
  return localStorage.getItem(storageKeys.publicKey) ||
    localStorage.getItem(legacyStorageKeys.publicKey) ||
    combined.slice(0, 44)
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
  if (hash === 'peers') return { type: 'peers' }
  if (hash === 'inbox') return { type: 'inbox' }
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

  if (route.type === 'peers') {
    targetStatus.textContent = ''
    if (qrContainer) qrContainer.remove()
    qrContainer = null
    qrToggle.setAttribute('aria-expanded', 'false')
    renderSections([peersSection])
    loadPeers().catch((err) => {
      console.error(err)
      setPeersStatus('failed to load peers')
    })
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
  if (pushButton?.refresh) {
    pushButton.refresh().catch(() => {})
  }
  loadProfileMessages(target).catch((err) => {
    console.error(err)
    setProfileMessagesStatus('failed to load messages')
  })
}

function setPeersStatus(text) {
  peersStatus.textContent = text
}

function setProfileMessagesStatus(text) {
  profileMessagesStatus.textContent = text
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
    const ts = item.human ? `${item.human} ago` : 'unknown time'
    const from = item.from || item.author || 'unknown'
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

function renderPeersList(peers) {
  peersList.replaceChildren()
  for (const pubkey of peers) {
    const item = document.createElement('li')
    const link = document.createElement('a')
    link.href = `#${pubkey}`
    link.textContent = pubkey
    item.appendChild(link)
    peersList.appendChild(item)
  }
}

async function loadPeers() {
  const pubkey = getStoredPublicKey()
  if (!pubkey) {
    setPeersStatus('generate a keypair first')
    renderPeersList([])
    return
  }

  setPeersStatus('loading...')
  const res = await fetch(`/peers?pubkey=${encodeURIComponent(pubkey)}`)
  if (!res.ok) {
    setPeersStatus('failed to load peers')
    renderPeersList([])
    return
  }
  const data = await res.json().catch(() => null)
  const peers = Array.isArray(data?.peers) ? data.peers : []
  if (peers.length === 0) {
    setPeersStatus('no peers yet')
  } else {
    setPeersStatus('')
  }
  renderPeersList(peers)
}

async function loadProfileMessages(pubkey) {
  setProfileMessagesStatus('loading...')
  const res = await fetch(`/messages/sent?pubkey=${encodeURIComponent(pubkey)}`)
  if (!res.ok) {
    setProfileMessagesStatus('failed to load messages')
    renderMessagesList(profileMessagesList, [])
    return
  }
  const data = await res.json().catch(() => null)
  const messages = Array.isArray(data?.messages) ? data.messages : []
  if (messages.length === 0) {
    setProfileMessagesStatus('no messages yet')
  } else {
    setProfileMessagesStatus('')
  }
  renderMessagesList(profileMessagesList, messages)
}

async function loadInbox() {
  const pubkey = getStoredPublicKey()
  if (!pubkey) {
    setInboxStatus('generate a keypair first')
    renderMessagesList(inboxList, [])
    return
  }
  setInboxStatus('loading...')
  const res = await fetch(`/messages?pubkey=${encodeURIComponent(pubkey)}`)
  if (!res.ok) {
    setInboxStatus('failed to load inbox')
    renderMessagesList(inboxList, [])
    return
  }
  const data = await res.json().catch(() => null)
  const messages = Array.isArray(data?.messages) ? data.messages : []
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
    return
  }
  const publicKey = getStoredPublicKey()
  if (!publicKey) {
    setOwnPubkey('no pubkey yet')
    return
  }
  localStorage.setItem(storageKeys.keypair, combined)
  localStorage.setItem(storageKeys.publicKey, publicKey)
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
    localStorage.setItem(storageKeys.keypair, combined)
    localStorage.setItem(storageKeys.publicKey, publicKey)
    combinedKeyArea.value = combined
    setOwnPubkey(publicKey)
    setKeyStatus('ready (stored in localStorage)')
    if (pushButton?.refresh) {
      pushButton.refresh().catch(() => {})
    }
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
  localStorage.removeItem(storageKeys.keypair)
  localStorage.removeItem(storageKeys.publicKey)
  localStorage.removeItem(legacyStorageKeys.keypair)
  localStorage.removeItem(legacyStorageKeys.publicKey)
  combinedKeyArea.value = ''
  setOwnPubkey('no pubkey yet')
  setKeyStatus('cleared localStorage')
  if (pushButton?.refresh) {
    pushButton.refresh().catch(() => {})
  }
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
      url: buildShareUrl(fromPubKey),
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
  welcomeTitle: 'Welcome to Inproto',
  welcomeBody: 'Notifications are on.',
  goodbyeTitle: 'Notifications off',
  goodbyeBody: 'Notifications are off.',
})

pushMount.appendChild(pushButton)
