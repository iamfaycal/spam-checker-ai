<script setup lang="ts">
import type { ScoreLabel } from '../lib/spam-check'

defineProps<{ label: ScoreLabel; words: number; readTime: string }>()
</script>

<template>
  <!-- Like the original: under 2 words there is nothing meaningful to score. -->
  <p v-if="words < 2" class="score-panel__empty">Add content to get your spam score.</p>
  <table v-else class="score-panel">
    <tbody>
      <tr>
        <th scope="row">Overall score:</th>
        <td>
          <span :class="`score--${label.toLowerCase()}`">{{ label }}</span>
        </td>
      </tr>
      <tr>
        <th scope="row">Words:</th>
        <td>{{ words }}</td>
      </tr>
      <tr>
        <th scope="row">Read time:</th>
        <td>{{ readTime }}</td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.score-panel {
  width: 100%;
  border-collapse: collapse;
}

.score-panel th,
.score-panel td {
  padding: 0.25rem 0;
}

.score-panel th {
  text-align: left;
  font-weight: 400;
  color: var(--muted);
}

.score-panel td {
  text-align: right;
  font-weight: 600;
}

.score--poor {
  color: var(--score-poor);
}
.score--okay {
  color: var(--score-okay);
}
.score--great {
  color: var(--score-great);
}

.score-panel__empty {
  margin: 0;
  font-style: italic;
  color: var(--muted);
}
</style>
