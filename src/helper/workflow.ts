// 汉化工作台配置：工作仓库 + 双轨认领模型（翻译 / 校对）
//
// 每篇剧情 = 一个 GitHub Issue。issue body 里嵌两条独立轨道标记：
//   <!-- tr:<用户>:<状态> -->   翻译轨
//   <!-- pr:<用户>:<状态> -->   校对轨
// 状态 ∈ 待认领 / 进行中 / 完成。两轨互不依赖：待翻译时校对也能提前认领；
// 一个人可两轨都接，也可两人分接。issue 的 assignees = 两轨认领人的并集（便于 GitHub 侧可见 + 我的任务过滤）。
// 文件路径用阶段目录标记；旧 issue 的 <!-- path: data/... --> 仍可兼容。

import { parseGithubBlobUrl } from './path'

export const WORK_OWNER = import.meta.env.VITE_WORK_OWNER || 'chihya72'
export const WORK_REPO =
  import.meta.env.VITE_WORK_REPO || 'gakumas-translation-work'
export const WORK_BRANCH = import.meta.env.VITE_WORK_BRANCH || 'main'

export const STATES = ['待认领', '进行中', '完成'] as const
export type TrackState = (typeof STATES)[number]
export const ARCHIVED_LABEL = '已存档'

export type TrackKey = 'tr' | 'pr'
export const TRACK_LABEL: Record<TrackKey, string> = { tr: '翻译', pr: '校对' }

export interface Track {
  user: string
  state: TrackState
}
export interface DocTask {
  number: number
  title: string
  paths: string[]
  rawPath: string
  aiPath: string
  translatedPath: string
  proofreadPath: string
  tr: Track
  pr: Track
}

function markerRe(key: TrackKey) {
  return new RegExp(`<!--\\s*${key}:([^:>]*):([^>]*?)-->`)
}

export function parseTrack(
  body: string | null | undefined,
  key: TrackKey
): Track {
  const m = (body || '').match(markerRe(key))
  if (!m) return { user: '', state: '待认领' }
  const user = m[1].trim()
  const state = m[2].trim() as TrackState
  return { user, state: STATES.includes(state) ? state : '待认领' }
}

// 把某轨道写回 body（有则替换，无则追加）
export function setTrackInBody(
  body: string | null | undefined,
  key: TrackKey,
  t: Track
): string {
  const marker = `<!-- ${key}:${t.user}:${t.state} -->`
  const re = markerRe(key)
  const b = body || ''
  if (re.test(b)) return b.replace(re, marker)
  return (b.trimEnd() + '\n' + marker).trim()
}

export function pathsFromBody(body: string | null | undefined): string[] {
  const out: string[] = []
  const re = /<!--\s*path:\s*(.+?)\s*-->/g
  let m
  while ((m = re.exec(body || ''))) out.push(m[1].trim())
  return out
}

function markerPath(body: string | null | undefined, key: string): string {
  const m = (body || '').match(new RegExp(`<!--\\s*${key}:\\s*(.+?)\\s*-->`))
  return m ? m[1].trim() : ''
}

function csvPathFromTitle(title: string, dir: string): string {
  return `${dir}/${title.split('_').join('/')}.csv`
}

function stagePathFromAny(path: string, title: string, dir: string): string {
  if (!path) return csvPathFromTitle(title, dir)
  const parts = path.split('/')
  if (
    ['data', 'ai_csv', 'translated_csv', 'proofread_csv'].includes(parts[0])
  ) {
    return [dir, ...parts.slice(1)].join('/')
  }
  return csvPathFromTitle(title, dir)
}

export function stagePath(
  d: DocTask,
  stage: 'ai' | 'translated' | 'proofread'
) {
  if (stage === 'ai') return d.aiPath
  if (stage === 'translated') return d.translatedPath
  return d.proofreadPath
}

