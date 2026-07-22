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

let workUsers: Record<string, { github?: string; qq?: string }> = {}

export function setAssigneeUsers(
  value: Record<string, { github?: string; qq?: string }>
) {
  workUsers = value
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
  updatedAt: string // issue 最后更新时间(ISO)
  sourceCommitTime?: string // 原始文本首次进入源仓库的 commit 时间
  trCsvTime?: string // translated_csv 最后 commit 时间（页面异步填充）
  prCsvTime?: string // proofread_csv 最后 commit 时间（页面异步填充）
}

// 某文件在工作仓库的最后 commit 时间（ISO）；文件不存在返回 ''
export async function fileCommitTime(
  wrapper: any,
  path: string
): Promise<string> {
  try {
    const { data } = await wrapper.request(
      'GET /repos/{owner}/{repo}/commits',
      {
        owner: WORK_OWNER,
        repo: WORK_REPO,
        path,
        per_page: 1,
        headers: { 'X-GitHub-Api-Version': '2022-11-28' },
      }
    )
    return data?.[0]?.commit?.committer?.date || ''
  } catch {
    return ''
  }
}

async function firstFileCommitTimeInRepo(
  wrapper: any,
  owner: string,
  repo: string,
  path: string,
  branch = 'main'
): Promise<string> {
  try {
    for (let page = 1; ; page++) {
      const { data } = await wrapper.request(
        'GET /repos/{owner}/{repo}/commits',
        {
          owner,
          repo,
          sha: branch,
          path,
          per_page: 100,
          page,
          headers: { 'X-GitHub-Api-Version': '2022-11-28' },
        }
      )
      if (!data?.length) return ''
      if (data.length < 100)
        return data[data.length - 1]?.commit?.committer?.date || ''
    }
  } catch {
    return ''
  }
}

export async function docSourceCommitTime(
  wrapper: any,
  d: Pick<DocTask, 'title' | 'rawPath' | 'aiPath'>
): Promise<string> {
  const [owner, repo] = CAMPUS_REPO.split('/')
  const campus = owner && repo
    ? await firstFileCommitTimeInRepo(
        wrapper,
        owner,
        repo,
        `Resource/${d.title}.txt`
      )
    : ''
  return (
    campus ||
    (await firstFileCommitTimeInRepo(
      wrapper,
      WORK_OWNER,
      WORK_REPO,
      d.rawPath,
      WORK_BRANCH
    )) ||
    (await firstFileCommitTimeInRepo(
      wrapper,
      WORK_OWNER,
      WORK_REPO,
      d.aiPath,
      WORK_BRANCH
    ))
  )
}

export function sortBySourceCommitTime(a: DocTask, b: DocTask) {
  return (
    (b.sourceCommitTime || b.updatedAt || '').localeCompare(
      a.sourceCommitTime || a.updatedAt || ''
    ) || a.title.localeCompare(b.title)
  )
}

export async function fillDocSourceCommitTimes(
  wrapper: any,
  docs: DocTask[]
): Promise<DocTask[]> {
  const times = await Promise.all(
    docs.map(async (d) => ({
      number: d.number,
      sourceCommitTime:
        d.sourceCommitTime || (await docSourceCommitTime(wrapper, d)),
    }))
  )
  const byNumber = new Map(times.map((t) => [t.number, t.sourceCommitTime]))
  return docs
    .map((d) => ({ ...d, sourceCommitTime: byNumber.get(d.number) || '' }))
    .sort(sortBySourceCommitTime)
}

export async function fillDocStageCommitTimes(
  wrapper: any,
  docs: DocTask[]
): Promise<DocTask[]> {
  const times = await Promise.all(
    docs.map(async (d) => ({
      number: d.number,
      trCsvTime:
        d.tr.state === '完成' ? await fileCommitTime(wrapper, d.translatedPath) : '',
      prCsvTime:
        d.pr.state === '完成' ? await fileCommitTime(wrapper, d.proofreadPath) : '',
    }))
  )
  const byNumber = new Map(times.map((t) => [t.number, t]))
  return docs.map((d) => ({ ...d, ...byNumber.get(d.number) }))
}

