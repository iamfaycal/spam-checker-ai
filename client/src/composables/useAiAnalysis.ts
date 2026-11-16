import { computed, getCurrentScope, onScopeDispose, ref, type Ref } from 'vue'
import type { AnalysisResult } from '@spam-checker/shared'
import { ApiError, analyzeEmail } from '../lib/api'

export type AnalysisStatus = 'idle' | 'loading' | 'success' | 'error'

/**
 * The AI analysis of `text`, on demand (D12): one `analyze()` per click.
 * A newer analysis aborts the one in flight, and an answer for an older text can
 * never overwrite a newer one. `isStale` tells the card the text changed since.
 */
export function useAiAnalysis(text: Ref<string>) {
  const status = ref<AnalysisStatus>('idle')
  const result = ref<AnalysisResult | null>(null)
  const error = ref<ApiError | null>(null)
  const analyzedText = ref<string | null>(null)
  let inFlight: AbortController | null = null

  const isStale = computed(() => status.value === 'success' && text.value !== analyzedText.value)

  async function analyze(): Promise<void> {
    inFlight?.abort()
    const request = new AbortController()
    inFlight = request
    const sent = text.value

    status.value = 'loading'
    error.value = null
    try {
      const analysis = await analyzeEmail(sent, request.signal)
      if (inFlight !== request) return // a newer analysis started meanwhile: drop this answer
      result.value = analysis
      analyzedText.value = sent
      status.value = 'success'
    } catch (e) {
      if (inFlight !== request) return // replaced (its AbortError included): not an error to show
      error.value = e instanceof ApiError ? e : new ApiError('NETWORK')
      status.value = 'error'
    } finally {
      if (inFlight === request) inFlight = null
    }
  }

  // When the component using this goes away, stop paying for an answer nobody will see.
  if (getCurrentScope()) onScopeDispose(() => inFlight?.abort())

  return { status, result, error, isStale, analyze }
}
