<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { toHighlightedHtml } from '../lib/highlight'
import type { SpamHit } from '../lib/spam-check'

/**
 * A transparent textarea over a backdrop that draws the highlights (D17).
 * The user types in the real textarea (caret, paste, undo all native); the backdrop
 * renders the same text, invisible, with coloured <mark>s behind the spam words.
 */
const props = defineProps<{ hits: readonly SpamHit[] }>()
const text = defineModel<string>({ required: true })

const html = computed(() => toHighlightedHtml(text.value, props.hits))
const backdrop = useTemplateRef<HTMLDivElement>('backdrop')

function syncScroll(event: Event) {
  const textarea = event.target as HTMLTextAreaElement
  if (!backdrop.value) return
  backdrop.value.scrollTop = textarea.scrollTop
  backdrop.value.scrollLeft = textarea.scrollLeft
}
</script>

<template>
  <div class="editor">
    <!-- Safe: toHighlightedHtml escapes all user text (tested with an <img onerror> payload). -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div ref="backdrop" class="editor__backdrop" aria-hidden="true" v-html="html" />
    <textarea
      v-model="text"
      class="editor__input"
      aria-label="Email message"
      spellcheck="false"
      @scroll="syncScroll"
    />
  </div>
</template>

<style scoped>
.editor {
  position: relative;
  height: 100%;
}

/* Both layers must lay text out identically, or the highlights drift from the words. */
.editor__backdrop,
.editor__input {
  box-sizing: border-box;
  margin: 0;
  border: 0;
  padding: 1.25rem;
  font: inherit;
  font-size: 1rem;
  line-height: 1.6;
  letter-spacing: normal;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  /* Reserve the scrollbar's space in both layers, so their text width is always equal. */
  scrollbar-gutter: stable;
}

.editor__backdrop {
  position: absolute;
  inset: 0;
  overflow: hidden;
  color: transparent;
  pointer-events: none;
}

.editor__input {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  min-height: 32rem;
  resize: vertical;
  overflow-y: auto;
  background: transparent;
  color: var(--text);
  outline: none;
}

.editor__input:focus-visible {
  box-shadow: inset 0 0 0 2px var(--focus);
}

/* The marks come from v-html, so scoped styles must reach them with :deep(). */
.editor__backdrop :deep(mark) {
  color: transparent;
  border-radius: 0.25rem;
}
.editor__backdrop :deep(.hit--urgency) {
  background: var(--cat-urgency);
}
.editor__backdrop :deep(.hit--shady) {
  background: var(--cat-shady);
}
.editor__backdrop :deep(.hit--overpromise) {
  background: var(--cat-overpromise);
}
.editor__backdrop :deep(.hit--money) {
  background: var(--cat-money);
}
.editor__backdrop :deep(.hit--unnatural) {
  background: var(--cat-unnatural);
}
</style>
