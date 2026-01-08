function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i)
  }
  return output
}

async function ensureServiceWorker(serviceWorkerUrl) {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service Worker not supported in this browser')
  }
  const registration = await navigator.serviceWorker.register(serviceWorkerUrl, {
    type: 'module',
  })
  return registration
}

async function getPublicKey(vapidKeyUrl) {
  const res = await fetch(vapidKeyUrl)
  if (!res.ok) throw new Error('Failed to load VAPID public key')
  const data = await res.json()
  return data.key
}

async function showLocalNotification(title, body, iconUrl) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return
  }
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return
  await registration.showNotification(title, { body, icon: iconUrl })
}

export function notificationsButton(options = {}) {
  const {
    className = 'notifications-link',
    iconOn = 'notifications_active',
    iconOff = 'notifications',
    titleOn = 'Turn off notifications',
    titleOff = 'Turn on notifications',
    serviceWorkerUrl = '/sw.js',
    vapidKeyUrl = '/vapid-public-key',
    subscribeUrl = '/subscribe',
    unsubscribeUrl = '/unsubscribe',
    challengeUrl = '/subscribe/challenge',
    iconUrl = '/favicon.ico',
    welcomeTitle = 'Welcome',
    welcomeBody = 'Notifications are on.',
    goodbyeTitle = 'Goodbye',
    goodbyeBody = 'Notifications are off.',
    storageKey = 'inproto:notifications:binding',
    getUserPubKey,
    signChallenge,
    onStatus,
    onToggle,
  } = options

  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.title = titleOff
  button.setAttribute('aria-label', titleOff)

  const icon = document.createElement('span')
  icon.className = 'material-symbols-outlined'
  icon.setAttribute('aria-hidden', 'true')
  button.appendChild(icon)

  function setStatus(text) {
    if (onStatus) onStatus(text)
  }

  function setState(enabled) {
    button.dataset.enabled = enabled ? 'true' : 'false'
    const title = enabled ? titleOn : titleOff
    button.title = title
    button.setAttribute('aria-label', title)
    icon.textContent = enabled ? iconOn : iconOff
    if (onToggle) onToggle(enabled)
  }

  function getStoredBinding() {
    if (!storageKey) return null
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  function setStoredBinding(value) {
    if (!storageKey) return
    if (value) {
      localStorage.setItem(storageKey, JSON.stringify(value))
    } else {
      localStorage.removeItem(storageKey)
    }
  }

  function safeGetUserPubKey() {
    if (!getUserPubKey) return null
    try {
      return getUserPubKey()
    } catch {
      return null
    }
  }

  async function sendSubscription(subscription) {
    const userPubKey = safeGetUserPubKey()
    let payload = subscription
    if (userPubKey) {
      if (!signChallenge) throw new Error('Missing signChallenge handler')
      const challengeRes = await fetch(
        `${challengeUrl}?pubkey=${encodeURIComponent(userPubKey)}`,
      )
      if (!challengeRes.ok) throw new Error('Challenge request failed')
      const { challenge } = await challengeRes.json()
      const signature = await signChallenge(challenge)
      payload = {
        subscription,
        userPubKey,
        challenge,
        signature,
      }
    }

    const res = await fetch(subscribeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(detail ? `Subscribe failed: ${detail}` : 'Subscribe failed')
    }
    if (userPubKey) {
      setStoredBinding({
        userPubKey,
      })
    }
  }

  async function subscribe() {
    setStatus('requesting permission')
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      setStatus('permission denied')
      return
    }

    const registration = await ensureServiceWorker(serviceWorkerUrl)
    const key = await getPublicKey(vapidKeyUrl)
    const subscription = await registration.pushManager.getSubscription() ||
      await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      })

    await sendSubscription(subscription)
    setStatus('subscribed')
    setState(true)
    await showLocalNotification(welcomeTitle, welcomeBody, iconUrl)
  }

  async function unsubscribe() {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) {
      setStatus('no service worker')
      return
    }

    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) {
      setStatus('not subscribed')
      return
    }

    await subscription.unsubscribe()
    const res = await fetch(unsubscribeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(detail ? `Unsubscribe failed: ${detail}` : 'Unsubscribe failed')
    }

    setStatus('unsubscribed')
    setState(false)
    setStoredBinding(null)
    await showLocalNotification(goodbyeTitle, goodbyeBody, iconUrl)
  }

  async function refresh() {
    if (!('serviceWorker' in navigator)) {
      setState(false)
      return
    }

    const registration = await navigator.serviceWorker.getRegistration()
    const subscription = registration
      ? await registration.pushManager.getSubscription()
      : null
    if (!subscription) {
      setState(false)
      return
    }

    const stored = getStoredBinding()
    const currentPubKey = safeGetUserPubKey()
    if (!currentPubKey || stored?.userPubKey !== currentPubKey) {
      try {
        await subscription.unsubscribe()
        await fetch(unsubscribeUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        })
      } catch (err) {
        console.error(err)
      }
      setStoredBinding(null)
      setStatus('not subscribed for this identity')
      setState(false)
      return
    }

    setState(true)
  }

  button.addEventListener('click', () => {
    const enabled = button.dataset.enabled === 'true'
    const action = enabled ? unsubscribe : subscribe
    action().catch((err) => {
      console.error(err)
      const message = err instanceof Error ? err.message : String(err)
      setStatus(message || (enabled ? 'unsubscribe failed' : 'subscribe failed'))
    })
  })

  button.refresh = refresh
  refresh().catch(() => setState(false))
  return button
}
