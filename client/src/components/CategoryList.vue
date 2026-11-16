<script setup lang="ts">
import { computed } from 'vue'
import { SPAM_CATEGORIES, type SpamCategory } from '../lib/spam-check'

const props = defineProps<{ groups: Record<SpamCategory, string[]> }>()

// Same names and emoji as the original tool.
const NAMES: Record<SpamCategory, string> = {
  urgency: '🚨 Urgency',
  shady: '🔞 Shady',
  overpromise: '🤩 Overpromise',
  money: '💰 Money',
  unnatural: '💬 Unnatural',
}

const visible = computed(() =>
  SPAM_CATEGORIES.filter((c) => props.groups[c].length > 0).map((c) => ({
    category: c,
    name: NAMES[c],
    keywords: props.groups[c],
  })),
)
</script>

<template>
  <ul v-if="visible.length" class="categories">
    <li
      v-for="item in visible"
      :key="item.category"
      :class="['category', `category--${item.category}`]"
      :title="item.keywords.join(', ')"
    >
      {{ item.name }} <span class="category__count">({{ item.keywords.length }})</span>
    </li>
  </ul>
</template>

<style scoped>
.categories {
  list-style: none;
  margin: 0;
  padding: 0;
}

.category {
  margin: 0.5rem 0;
  padding: 0.75rem;
  border-left: 3px solid transparent;
  border-radius: 0.25rem;
  background: var(--surface);
  box-shadow: 0 4px 24px rgb(4 20 58 / 4%);
}

.category__count {
  color: var(--muted);
}

.category--urgency {
  border-left-color: var(--cat-urgency);
}
.category--shady {
  border-left-color: var(--cat-shady);
}
.category--overpromise {
  border-left-color: var(--cat-overpromise);
}
.category--money {
  border-left-color: var(--cat-money);
}
.category--unnatural {
  border-left-color: var(--cat-unnatural);
}
</style>
