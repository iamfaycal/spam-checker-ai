import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App.vue'
import CategoryList from '../../src/components/CategoryList.vue'
import ScorePanel from '../../src/components/ScorePanel.vue'

describe('ScorePanel', () => {
  it('shows the score, words and read time, with the label coloured by class', () => {
    const wrapper = mount(ScorePanel, {
      props: { label: 'Poor', words: 57, readTime: 'a few seconds' },
    })
    expect(wrapper.text()).toContain('Overall score')
    expect(wrapper.get('.score--poor').text()).toBe('Poor')
    expect(wrapper.text()).toContain('57')
    expect(wrapper.text()).toContain('a few seconds')
  })

  it('asks for content when there are fewer than 2 words (like the original)', () => {
    const wrapper = mount(ScorePanel, {
      props: { label: 'Great', words: 1, readTime: 'a few seconds' },
    })
    expect(wrapper.text()).toContain('Add content to get your spam score.')
    expect(wrapper.text()).not.toContain('Overall score')
  })
})

describe('CategoryList', () => {
  it('lists only the categories with hits, with their keyword count', () => {
    const wrapper = mount(CategoryList, {
      props: {
        groups: {
          urgency: ['ASAP'],
          shady: ['Financial', 'Finance'],
          overpromise: [],
          money: [],
          unnatural: [],
        },
      },
    })
    const items = wrapper.findAll('li')
    expect(items.map((li) => li.classes())).toEqual([
      ['category', 'category--urgency'],
      ['category', 'category--shady'],
    ])
    expect(items[0]?.text()).toContain('Urgency')
    expect(items[0]?.text()).toContain('(1)')
    expect(items[1]?.text()).toContain('(2)')
  })
})

describe('App', () => {
  it('starts with the sample email: Poor, 57 words, a few seconds', () => {
    const wrapper = mount(App)
    expect(wrapper.get('textarea').element.value).toContain('Dear friend')
    expect(wrapper.get('.score--poor').text()).toBe('Poor')
    expect(wrapper.text()).toContain('57')
    expect(wrapper.text()).toContain('a few seconds')
    expect(wrapper.findAll('.editor__backdrop mark').length).toBeGreaterThan(0)
  })

  it('updates the score, highlights and categories as the user edits', async () => {
    const wrapper = mount(App)
    await wrapper.get('textarea').setValue('Hello Marie, see you tomorrow at the office.')
    expect(wrapper.get('.score--great').text()).toBe('Great')
    expect(wrapper.findAll('.editor__backdrop mark')).toHaveLength(0)
    expect(wrapper.findAll('li.category')).toHaveLength(0)
  })

  it('analyzes the text with AI when the button is clicked, then shows the result', async () => {
    const analysis = {
      summary: 'Likely spam: money promises.',
      riskLevel: 'high',
      suggestions: ['One', 'Two', 'Three'],
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(analysis), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(App)

    const analyze = wrapper.findAll('button').find((b) => b.text().includes('Analyze with AI'))
    await analyze?.trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Likely spam: money promises.')
    expect(wrapper.get('.risk').text()).toBe('High risk')
  })

  it('disables Analyze when the editor is empty', async () => {
    const wrapper = mount(App)
    await wrapper.get('textarea').setValue('   ')
    const analyze = wrapper.findAll('button').find((b) => b.text().includes('Analyze with AI'))
    expect(analyze?.attributes('disabled')).toBeDefined()
  })

  it('rewrites the email with the suggestions, then Undo brings the original back', async () => {
    const analysis = {
      summary: 'Likely spam.',
      riskLevel: 'high',
      suggestions: ['Use their name', 'Drop ASAP', 'Say who you are'],
    }
    const rewritten = 'Hello Marie,\n\nsee you tomorrow.'
    const fetchMock = vi.fn<typeof fetch>(async (url) =>
      String(url) === '/api/rewrite'
        ? new Response(JSON.stringify({ rewrittenText: rewritten }))
        : new Response(JSON.stringify(analysis)),
    )
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(App)
    const original = wrapper.get('textarea').element.value
    const click = async (label: string) => {
      await wrapper
        .findAll('button')
        .find((b) => b.text().includes(label))
        ?.trigger('click')
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    await click('Analyze with AI')
    await click('Rewrite with AI')

    expect(wrapper.get('textarea').element.value).toBe(rewritten)
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).suggestions).toEqual(
      analysis.suggestions,
    )
    expect(wrapper.get('.score--great').text()).toBe('Great')
    expect(wrapper.text()).toContain('Re-analyze')

    await click('Undo')
    expect(wrapper.get('textarea').element.value).toBe(original)
    expect(wrapper.get('.score--poor').text()).toBe('Poor')
  })
})

afterEach(() => vi.unstubAllGlobals())
