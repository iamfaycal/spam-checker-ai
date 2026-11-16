import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import EmailEditor from '../../src/components/EmailEditor.vue'
import { findHits } from '../../src/lib/spam-check'

function mountEditor(text: string) {
  return mount(EmailEditor, { props: { modelValue: text, hits: findHits(text) } })
}

describe('EmailEditor', () => {
  it('emits update:modelValue when the user types', async () => {
    const wrapper = mountEditor('Hello')
    await wrapper.get('textarea').setValue('Hello ASAP')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['Hello ASAP'])
  })

  it('highlights hits in the backdrop', () => {
    const marks = mountEditor('Please answer ASAP.').findAll('.editor__backdrop mark')
    expect(marks.map((m) => [m.text(), m.classes()])).toContainEqual([
      'ASAP',
      ['hit', 'hit--urgency'],
    ])
  })

  it('never turns user text into HTML elements (review focus #1)', () => {
    const backdrop = mountEditor('<img src=x onerror=alert(1)> ASAP').get('.editor__backdrop')
    expect(backdrop.find('img').exists()).toBe(false)
    expect(backdrop.text()).toContain('<img src=x onerror=alert(1)>')
  })

  it('hides the backdrop from screen readers (the textarea is the real control)', () =>
    expect(mountEditor('Hi').get('.editor__backdrop').attributes('aria-hidden')).toBe('true'))

  it('keeps the backdrop scrolled with the textarea', async () => {
    const wrapper = mountEditor('line\n'.repeat(200))
    const textarea = wrapper.get('textarea').element
    textarea.scrollTop = 120
    await wrapper.get('textarea').trigger('scroll')
    expect(wrapper.get('.editor__backdrop').element.scrollTop).toBe(120)
  })
})
