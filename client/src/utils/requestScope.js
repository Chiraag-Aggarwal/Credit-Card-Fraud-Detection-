// A newer request invalidates earlier responses, even when an adapter ignores abort.
export function createRequestScope() {
  let active = true
  let current = null
  let pending = false
  function cancel() {
    current?.controller.abort()
    current = null
    pending = false
  }
  return {
    activate() { active = true },
    dispose() { active = false; cancel() },
    cancel,
    isPending() { return pending },
    begin() {
      if (!active) return null
      cancel()
      const controller = new AbortController()
      const request = {
        controller,
        signal: controller.signal,
        isCurrent() { return active && current === request && !controller.signal.aborted },
        finish() { if (current === request) pending = false },
      }
      current = request
      pending = true
      return request
    },
  }
}
