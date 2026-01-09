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

async function getPublicKey(vapidKeyUrl) {
  const res = await fetch(vapidKeyUrl)
  if (!res.ok) throw new Error('Failed to load VAPID public key')
  const data = await res.json()
  return data.key
}


export function notificationsButton(options = {}) {
  const {
    className = 'notifications-link',
    iconOn = 'notifications_active',
    iconOff = 'notifications',
    titleOn = 'Turn off notifications',
    titleOff = 'Turn on notifications',
    vapidKeyUrl = '/vapid-public-key',
    subscribeUrl = '/subscribe',
    unsubscribeUrl = '/unsubscribe',
    buttonEl,
    onStatus,
    onToggle,
  } = options

  const button = buttonEl || document.createElement('button')
  if (!buttonEl) button.type = 'button'
  if (className) button.className = className
  if (button instanceof HTMLAnchorElement) {
    button.setAttribute('role', 'button')
    if (!button.getAttribute('href')) button.setAttribute('href', '#')
  }
  button.title = titleOff
  button.setAttribute('aria-label', titleOff)

  const icon = document.createElement('span')
  icon.className = 'material-symbols-outlined'
  icon.setAttribute('aria-hidden', 'true')
  button.replaceChildren(icon)

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

  async function sendSubscription(subscription) {
    const res = await fetch(subscribeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(subscription),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(detail ? `Subscribe failed: ${detail}` : 'Subscribe failed')
    }
  }

  async function subscribe() {
    setStatus('requesting permission')
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      setStatus('permission denied')
      return
    }

    if (!('serviceWorker' in navigator)) {
      throw new Error('Service Worker not supported in this browser')
    }
    const registration = await navigator.serviceWorker.ready.catch(() => null)
    if (!registration) {
      throw new Error('Service Worker not ready')
    }
    const key = await getPublicKey(vapidKeyUrl)
    const subscription = await registration.pushManager.getSubscription() ||
      await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      })

    await sendSubscription(subscription)
    setStatus('subscribed')
    setState(true)
  }

  async function unsubscribe() {
    const registration = await navigator.serviceWorker.ready.catch(() => null)
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
  }

  async function refresh() {
    if (!('serviceWorker' in navigator)) {
      setStatus('service worker unsupported')
      setState(false)
      return
    }

    const registration = await navigator.serviceWorker.ready.catch(() => null)
    const subscription = registration
      ? await registration.pushManager.getSubscription()
      : null
    if (!subscription) {
      setStatus('not subscribed')
      setState(false)
      return
    }
    setStatus('subscribed')
    setState(true)
  }

  button.addEventListener('click', (event) => {
    if (button instanceof HTMLAnchorElement) event.preventDefault()
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
