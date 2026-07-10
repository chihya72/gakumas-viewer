import type { DocTask } from './workflow'

export type StoryKind = 'cidol' | 'csprt' | 'dear' | 'event' | 'other'
export type DocStatus =
  | '待翻译'
  | '翻译中'
  | '待校对'
  | '校对中'
  | '已完成'
  | '已存档'

export function storyKind(title: string): StoryKind {
  return (title
    .match(/(?:^|[_-])(cidol|csprt|dear|event)(?:[_-]|$)/i)?.[1]
    .toLowerCase() || 'other') as StoryKind
}

export function docStatus(d: DocTask, archived = false): DocStatus {
  if (archived) return '已存档'
  if (d.tr.state !== '完成')
    return d.tr.state === '进行中' ? '翻译中' : '待翻译'
  if (d.pr.state !== '完成')
    return d.pr.state === '进行中' ? '校对中' : '待校对'
  return '已完成'
}

export function matchesDocFilters(
  d: DocTask,
  story: StoryKind | 'all',
  status: DocStatus | 'all',
  search: string,
  archived = false
) {
  return (
    (story === 'all' || storyKind(d.title) === story) &&
    (status === 'all' || docStatus(d, archived) === status) &&
    d.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  )
}