export function completionPath(
  sourcePath: string,
  title: string,
  role: TrackKey
) {
  return stagePathFromAny(
    sourcePath,
    title,
    role === 'tr' ? 'translated_csv' : 'proofread_csv'
  )
}

// 两轨认领人并集（去空、去重）
export function assigneesOf(tr: Track, pr: Track): string[] {
  return [...new Set([tr.user, pr.user].filter(Boolean))]
}

export function editorUrlForPath(
  path: string,
  issue?: number,
  role?: TrackKey
): string {
  const blob = `https://github.com/${WORK_OWNER}/${WORK_REPO}/blob/${WORK_BRANCH}/${path}`
  const q = issue ? `&issue=${issue}` : ''
  const r = role ? `&role=${role}` : ''
  // forceReload：keep-alive 的编辑器靠此 query 触发重新加载
  return `/translate?source=remote&forceReload=1${q}${r}#${blob}`
}

// 把内容直推回它被读取的源路径（同 owner/repo/branch/path），返回 commit 结果
export async function pushContentToSource(
  wrapper: any,
  sourceUrl: string,
  base64: string,
  message: string
) {
  const { owner, repo, branch, path } = parseGithubBlobUrl(sourceUrl)
  return wrapper.updateContent(owner, repo, branch, path, message, base64)
}

export async function pushContentToWorkPath(
  wrapper: any,
  path: string,
  base64: string,
  message: string
) {
  return wrapper.updateContent(
    WORK_OWNER,
    WORK_REPO,
    WORK_BRANCH,
    path,
    message,
    base64
  )
}

// ===== 网页端产物下载：成品 CSV / 纯中文 txt =====

// 预翻译仓库(=Gakumas-Auto-Translate)的 owner/repo/branch，人名字典在其根目录
const preDirMatch = (
  (import.meta.env.VITE_PRETRANSLATION_DIR as string) || ''
).match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)/)
const DICT_URL = preDirMatch
  ? `https://raw.githubusercontent.com/${preDirMatch[1]}/${preDirMatch[2]}/${preDirMatch[3]}/name_dictionary.json`
  : ''

export function workRawUrl(relPath: string): string {
  return `https://raw.githubusercontent.com/${WORK_OWNER}/${WORK_REPO}/${WORK_BRANCH}/${relPath}?t=${Date.now()}`
}

// 原始 txt 权威源：DreamGallery/Campus-adv-txts（游戏解包 adv 文本镜像）
export const CAMPUS_REPO =
  import.meta.env.VITE_CAMPUS_REPO || 'DreamGallery/Campus-adv-txts'
export function campusRawUrl(flatTxtName: string): string {
  return `https://raw.githubusercontent.com/${CAMPUS_REPO}/main/Resource/${flatTxtName}?t=${Date.now()}`
}

