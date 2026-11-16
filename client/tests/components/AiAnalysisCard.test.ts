import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalysisResult } from '@spam-checker/shared'
import AiAnalysisCard from '../../src/components/AiAnalysisCard.vue'
import type { AnalysisStatus } from '../../src/composables/useAiAnalysis'
import type { RewriteStatus } from '../../src/composables/useRewrite'
import { ApiError } from '../../src/lib/api'

const RESULT: AnalysisResult = {
  summary: 'High spam risk: urgency and money promises.',
  riskLevel: 'high',
  suggestions: ['Remove "ASAP"', 'Drop the guaranteed ROI', 'Introduce yourself first'],
}

interface Props {
  status: AnalysisStatus
  result: AnalysisResult | null
  error: ApiError | null
  isStale: boolean
  disabledReason?: string
  rewriteStatus: RewriteStatus
  rewriteError: ApiError | null
  canUndo: boolean
}

function card(props: Partial<Props> = {}) {
  return mount(AiAnalysisCard, {
    props: {
      status: 'idle',
      result: null,
      error: null,
      isStale: false,
      rewriteStatus: 'idle',
      rewriteError: null,
      canUndo: false,
      ...props,
    },
  })
}

const button = (wrapper: ReturnType<typeof card>, label: string) => {
  const found = wrapper.findAll('button').find((b) => b.text().includes(label))
  if (!found) throw new Error(`no button "${label}"`)
  return found
}

afterEach(() => vi.useRealTimers())

describe('AiAnalysisCard', () => {
  describe('idle', () => {
    it('shows the title and an enabled Analyze button that emits analyze', async () => {
      const wrapper = card()
      expect(wrapper.text()).toContain('✦ AI analysis')
      await button(wrapper, 'Analyze with AI').trigger('click')
      expect(wrapper.emitted('analyze')).toHaveLength(1)
    })

    it('disables Analyze and says why when there is nothing valid to analyze', () => {
      const wrapper = card({ disabledReason: 'Add some text to analyze.' })
      expect(button(wrapper, 'Analyze with AI').attributes('disabled')).toBeDefined()
      expect(wrapper.text()).toContain('Add some text to analyze.')
    })
  })

  it('loading: shows a busy skeleton and a disabled button', () => {
    const wrapper = card({ status: 'loading' })
    expect(wrapper.find('[aria-busy="true"] .skeleton').exists()).toBe(true)
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
  })

  describe('success', () => {
    it('shows the risk badge, the summary and exactly 3 suggestions', () => {
      const wrapper = card({ status: 'success', result: RESULT })
      expect(wrapper.get('.risk').text()).toBe('High risk')
      expect(wrapper.get('.risk').classes()).toContain('risk--high')
      expect(wrapper.text()).toContain(RESULT.summary)
      expect(wrapper.text()).toContain('Suggestions')
      expect(wrapper.findAll('li').map((li) => li.text())).toEqual(RESULT.suggestions)
    })

    it.each([
      ['medium', 'Medium risk'],
      ['low', 'Low risk'],
    ] as const)('labels %s risk as "%s"', (riskLevel, label) =>
      expect(
        card({ status: 'success', result: { ...RESULT, riskLevel } })
          .get('.risk')
          .text(),
      ).toBe(label),
    )

    it('offers Rewrite with AI, which emits rewrite', async () => {
      const wrapper = card({ status: 'success', result: RESULT })
      const rewrite = button(wrapper, 'Rewrite with AI')
      expect(rewrite.attributes('disabled')).toBeUndefined()
      await rewrite.trigger('click')
      expect(wrapper.emitted('rewrite')).toHaveLength(1)
    })

    it('still offers Undo after re-analyzing a rewritten text', async () => {
      const wrapper = card({ status: 'success', result: RESULT, canUndo: true })
      await button(wrapper, 'Undo rewrite').trigger('click')
      expect(wrapper.emitted('undo')).toHaveLength(1)
      expect(button(wrapper, 'Rewrite with AI').exists()).toBe(true)
    })

    it('shows the rewrite running, with the button disabled', () => {
      const wrapper = card({ status: 'success', result: RESULT, rewriteStatus: 'loading' })
      expect(button(wrapper, 'Rewriting').attributes('disabled')).toBeDefined()
    })

    it('shows why a rewrite failed', () => {
      const wrapper = card({
        status: 'success',
        result: RESULT,
        rewriteStatus: 'error',
        rewriteError: new ApiError('LLM_UNAVAILABLE'),
      })
      expect(wrapper.text()).toContain("The AI couldn't rewrite this email. Try again.")
      expect(button(wrapper, 'Rewrite with AI').attributes('disabled')).toBeUndefined()
    })

    it('renders model text literally, never as HTML', () => {
      const wrapper = card({
        status: 'success',
        result: { ...RESULT, summary: 'Risky <b>bold</b> <img src=x onerror=alert(1)>' },
      })
      expect(wrapper.find('b').exists()).toBe(false)
      expect(wrapper.find('img').exists()).toBe(false)
      expect(wrapper.text()).toContain('Risky <b>bold</b>')
    })
  })

  it('stale: does not offer Rewrite (the suggestions were for another text)', () =>
    expect(
      card({ status: 'success', result: RESULT, isStale: true })
        .findAll('button')
        .some((b) => b.text().includes('Rewrite with AI')),
    ).toBe(false))

  it('after a rewrite: offers Undo next to Re-analyze', async () => {
    const wrapper = card({ status: 'success', result: RESULT, isStale: true, canUndo: true })
    expect(wrapper.text()).toContain('Rewritten with AI')
    await button(wrapper, 'Undo').trigger('click')
    expect(wrapper.emitted('undo')).toHaveLength(1)
    expect(button(wrapper, 'Re-analyze').exists()).toBe(true)
  })

  it('stale: dims the result, says why, and offers Re-analyze', async () => {
    const wrapper = card({ status: 'success', result: RESULT, isStale: true })
    expect(wrapper.get('.result').classes()).toContain('result--stale')
    expect(wrapper.text()).toContain('Text changed since this analysis')
    await button(wrapper, 'Re-analyze').trigger('click')
    expect(wrapper.emitted('analyze')).toHaveLength(1)
  })

  describe('error', () => {
    it('shows the message for the code and a Try again button', async () => {
      const wrapper = card({ status: 'error', error: new ApiError('LLM_TIMEOUT') })
      expect(wrapper.text()).toContain("The AI couldn't analyze this email. Try again.")
      await button(wrapper, 'Try again').trigger('click')
      expect(wrapper.emitted('analyze')).toHaveLength(1)
    })

    it('counts down a rate limit and only then enables Try again', async () => {
      vi.useFakeTimers()
      const wrapper = card({ status: 'error', error: new ApiError('RATE_LIMITED', 3) })
      expect(wrapper.text()).toContain('try again in 3s')
      expect(button(wrapper, 'Try again').attributes('disabled')).toBeDefined()

      await vi.advanceTimersByTimeAsync(1000)
      expect(wrapper.text()).toContain('try again in 2s')

      await vi.advanceTimersByTimeAsync(2000)
      expect(button(wrapper, 'Try again').attributes('disabled')).toBeUndefined()
    })
  })

  describe('accessibility', () => {
    it('is a section labelled by its heading', () => {
      const wrapper = card()
      const section = wrapper.get('section')
      const heading = wrapper.get(`#${section.attributes('aria-labelledby')}`)
      expect(heading.text()).toContain('AI analysis')
    })

    it('announces results politely', () =>
      expect(
        card({ status: 'success', result: RESULT }).find('[aria-live="polite"]').exists(),
      ).toBe(true))
  })
})
