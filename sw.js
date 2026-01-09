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

    const title = typeof payload?.title === 'string' && payload.title.trim()
      ? payload.title.trim()
      : 'Inproto'
    const body = typeof payload?.body === 'string' && payload.body.trim()
      ? payload.body.trim()
      : 'New message received'
    const targetUrl = typeof payload?.url === 'string' ? payload.url : '/'
    const options = {
      body,
      data: { url: targetUrl, payload },
      icon: payload?.icon || '/dovepurple_sm.png',
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
