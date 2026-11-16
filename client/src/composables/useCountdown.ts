import { onBeforeUnmount, ref, watch } from 'vue'
import type { ApiError } from '../lib/api'

/**
 * Seconds left before a rate-limited request may be retried, ticking down from the
 * error's Retry-After. 0 when the error isn't a rate limit (or once the wait is over).
 */
export function useRetryCountdown(error: () => ApiError | null) {
  const secondsLeft = ref(0)
  let timer: ReturnType<typeof setInterval> | undefined

  watch(
    error,
    (current) => {
      clearInterval(timer)
      secondsLeft.value = current?.code === 'RATE_LIMITED' ? (current.retryAfterSeconds ?? 0) : 0
      if (secondsLeft.value > 0) {
        timer = setInterval(() => {
          secondsLeft.value -= 1
          if (secondsLeft.value <= 0) clearInterval(timer)
        }, 1000)
      }
    },
    { immediate: true },
  )
  onBeforeUnmount(() => clearInterval(timer))

  return secondsLeft
}
