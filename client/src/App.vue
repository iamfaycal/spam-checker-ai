<script setup lang="ts">
import { computed, ref } from 'vue'
import CategoryList from './components/CategoryList.vue'
import EmailEditor from './components/EmailEditor.vue'
import ScorePanel from './components/ScorePanel.vue'
import { SAMPLE_EMAIL } from './lib/sample-email'
import { findHits, groupByCategory, readTime, scoreLabel, wordCount } from './lib/spam-check'

// One piece of state; everything else is derived from it on each edit.
const text = ref(SAMPLE_EMAIL)
const hits = computed(() => findHits(text.value))
const words = computed(() => wordCount(text.value))
</script>

<template>
  <header class="hero">
    <p class="hero__eyebrow">Free tool</p>
    <h1 class="hero__title">Spam Checker</h1>
    <p class="hero__lead">Copy/paste an email message to detect and remove spam words.</p>
  </header>

  <main class="card">
    <section class="card__editor">
      <EmailEditor v-model="text" :hits="hits" />
    </section>
    <aside class="card__aside" aria-label="Spam analysis">
      <ScorePanel :label="scoreLabel(hits)" :words="words" :read-time="readTime(words)" />
      <!-- The AI analysis card goes here (Task 11). -->
      <CategoryList v-if="words >= 2" :groups="groupByCategory(hits)" />
    </aside>
  </main>
</template>