// 取原始 txt：campus 权威源优先，工作仓库 raw/ 兜底
export async function fetchRawTxt(title: string): Promise<string | null> {
  const name = `${title}.txt`
  for (const url of [
    workRawUrl(`raw_txt/${name}`),
    campusRawUrl(name),
    workRawUrl(`raw/${name}`),
  ]) {
    try {
      const r = await fetch(url)
      if (r.ok) return await r.text()
    } catch {
      /* try next */
    }
  }
  return null
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const HTML_TAG_RE = /<\/?[A-Za-z][A-Za-z0-9_:-]*(?:\\=[^>]*)?>/g

function htmlTags(text: string): string[] {
  return text.match(HTML_TAG_RE) || []
}

export function validateRowsHtmlTags(
  rows: { id: string; text: string; trans: string }[]
): string[] {
  const errors: string[] = []
  rows.forEach((row, i) => {
    if (row.id === 'info' || row.id === '译者' || !row.trans) return
    const src = htmlTags(row.text)
    const dst = htmlTags(row.trans)
    if (src.join('\u0000') !== dst.join('\u0000')) {
      errors.push(
        `第 ${i + 2} 行标签不一致：原文[${src.join(' ')}] 译文[${dst.join(
          ' '
        )}]`
      )
    }
  })
  return errors
}

export function validateTextHtmlTags(
  rawTxt: string,
  outputTxt: string
): string[] {
  const src = htmlTags(rawTxt)
  const dst = htmlTags(outputTxt)
  return src.join('\u0000') === dst.join('\u0000')
    ? []
    : [`原始TXT有 ${src.length} 个标签，输出TXT有 ${dst.length} 个标签`]
}

// 移植自本地 merger.process_chinese_only：把 CSV 译文回填进原始 txt，生成纯中文 txt。
export function buildChineseTxt(
  rawTxt: string,
  rows: { id: string; name: string; text: string; trans: string }[],
  nameDict: Record<string, string>
): string {
  const rowErrors = validateRowsHtmlTags(rows)
  if (rowErrors.length) throw new Error(rowErrors.slice(0, 5).join('\n'))
  let content = rawTxt
  const items = rows
    .filter((r) => r.text && r.trans)
    .sort((a, b) => b.text.length - a.text.length)
  for (const row of items) {
    const orig = escapeRe(row.text)
    let prefix: string | null = null
    if (row.id === 'select') prefix = 'choice text='
    else if (row.id === '0000000000000' && row.name === '__title__')
      prefix = 'title title='
    else if (row.id === '0000000000000' && row.name === '__narration__')
      prefix = 'narration text='
    else if (row.id === '0000000000000') prefix = 'message text='
    if (prefix) {
      content = content.replace(
        new RegExp(`(${escapeRe(prefix).replace(/=$/, '=')})${orig}`, 'g'),
        `$1${row.trans.replace(/\$/g, '$$$$')}`
      )
    }
    // 人名替换（精确匹配字典键）
    if (row.name && nameDict[row.name] && nameDict[row.name] !== row.name) {
      content = content.replace(
        new RegExp(`(name=)${escapeRe(row.name)}`, 'g'),
        `$1${nameDict[row.name].replace(/\$/g, '$$$$')}`
      )
    }
  }
  const textErrors = validateTextHtmlTags(rawTxt, content)
  if (textErrors.length) throw new Error(textErrors.join('\n'))
  return content
}

export async function fetchNameDict(): Promise<Record<string, string>> {
  if (!DICT_URL) return {}
  try {
    const r = await fetch(`${DICT_URL}?t=${Date.now()}`)
    if (!r.ok) return {}
    return await r.json()
  } catch {
    return {}
  }
}

// 我在本篇的当前状态：担任哪一轨、是否被"翻译未完成"挡住校对编辑
export interface MyStatus {
  activeRole: TrackKey | null // 当前可编辑/可完成的轨
  blocked: boolean // 认领了校对但翻译未完成 → 暂不能编辑
  blockMsg: string
  finished?: boolean // 指定的轨已完成 → 只读展示
}
// role 显式指定"从哪一列打开"（工作台点翻译列/校对列）；不传则翻译优先推断。
export function myStatusOf(
  tr: Track,
  pr: Track,
  me: string,
  role?: TrackKey
): MyStatus {
  const none: MyStatus = { activeRole: null, blocked: false, blockMsg: '' }
  const done: MyStatus = {
    activeRole: null,
    blocked: false,
    blockMsg: '',
    finished: true,
  }
  if (!me) return none
  const asTr = (): MyStatus => {
    if (tr.user !== me) return none
    if (tr.state === '完成') return done
    return { activeRole: 'tr', blocked: false, blockMsg: '' }
  }
  const asPr = (): MyStatus => {
    if (pr.user !== me) return none
    if (pr.state === '完成') return done
    if (tr.state === '完成')
      return { activeRole: 'pr', blocked: false, blockMsg: '' }
    // 认领了校对但翻译未完成 → 只读
    return {
      activeRole: null,
      blocked: true,
      blockMsg: '翻译尚未完成，暂不能校对',
    }
  }
  if (role === 'tr') return asTr()
  if (role === 'pr') return asPr()
  // 未指定：翻译优先，其次校对，最后已完成态
  const t = asTr()
  if (t.activeRole) return t
  const p = asPr()
  if (p.activeRole || p.blocked) return p
  return t.finished ? t : p
}

export function docFromIssue(i: any): DocTask {
  const paths = pathsFromBody(i.body)
  const legacy = paths[0] || ''
  return {
    number: i.number,
    title: i.title,
    paths,
    rawPath: markerPath(i.body, 'raw_path') || `raw_txt/${i.title}.txt`,
    aiPath:
      markerPath(i.body, 'ai_path') ||
      stagePathFromAny(legacy, i.title, 'ai_csv'),
    translatedPath:
      markerPath(i.body, 'translated_path') ||
      stagePathFromAny(legacy, i.title, 'translated_csv'),
    proofreadPath:
      markerPath(i.body, 'proofread_path') ||
      stagePathFromAny(legacy, i.title, 'proofread_csv'),
    tr: parseTrack(i.body, 'tr'),
    pr: parseTrack(i.body, 'pr'),
  }
}

export function issueLabelNames(i: any): string[] {
  return (i.labels || []).map((l: any) => (typeof l === 'string' ? l : l.name))
}

export function isArchivedIssue(i: any): boolean {
  return issueLabelNames(i).includes(ARCHIVED_LABEL)
}

export async function archiveIssue(wrapper: any, issueNumber: number) {
  const issue = await wrapper.getIssue(WORK_OWNER, WORK_REPO, issueNumber)
  const labels = [...new Set([...issueLabelNames(issue), ARCHIVED_LABEL])]
  await wrapper.updateIssue(WORK_OWNER, WORK_REPO, issueNumber, {
    labels,
    state: 'closed',
  })
}

export async function restoreIssue(wrapper: any, issueNumber: number) {
  const issue = await wrapper.getIssue(WORK_OWNER, WORK_REPO, issueNumber)
  const labels = issueLabelNames(issue).filter((l) => l !== ARCHIVED_LABEL)
  await wrapper.updateIssue(WORK_OWNER, WORK_REPO, issueNumber, {
    labels,
    state: 'open',
  })
}

export async function updateTracks(
  wrapper: any,
  issueNumber: number,
  tr: Track,
  pr: Track
) {
  const issue = await wrapper.getIssue(WORK_OWNER, WORK_REPO, issueNumber)
  let body = setTrackInBody(issue.body, 'tr', tr)
  body = setTrackInBody(body, 'pr', pr)
  const done = tr.state === '完成' && pr.state === '完成'
  const archived = issueLabelNames(issue).includes(ARCHIVED_LABEL)
  await wrapper.updateIssue(WORK_OWNER, WORK_REPO, issueNumber, {
    body,
    assignees: assigneesOf(tr, pr),
    state: archived ? issue.state : done ? 'closed' : 'open',
  })
}

// 统一的轨道更新：拉最新 body → 改指定轨 → 回写 body + 同步 assignees（两轨全完成则关 issue）
// wrapper 用 any 以免和 auth.ts 形成类型耦合
export async function applyTrack(
  wrapper: any,
  issueNumber: number,
  key: TrackKey,
  track: Track
): Promise<void> {
  const issue = await wrapper.getIssue(WORK_OWNER, WORK_REPO, issueNumber)
  const body = setTrackInBody(issue.body, key, track)
  const tr = key === 'tr' ? track : parseTrack(body, 'tr')
  const pr = key === 'pr' ? track : parseTrack(body, 'pr')
  const done = tr.state === '完成' && pr.state === '完成'
  await wrapper.updateIssue(WORK_OWNER, WORK_REPO, issueNumber, {
    body,
    assignees: assigneesOf(tr, pr),
    state: done ? 'closed' : 'open',
  })
}