// 校对者直接采用 AI 机翻稿：
// 1) 把 ai_csv 内容原样复制为 translated_csv 快照
// 2) 翻译轨置 完成，译者=校对者（不保留 AI 署名）
export async function aiCompleteTranslation(
  wrapper: any,
  doc: { number: number; aiPath: string; translatedPath: string },
  me: string
): Promise<void> {
  const issue = await wrapper.getIssue(WORK_OWNER, WORK_REPO, doc.number)
  const tr = parseTrack(issue.body, 'tr')
  const pr = parseTrack(issue.body, 'pr')
  if (tr.user || tr.state !== '待认领' || !pr.user || pr.user !== me) {
    throw new Error(
      '只有已认领校对、且翻译无人认领时，校对本人才能采用 AI 机翻稿'
    )
  }
  const src = await wrapper.getContent(
    WORK_OWNER,
    WORK_REPO,
    WORK_BRANCH,
    doc.aiPath,
    true
  )
  const b64 = (src.content as string).replace(/\n/g, '')
  await wrapper.updateContent(
    WORK_OWNER,
    WORK_REPO,
    WORK_BRANCH,
    doc.translatedPath,
    `一键完成翻译(AI) ${doc.translatedPath}`,
    b64
  )
  await updateWorkRecord(
    wrapper,
    doc.translatedPath.replace(/^translated_csv\//, '').replace(/\.csv$/, '').split('/').join('_'),
    'tr',
    me,
    doc.translatedPath,
    '完成',
    true
  )
  const body = setTrackInBody(issue.body, 'tr', {
    user: me,
    state: '完成',
  })
  await wrapper.updateIssue(WORK_OWNER, WORK_REPO, doc.number, { body })
}

// GMT+8 显示，如 07-08 23:45
export function formatGmt8(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
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
  const user =
    Object.entries(workUsers).find(
      ([id, item]) =>
        id === t.user ||
        item.github?.toLocaleLowerCase() === t.user.toLocaleLowerCase() ||
        (t.user.startsWith('qq-') && item.qq === t.user.slice(3))
    )?.[0] || t.user
  const marker = `<!-- ${key}:${user}:${t.state} -->`
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

export function stagePathForTitle(
  title: string,
  stage: 'ai' | 'translated' | 'proofread'
) {
  return csvPathFromTitle(
    title,
    stage === 'ai'
      ? 'ai_csv'
      : stage === 'translated'
      ? 'translated_csv'
      : 'proofread_csv'
  )
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
  return [
    ...new Set(
      [tr.user, pr.user]
        .map((operator) => {
          const value = operator.trim()
          const qq = value.startsWith('qq-') ? value.slice(3) : ''
          const found = Object.entries(workUsers).find(
            ([id, user]) =>
              id === value ||
              (!!qq && user.qq === qq) ||
              user.github?.toLocaleLowerCase() === value.toLocaleLowerCase()
          )
          return found?.[1].github || (!Object.keys(workUsers).length ? value : '')
        })
        .filter(Boolean)
    ),
  ]
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

export function workRawUrl(relPath: string, version = ''): string {
  const query = version ? `?v=${encodeURIComponent(version)}` : ''
  return `https://raw.githubusercontent.com/${WORK_OWNER}/${WORK_REPO}/${WORK_BRANCH}/${relPath}${query}`
}

// 原始 txt 权威源：DreamGallery/Campus-adv-txts（游戏解包 adv 文本镜像）
export const CAMPUS_REPO =
  import.meta.env.VITE_CAMPUS_REPO || 'DreamGallery/Campus-adv-txts'
export function campusRawUrl(flatTxtName: string, version = ''): string {
  const query = version ? `?v=${encodeURIComponent(version)}` : ''
  return `https://raw.githubusercontent.com/${CAMPUS_REPO}/main/Resource/${flatTxtName}${query}`
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

function htmlTagsAreBalanced(tags: string[]): boolean {
  const opens: string[] = []
  return (
    tags.every((tag) => {
      const match = /^<\/?([A-Za-z][A-Za-z0-9_:-]*)/.exec(tag)
      if (!match) return false
      if (tag.startsWith('</')) return opens.pop() === match[1]
      opens.push(match[1])
      return true
    }) && !opens.length
  )
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)))
  return btoa(binary)
}

function base64ToUtf8(value: string): string {
  const bin = atob(String(value || '').replace(/\n/g, ''))
  return new TextDecoder().decode(Uint8Array.from(bin, (char) => char.charCodeAt(0)))
}

export async function updateWorkRecord(
  wrapper: any,
  fileId: string,
  role: TrackKey,
  operatorGithub: string,
  artifactPath = '',
  state: TrackState = '完成',
  directMachine = false
): Promise<boolean> {
  const recordPath = `records/${fileId}.json`
  let operatorQq = ''
  let operatorId = operatorGithub
  try {
    const userFile = await wrapper.getContent(
      WORK_OWNER,
      WORK_REPO,
      WORK_BRANCH,
      'users.json'
    )
    const workUsers = JSON.parse(base64ToUtf8(userFile.content))
    const matched = Object.entries(workUsers || {}).find(
      ([key, user]: [string, any]) =>
        String(user?.github === undefined ? key : user.github)
          .trim()
          .toLocaleLowerCase() === operatorGithub.toLocaleLowerCase()
    )
    operatorId = matched?.[0] || operatorGithub
    operatorQq = String((matched?.[1] as any)?.qq || '').trim()
  } catch {
    /* 身份映射不可用时仍保留 GitHub 操作者 */
  }
  let record: any = {
    schema_version: 1,
    file_id: fileId,
    batch: '',
    category: artifactPath.split('/')[1] || '',
    force_complete: { translation: false, proofread: false },
    translation: { revision: 0, draft_revision: 0 },
    proofread: { revision: 0, draft_revision: 0 },
    artifacts: {},
  }
  try {
    const current = await wrapper.getContent(
      WORK_OWNER,
      WORK_REPO,
      WORK_BRANCH,
      recordPath,
      true
    )
    record = JSON.parse(base64ToUtf8(current.content))
  } catch (error: any) {
    if (error?.response?.status !== 404) throw error
  }
  const directProofread = role === 'pr' && record.direct_machine_proofread === true
  const now = new Date().toISOString()
  const key = role === 'tr' ? 'translation' : 'proofread'
  const artifactKey = role === 'tr' ? 'translation_csv' : 'proofread_csv'
  const track = record[key] || {}
  record[key] = {
    ...track,
    revision:
      state === '完成'
        ? Number(track.revision || 0) + 1
        : Number(track.revision || 0),
    draft_revision: Number(track.draft_revision || 0),
    state,
    operator_qq: operatorQq,
    operator_github: operatorGithub,
    display_id: operatorId,
    display_source: 'github',
    timestamp: now,
  }
  if (artifactPath) {
    record.artifacts = record.artifacts || {}
    record.artifacts[artifactKey] = {
      ...(record.artifacts[artifactKey] || {}),
      path: artifactPath,
      operator_qq: operatorQq,
      operator_github: operatorGithub,
      display_id: operatorId,
      display_source: 'github',
      timestamp: now,
    }
  }
  if (directMachine) record.direct_machine_proofread = true
  if (directProofread) {
    record.translation = {
      ...record.proofread,
      revision: Math.max(1, Number(record.translation?.revision || 0)),
      state: '完成',
    }
    if (record.artifacts?.translation_csv) {
      record.artifacts.translation_csv = {
        ...record.artifacts.translation_csv,
        operator_qq: record.translation.operator_qq,
        operator_github: record.translation.operator_github,
        display_id: record.translation.display_id,
        display_source: record.translation.display_source,
        timestamp: record.translation.timestamp,
      }
    }
    delete record.direct_machine_proofread
  }
  record.github = { ...(record.github || {}), updated_at: now }
  await wrapper.updateContent(
    WORK_OWNER,
    WORK_REPO,
    WORK_BRANCH,
    recordPath,
    `${TRACK_LABEL[role]}${state}记录 ${fileId}`,
    utf8ToBase64(JSON.stringify(record, null, 2) + '\n')
  )
  return directProofread
}

export function validateRowsHtmlTags(
  rows: { id: string; text: string; trans: string }[]
): string[] {
  const errors: string[] = []
  rows.forEach((row, i) => {
    if (row.id === 'info' || row.id === '译者' || !row.trans) return
    const dst = htmlTags(row.trans)
    if (!htmlTagsAreBalanced(dst)) {
      errors.push(
        `第 ${i + 2} 行译文标签无效：[${dst.join(' ')}]`
      )
    }
  })
  return errors
}

export function validateTextHtmlTags(
  _rawTxt: string,
  outputTxt: string
): string[] {
  const dst = htmlTags(outputTxt)
  return htmlTagsAreBalanced(dst) ? [] : ['输出TXT标签无效']
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
    // 重新翻译常开：翻译轨已完成时，任何登录用户显式带 role=tr 进来都可重做
    // （再次完成会覆盖 translated_csv，译者更新为重做者）
    if (tr.state === '完成') {
      if (role === 'tr')
        return { activeRole: 'tr', blocked: false, blockMsg: '' }
      return tr.user === me ? done : none
    }
    if (tr.user !== me) return none
    return { activeRole: 'tr', blocked: false, blockMsg: '' }
  }
  const asPr = (): MyStatus => {
    // 重新校对常开：校对轨已完成时，任何登录用户显式带 role=pr 进来都可重做。
    // （再次完成会覆盖 proofread_csv，校对者更新为重做者）
    if (pr.state === '完成' && role === 'pr' && tr.state === '完成')
      return { activeRole: 'pr', blocked: false, blockMsg: '' }
    if (pr.user !== me) return none
    if (pr.state === '完成' && role !== 'pr') return done
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
    updatedAt: i.updated_at || '',
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

export async function createWorkIssue(
  wrapper: any,
  title: string,
  stage: 'ai' | 'translated' | 'proofread',
  owner = ''
) {
  const aiPath = stagePathForTitle(title, 'ai')
  const translatedPath = stagePathForTitle(title, 'translated')
  const proofreadPath = stagePathForTitle(title, 'proofread')
  const tr: Track = {
    user: stage === 'ai' ? '' : owner,
    state: stage === 'ai' ? '待认领' : '完成',
  }
  const pr: Track = {
    user: stage === 'proofread' ? owner : '',
    state: stage === 'proofread' ? '完成' : '待认领',
  }
  const body = [
    `<!-- raw_path: raw_txt/${title}.txt -->`,
    `<!-- ai_path: ${aiPath} -->`,
    `<!-- translated_path: ${translatedPath} -->`,
    `<!-- proofread_path: ${proofreadPath} -->`,
    setTrackInBody('', 'tr', tr),
    setTrackInBody('', 'pr', pr),
  ].join('\n')
  const { data: issue } = await wrapper.request(
    'POST /repos/{owner}/{repo}/issues',
    {
      owner: WORK_OWNER,
      repo: WORK_REPO,
      title,
      body,
      assignees: assigneesOf(tr, pr),
      headers: wrapper.headers,
    }
  )
  if (stage === 'proofread') {
    await wrapper.updateIssue(WORK_OWNER, WORK_REPO, issue.number, {
      state: 'closed',
    })
  }
  return issue
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
