import assert from 'node:assert/strict'
import {
  docStatus,
  matchesDocFilters,
  storyKind,
} from '../src/helper/document-filter.ts'

const doc = (title, tr = '待认领', pr = '待认领') => ({
  number: 1,
  title,
  tr: { user: '', state: tr },
  pr: { user: '', state: pr },
})

assert.equal(storyKind('adv_cidol-hume-3-018_03'), 'cidol')
assert.equal(storyKind('adv_misc_001'), 'other')
assert.equal(docStatus(doc('adv_dear_x', '完成', '进行中')), '校对中')
assert.equal(docStatus(doc('adv_event_x'), true), '已存档')
assert.equal(
  matchesDocFilters(doc('ADV_CSPRT_001'), 'csprt', '待翻译', 'sprt'),
  true
)
