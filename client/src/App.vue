<script setup lang="ts">
import { computed, ref } from 'vue'
import { MAX_TEXT_LENGTH } from '@spam-checker/shared'
import AiAnalysisCard from './components/AiAnalysisCard.vue'
import CategoryList from './components/CategoryList.vue'
import EmailEditor from './components/EmailEditor.vue'
import ScorePanel from './components/ScorePanel.vue'
import { useAiAnalysis } from './composables/useAiAnalysis'
import { useRewrite } from './composables/useRewrite'
import { SAMPLE_EMAIL } from './lib/sample-email'
import { findHits, groupByCategory, readTime, scoreLabel, wordCount } from './lib/spam-check'

// One piece of state; everything else is derived from it on each edit.
const text = ref(SAMPLE_EMAIL)
const hits = computed(() => findHits(text.value))
const words = computed(() => wordCount(text.value))

// The AI analysis runs on click only (D12); the server enforces the same limits.
const { status, result, error, isStale, analyze } = useAiAnalysis(text)
const rewriter = useRewrite(text)
// Rewrite applies the suggestions of the current analysis to the current text.
function rewriteWithSuggestions() {
  if (result.value) void rewriter.rewrite(result.value.suggestions)
}

const analyzeDisabledReason = computed(() => {
  const length = text.value.trim().length
  if (length === 0) return 'Add some text to analyze.'
  if (length > MAX_TEXT_LENGTH) {
    return `Max ${MAX_TEXT_LENGTH.toLocaleString('en')} characters (now ${length.toLocaleString('en')}).`
  }
  return undefined
})
</script>

<template>
  <header class="hero">
    <p class="hero__eyebrow">Free tool</p>
    <h1 class="hero__title">Spam Checker</h1>
    <p class="hero__lead">Copy/paste an email message to detect and remove spam words.</p>
  </header>

  <main class="card">
    <section class="card__editor">
      <EmailEditor v-model="text" :hits="hits" :readonly="rewriter.status.value === 'loading'" />
    </section>
    <aside class="card__aside" aria-label="Spam analysis">
      <ScorePanel :label="scoreLabel(hits)" :words="words" :read-time="readTime(words)" />
      <AiAnalysisCard
        :status="status"
        :result="result"
        :error="error"
        :is-stale="isStale"
        :disabled-reason="analyzeDisabledReason"
        :rewrite-status="rewriter.status.value"
        :rewrite-error="rewriter.error.value"
        :can-undo="rewriter.canUndo.value"
        @analyze="analyze"
        @rewrite="rewriteWithSuggestions"
        @undo="rewriter.undo"
      />
      <CategoryList v-if="words >= 2" :groups="groupByCategory(hits)" />
    </aside>
  </main>
</template>
