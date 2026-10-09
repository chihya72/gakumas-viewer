import Papa from 'papaparse'

export interface HomeVoice {
  voiceAssetId: string
  characterCode: string
  speaker: string
  acb: string
  wav: string
  ja: string
  zh: string
  asr_error?: string
  asr_review?: string[]
  ja_origin?: string
  zh_origin?: string
  reviewed?: boolean
  reviewed_at?: string
  [key: string]: unknown
}
export interface VoiceEdit {
  baseJa: string
  baseZh: string
  ja: string
  zh: string
  keepChinese?: boolean
  reviewed?: boolean
}
export type VoiceEdits = Record<string, VoiceEdit>
export interface VoiceSource {
  label: string
  key: string
  load(): Promise<HomeVoice[]>
  audio(row: HomeVoice): Promise<ArrayBuffer>
  ui(): Promise<Record<string, unknown>>
  github?: { owner: string; repo: string; branch: string }
}

export function parseVoices(value: unknown): HomeVoice[] {
  if (!Array.isArray(value)) throw new Error('仓库的 data/voices.json 不是有效语音总表')
  const ids = new Set<string>()
  for (const row of value) {
    if (!row || typeof row.voiceAssetId !== 'string' || ids.has(row.voiceAssetId) ||
        typeof row.ja !== 'string' || typeof row.zh !== 'string' ||
        typeof row.acb !== 'string') throw new Error('语音总表有缺失字段或重复 ID')
    ids.add(row.voiceAssetId)
    safeAcbPath(row.acb)
  }
  return value
}

export function safeAcbPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (!/^audio\/acb\/sud_vo_[a-zA-Z0-9_-]+\.acb$/.test(normalized)) {
    throw new Error(`无效 ACB 路径：${path}`)
  }
  return normalized
}

export function homeVoiceStatus(row: HomeVoice): 'ai_review' | 'pending' | 'reviewed' {
  if (row.reviewed) return 'reviewed'
  if (!row.ja.trim() || row.asr_error || row.asr_review?.length) return 'ai_review'
  return 'pending'
}

export function escapeVoiceNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\n/g, '\\n')
}

export function completedVoiceEdit(row: HomeVoice, edit?: VoiceEdit): VoiceEdit {
  const current = edit || { baseJa: row.ja, baseZh: row.zh, ja: row.ja, zh: row.zh }
  if (!current.ja.trim()) throw new Error('请填写日语原文后完成校对')
  if (!current.zh.trim()) throw new Error('请填写中文译文后完成校对')
  // Completing review approves both displayed texts, including unchanged Chinese.
  return { ...current, keepChinese: true, reviewed: true }
}

