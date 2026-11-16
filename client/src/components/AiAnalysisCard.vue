<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import type { AnalysisResult, RiskLevel } from '@spam-checker/shared'
import type { AnalysisStatus } from '../composables/useAiAnalysis'
import { ApiError, errorMessage } from '../lib/api'

/** Presentational: App owns the analysis state (useAiAnalysis) and passes it in. */
const props = defineProps<{
  status: AnalysisStatus
  result: AnalysisResult | null
  error: ApiError | null
  isStale: boolean
  /** Set when there is nothing valid to analyze; disables the analyze buttons. */
  disabledReason?: string
}>()
defineEmits<{ analyze: [] }>()

const titleId = useId()

const RISK_LABELS: Record<RiskLevel, string> = {
  high: 'High risk',
  medium: 'Medium risk',
  low: 'Low risk',
}

// Rate limited: count down from Retry-After, and only allow a retry once it's over.
const secondsLeft = ref(0)
let timer: ReturnType<typeof setInterval> | undefined

watch(
  () => props.error,
  (error) => {
    clearInterval(timer)
    secondsLeft.value = error?.code === 'RATE_LIMITED' ? (error.retryAfterSeconds ?? 0) : 0
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

const message = computed(() => {
  const error = props.error
  if (!error) return ''
  if (error.code !== 'RATE_LIMITED' || !error.retryAfterSeconds) return errorMessage(error)
  return secondsLeft.value > 0
    ? errorMessage(new ApiError('RATE_LIMITED', secondsLeft.value))
    : 'You can try again now.'
})

const canAnalyze = computed(() => !props.disabledReason)
</script>

<template>
  <section class="ai-card" :aria-labelledby="titleId">
    <h2 :id="titleId" class="ai-card__title">✦ AI analysis</h2>

    <!-- Everything that changes after a click is announced, without interrupting. -->
    <div class="ai-card__body" aria-live="polite" :aria-busy="status === 'loading'">
      <div v-if="status === 'loading'" class="skeletons">
        <div class="skeleton skeleton--badge" />
        <div class="skeleton" />
        <div class="skeleton skeleton--short" />
      </div>

      <div
        v-else-if="status === 'success' && result"
        :class="['result', { 'result--stale': isStale }]"
      >
        <span :class="['risk', `risk--${result.riskLevel}`]">{{
          RISK_LABELS[result.riskLevel]
        }}</span>
        <!-- Interpolation, never v-html: model output is untrusted text (D10). -->
        <p class="result__summary">{{ result.summary }}</p>
        <h3 class="result__heading">Suggestions</h3>
        <ol class="result__suggestions">
          <li v-for="(suggestion, i) in result.suggestions" :key="i">{{ suggestion }}</li>
        </ol>
      </div>

      <p v-else-if="status === 'error' && error" class="ai-card__error">{{ message }}</p>
    </div>

    <div class="ai-card__actions">
      <template v-if="status === 'idle'">
        <button
          type="button"
          class="btn btn--primary"
          :disabled="!canAnalyze"
          @click="$emit('analyze')"
        >
          Analyze with AI
        </button>
      </template>

      <button v-else-if="status === 'loading'" type="button" class="btn btn--primary" disabled>
        Analyzing…
      </button>

      <template v-else-if="status === 'success' && isStale">
        <p class="ai-card__note">Text changed since this analysis</p>
        <button
          type="button"
          class="btn btn--primary"
          :disabled="!canAnalyze"
          @click="$emit('analyze')"
        >
          Re-analyze
        </button>
      </template>

      <button
        v-else-if="status === 'success'"
        type="button"
        class="btn btn--secondary"
        title="Coming soon"
        disabled
      >
        ✦ Rewrite with AI
      </button>

      <button
        v-else-if="status === 'error'"
        type="button"
        class="btn btn--primary"
        :disabled="!canAnalyze || secondsLeft > 0"
        @click="$emit('analyze')"
      >
        Try again
      </button>

      <p v-if="disabledReason && status !== 'loading'" class="ai-card__hint">
        {{ disabledReason }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.ai-card {
  margin: 1rem 0;
  padding: 1rem;
  border-radius: 0.5rem;
  background: var(--surface);
  box-shadow: 0 4px 24px rgb(4 20 58 / 6%);
}

.ai-card__title {
  margin: 0 0 0.75rem;
  font-size: 1rem;
  font-weight: 700;
  color: var(--ai);
}

.ai-card__body:empty {
  display: none;
}

.result {
  transition: opacity 0.2s;
}
.result--stale {
  opacity: 0.45;
}

.risk {
  display: inline-block;
  padding: 0.125rem 0.625rem;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 700;
}
.risk--high {
  background: var(--risk-high-bg);
  color: var(--risk-high);
}
.risk--medium {
  background: var(--risk-medium-bg);
  color: var(--risk-medium);
}
.risk--low {
  background: var(--risk-low-bg);
  color: var(--risk-low);
}

.result__summary {
  margin: 0.625rem 0 0.75rem;
  font-size: 0.925rem;
}

.result__heading {
  margin: 0 0 0.375rem;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}

.result__suggestions {
  margin: 0;
  padding-left: 1.25rem;
  font-size: 0.9rem;
}
.result__suggestions li + li {
  margin-top: 0.375rem;
}

.ai-card__error {
  margin: 0;
  color: var(--risk-high);
  font-size: 0.925rem;
}

.ai-card__actions {
  margin-top: 0.875rem;
}

.ai-card__note,
.ai-card__hint {
  margin: 0 0 0.5rem;
  font-size: 0.825rem;
  color: var(--muted);
}
.ai-card__hint {
  margin: 0.5rem 0 0;
}

.btn {
  width: 100%;
  padding: 0.625rem 1rem;
  border: 1px solid transparent;
  border-radius: 0.5rem;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.btn:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.btn--primary {
  background: var(--ai);
  color: #fff;
}
.btn--primary:not(:disabled):hover {
  background: var(--ai-hover);
}
.btn--secondary {
  border-color: var(--ai);
  background: transparent;
  color: var(--ai);
}

.skeletons {
  display: grid;
  gap: 0.5rem;
}
.skeleton {
  height: 0.875rem;
  border-radius: 0.25rem;
  background: linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%);
  background-size: 200% 100%;
  animation: shimmer 1.2s infinite linear;
}
.skeleton--badge {
  width: 5.5rem;
  height: 1.25rem;
  border-radius: 999px;
}
.skeleton--short {
  width: 60%;
}
@keyframes shimmer {
  to {
    background-position: -200% 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .skeleton {
    animation: none;
  }
}
</style>
