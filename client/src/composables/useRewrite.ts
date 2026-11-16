import { computed, getCurrentScope, onScopeDispose, ref, type Ref } from 'vue'
import { ApiError, rewriteEmail } from '../lib/api'

export type RewriteStatus = 'idle' | 'loading' | 'error'

/**
 * Rewrite with AI (D15): replaces `text` with the rewrite, keeping the original text
 * for a one-click Undo (after several rewrites in a row, still the original). Undo is offered only while the editor still holds exactly the
 * rewritten text: any edit by hand makes it go away, with no extra bookkeeping.
 */
export function useRewrite(text: Ref<string>) {
  const status = ref<RewriteStatus>('idle')
  const error = ref<ApiError | null>(null)
  const before = ref<string | null>(null)
  const after = ref<string | null>(null)
  let inFlight: AbortController | null = null

  const canUndo = computed(() => before.value !== null && text.value === after.value)

  async function rewrite(suggestions: readonly string[]): Promise<void> {
    inFlight?.abort()
    const request = new AbortController()
    inFlight = request
    const sent = text.value

    status.value = 'loading'
    error.value = null
    try {
      const { rewrittenText } = await rewriteEmail(sent, suggestions, request.signal)
      if (inFlight !== request) return
      status.value = 'idle'
      // Never overwrite what the user typed while we were waiting.
      if (text.value !== sent) return
      // Rewriting a rewrite keeps the very first text, so Undo always returns to the original.
      if (!canUndo.value) before.value = sent
      after.value = rewrittenText
      text.value = rewrittenText
    } catch (e) {
      if (inFlight !== request) return
      error.value = e instanceof ApiError ? e : new ApiError('NETWORK')
      status.value = 'error'
    } finally {
      if (inFlight === request) inFlight = null
    }
  }

  function undo(): void {
    if (!canUndo.value || before.value === null) return
    text.value = before.value
    before.value = null
    after.value = null
  }

  if (getCurrentScope()) onScopeDispose(() => inFlight?.abort())

  return { status, error, canUndo, rewrite, undo }
}