export function remoteVoiceSource(owner: string, repo: string, branch: string): VoiceSource {
  if (![owner, repo].every((part) => /^[\w.-]+$/.test(part)) || !branch.trim()) {
    throw new Error('请填写 GitHub 用户、仓库和分支')
  }
  const base = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}`
  async function request(path: string) {
    const response = await fetch(`${base}/${path}?_=${Date.now()}`, { cache: 'no-store' })
    if (!response.ok) throw new Error(`读取失败（${response.status}）：${path}，请检查仓库是否已发布`)
    return response
  }
  return {
    github: { owner, repo, branch }, key: `github:${owner}/${repo}/${branch}`,
    label: `${owner}/${repo} @ ${branch}`,
    load: async () => parseVoices(await (await request('data/voices.json')).json()),
    ui: async () => (await request('data/subtitle_ui.json')).json(),
    audio: async (row) => (await request(safeAcbPath(row.acb))).arrayBuffer(),
  }
}

export function previewEdit(row: HomeVoice, edit?: VoiceEdit): HomeVoice {
  if (!edit) return row
  const updated = { ...row }
  const jaChanged = edit.ja !== edit.baseJa
  const zh = jaChanged && edit.zh === edit.baseZh && !edit.keepChinese ? '' : edit.zh
  if (jaChanged) {
    updated.ja = edit.ja
    updated.ja_origin = 'manual_viewer'
    updated.asr_error = ''
    updated.asr_review = []
  }
  if (jaChanged || zh !== edit.baseZh) {
    updated.zh = zh
    updated.zh_origin = zh ? 'manual_viewer' : ''
    delete updated.translation_model
    delete updated.zh_normalization
  }
  if (edit.reviewed !== undefined) {
    updated.reviewed = edit.reviewed
    if (edit.reviewed) updated.reviewed_at = new Date().toISOString()
    else delete updated.reviewed_at
  }
  return updated
}

export function mergeVoiceEdits(latest: HomeVoice[], edits: VoiceEdits): HomeVoice[] {
  const known = new Set(latest.map((row) => row.voiceAssetId))
  for (const id of Object.keys(edits)) {
    if (!known.has(id)) throw new Error(`语音已从总表移除：${id}`)
  }
  return latest.map((row) => {
    const edit = edits[row.voiceAssetId]
    if (!edit) return row
    if (row.ja !== edit.baseJa || row.zh !== edit.baseZh) {
      throw new Error(`这条语音已被其他操作修改：${row.voiceAssetId}。草稿已保留，请复制修改内容，刷新后对照最新原稿合并。`)
    }
    if (!edit.ja.trim()) throw new Error(`日语原文不能为空：${row.voiceAssetId}`)
    return previewEdit(row, edit)
  })
}

export function bilingualCsv(rows: HomeVoice[]): string {
  return '\uFEFF' + Papa.unparse({
    fields: ['voiceAssetId', 'speaker', 'ja', 'zh'],
    data: rows.map((row) => [row.voiceAssetId, row.speaker, escapeVoiceNewlines(row.ja), escapeVoiceNewlines(row.zh)]),
  }) + '\r\n'
}

export function voiceTextFiles(rows: HomeVoice[], ui: Record<string, unknown>) {
  const stringify = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
  const bilingual = rows.map(({ voiceAssetId, speaker, ja, zh }) => ({ voiceAssetId, speaker, ja, zh }))
  const files = [
    { path: 'data/voices.json', content: stringify(rows) },
    { path: 'exports/home_voice_bilingual.json', content: stringify(bilingual) },
    { path: 'exports/home_voice_bilingual.csv', content: bilingualCsv(rows) },
  ]
  if (rows.every((row) => row.zh.trim())) {
    files.push({ path: 'exports/home_voice_subtitles.json', content: stringify({
      ...ui, screenRect: [0.60, 0.686, 0.38, 0.094],
      subtitles: rows.map(({ voiceAssetId, zh }) => ({ voiceAssetId, text: zh })),
    }) })
  }
  return files
}

function encodeUtf8(text: string) {
  let binary = ''
  new TextEncoder().encode(text).forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

export async function saveGithubVoices(source: VoiceSource, edits: VoiceEdits, wrapper: any) {
  if (!source.github || !wrapper?.userMeta) throw new Error('请先在 viewer 登录 GitHub')
  const target = source.github
  const headers = wrapper.headers
  const { data: ref } = await wrapper.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
    ...target, ref: `heads/${target.branch}`, _cb: Date.now(), headers,
  })
  const head = ref.object.sha
  const { data: commit } = await wrapper.request('GET /repos/{owner}/{repo}/git/commits/{commit_sha}', {
    ...target, commit_sha: head, headers,
  })
  async function json(path: string) {
    let { data } = await wrapper.request('GET /repos/{owner}/{repo}/contents/{path}', {
      ...target, path, ref: head, headers,
    })
    if (data.encoding !== 'base64') {
      const response = await wrapper.request('GET /repos/{owner}/{repo}/git/blobs/{file_sha}', {
        ...target, file_sha: data.sha, headers,
      })
      data = response.data
    }
    const bytes = Uint8Array.from(atob(data.content.replace(/\s/g, '')), (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes))
  }
  const rows = mergeVoiceEdits(parseVoices(await json('data/voices.json')), edits)
  const files = voiceTextFiles(rows, await json('data/subtitle_ui.json'))
  const tree = []
  for (const file of files) {
    const { data } = await wrapper.request('POST /repos/{owner}/{repo}/git/blobs', {
      ...target, content: encodeUtf8(file.content), encoding: 'base64', headers,
    })
    tree.push({ path: file.path, mode: '100644', type: 'blob', sha: data.sha })
  }
  const { data: newTree } = await wrapper.request('POST /repos/{owner}/{repo}/git/trees', {
    ...target, base_tree: commit.tree.sha, tree, headers,
  })
  const { data: newCommit } = await wrapper.request('POST /repos/{owner}/{repo}/git/commits', {
    ...target, tree: newTree.sha, parents: [head], message: `校对主页语音 ${Object.keys(edits).length} 条`, headers,
  })
  await wrapper.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
    ...target, ref: `heads/${target.branch}`, sha: newCommit.sha, force: false, headers,
  })
  return { rows, url: `https://github.com/${target.owner}/${target.repo}/commit/${newCommit.sha}` }
}
