const storagePrefix = 'fraud-checkout:'
const orderPattern = /^[A-Za-z0-9_-]{1,128}$/

function validSession(session) {
  const keyMode = /^rzp_(test|live)_[A-Za-z0-9]+$/.exec(session?.keyId || '')?.[1]
  return Boolean(session && orderPattern.test(session.orderId || '') && keyMode &&
    session.mode === keyMode && typeof session.sessionToken === 'string' &&
    session.sessionToken.length > 0 && session.sessionToken.length <= 4096 &&
    Number.isSafeInteger(session.amount) && session.amount > 0 && /^[A-Z]{3}$/.test(session.currency))
}

export function createCheckoutSessionStore(getStorage = () => globalThis.sessionStorage) {
  const memory = new Map()
  return {
    prepare(url, origin) {
      const target = new URL(url, origin)
      if (target.origin !== origin || target.pathname !== '/checkout' || target.username || target.password) {
        throw new Error('The checkout service returned an invalid destination.')
      }
      const params = target.searchParams
      const keyId = params.get('key_id')
      const session = {
        orderId: params.get('order_id'), keyId,
        amount: Number(params.get('amount')), currency: (params.get('currency') || 'INR').toUpperCase(),
        sessionToken: params.get('session_token'),
        mode: params.get('mode') || /^rzp_(test|live)_/.exec(keyId || '')?.[1],
      }
      if (!validSession(session)) throw new Error('The checkout service returned incomplete payment details.')
      memory.set(session.orderId, session)
      try { getStorage()?.setItem(storagePrefix + session.orderId, JSON.stringify(session)) } catch { /* This tab can continue without persistent storage. */ }
      return '/checkout?order_id=' + encodeURIComponent(session.orderId)
    },
    read(orderId) {
      if (!orderPattern.test(orderId || '')) return null
      let session = memory.get(orderId)
      if (!session) {
        try { session = JSON.parse(getStorage()?.getItem(storagePrefix + orderId) || 'null') } catch { return null }
      }
      return validSession(session) && session.orderId === orderId ? session : null
    },
    clear(orderId) {
      memory.delete(orderId)
      try { getStorage()?.removeItem(storagePrefix + orderId) } catch { /* Keep payment completion usable with restricted storage. */ }
    },
  }
}

export const checkoutSessions = createCheckoutSessionStore()

// Run before React or third-party checkout scripts, including for directly opened links.
export function captureCheckoutLocation(browser, sessions = checkoutSessions) {
  if (browser.location.pathname !== '/checkout') return
  const url = new URL(browser.location.href)
  if (!url.searchParams.has('session_token')) return
  let cleanPath = '/checkout'
  try { cleanPath = sessions.prepare(url.href, url.origin) } catch { /* Invalid tokens are removed from history too. */ }
  browser.history.replaceState(browser.history.state, '', cleanPath)
}
