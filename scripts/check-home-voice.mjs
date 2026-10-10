import assert from 'node:assert/strict'
import { build } from 'esbuild'

const compiled = await build({ entryPoints: ['src/helper/home-voice.ts'], bundle: true, write: false, format: 'esm', platform: 'node' })
const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'))
const id = 'sud_vo_system_amao_home_cmmn-03'
const row = { voiceAssetId: id, characterCode: 'amao', speaker: '麻央', acb: `audio\\acb\\${id}.acb`, wav: `audio\\wav\\${id}.wav`, ja: '一行目\n二行目', zh: '第一行\n第二行', translation_model: 'machine' }
const edit = { baseJa: row.ja, baseZh: row.zh, ja: '校正\n原文', zh: row.zh }
assert.equal(api.previewEdit(row, edit).zh, '')
assert.equal(api.previewEdit(row, { ...edit, keepChinese: true }).zh, row.zh)
assert.equal(api.previewEdit(row, { ...edit, zh: '新译文' }).zh, '新译文')
assert.equal(api.previewEdit(row, edit).ja_origin, 'manual_viewer')
assert.equal(api.previewEdit(row, edit).translation_model, undefined)
assert.equal(api.previewEdit({ ...row, reviewed: true }, { ...edit, reviewed: false }).reviewed, false)
assert.throws(() => api.mergeVoiceEdits([{ ...row, zh: '别人的修改' }], { [id]: edit }), /其他操作/)
assert.throws(() => api.mergeVoiceEdits([row], { removed: edit }), /移除/)
assert.throws(() => api.mergeVoiceEdits([row], { [id]: { ...edit, ja: ' ' } }), /不能为空/)
assert.throws(() => api.safeAcbPath('audio/acb/../wav/secret.wav'), /无效/)
assert.equal(api.homeVoiceStatus(row), 'pending')
assert.equal(api.homeVoiceStatus({ ...row, zh: '' }), 'pending')
assert.equal(api.homeVoiceStatus({ ...row, ja: '' }), 'ai_review')
assert.equal(api.homeVoiceStatus({ ...row, asr_error: '识别失败' }), 'ai_review')
assert.equal(api.homeVoiceStatus({ ...row, asr_review: ['no_japanese_kana'] }), 'ai_review')
assert.equal(api.homeVoiceStatus({ ...row, asr_review: ['no_japanese_kana'], reviewed: true }), 'reviewed')
assert.equal(api.escapeVoiceNewlines('一行目\r\n二行目\r三行目\n四行目'), '一行目\\n二行目\\n三行目\\n四行目')
const unchangedReview = api.completedVoiceEdit(row)
assert.equal(unchangedReview.reviewed, true)
assert.equal(api.mergeVoiceEdits([row], { [id]: unchangedReview })[0].zh, row.zh)
const correctedReview = api.completedVoiceEdit(row, edit)
assert.equal(api.mergeVoiceEdits([row], { [id]: correctedReview })[0].zh, row.zh)
assert.throws(() => api.completedVoiceEdit({ ...row, ja: ' ' }), /日语原文/)
assert.throws(() => api.completedVoiceEdit(row, { ...edit, zh: '' }), /中文译文/)
const csv = api.bilingualCsv([row])
assert.equal(csv.trimEnd().split(/\r?\n/).length, 2)
assert.ok(csv.includes('一行目\\n二行目'))
const ui = { enabled: true, screenRect: [0.61, 0.687, 0.38, 0.094], fontSize: 32, textPadding: [64, 64] }
const files = api.voiceTextFiles([row], ui)
assert.equal(files.length, 4)
assert.ok(files.every((file) => !/\.(wav|acb)$/.test(file.path)))
assert.equal(JSON.parse(files[3].content).subtitles[0].text, row.zh)
assert.deepEqual(JSON.parse(files[3].content).screenRect, [0.60, 0.686, 0.38, 0.094])
assert.equal(JSON.parse(files[3].content).fontSize, ui.fontSize)
assert.deepEqual(JSON.parse(files[3].content).textPadding, [48, 48])
assert.deepEqual(ui.textPadding, [64, 64])
assert.deepEqual(ui.screenRect, [0.61, 0.687, 0.38, 0.094])
assert.equal(api.voiceTextFiles([{ ...row, zh: '' }], {}).length, 3)

const githubSource = api.remoteVoiceSource('chihya72', 'gakumas-translation-work', 'main', 'home-voice')
assert.throws(() => api.remoteVoiceSource('chihya72', 'gakumas-translation-work', 'main', '../outside'), /无效/)
const originalFetch = globalThis.fetch
const fetched = []
globalThis.fetch = async (url, options) => {
  fetched.push(new URL(url))
  assert.equal(options.cache, 'no-store')
  return { ok: true, json: async () => url.includes('voices.json') ? [row] : ui, arrayBuffer: async () => new ArrayBuffer(8) }
}
try {
  assert.deepEqual(await githubSource.load(), [row])
  assert.deepEqual(await githubSource.ui(), ui)
  assert.equal((await githubSource.audio(row)).byteLength, 8)
  assert.deepEqual(fetched.map((url) => url.pathname), [
    '/chihya72/gakumas-translation-work/main/home-voice/data/voices.json',
    '/chihya72/gakumas-translation-work/main/home-voice/data/subtitle_ui.json',
    `/chihya72/gakumas-translation-work/main/home-voice/audio/acb/${id}.acb`,
  ])
} finally { globalThis.fetch = originalFetch }

const previousSourceKey = 'github:chihya72/Gakumas-Home-Voice-Translate/main'
const oldDraftKey = `home-voice-drafts:${previousSourceKey}`
const newDraftKey = `home-voice-drafts:${githubSource.key}`
const cachedDrafts = new Map([[oldDraftKey, JSON.stringify({ [id]: edit })]])
const storage = { getItem: (key) => cachedDrafts.get(key) ?? null, setItem: (key, value) => cachedDrafts.set(key, value) }
assert.deepEqual(api.restoreVoiceDrafts(githubSource, storage, previousSourceKey), { [id]: edit })
assert.equal(cachedDrafts.get(newDraftKey), cachedDrafts.get(oldDraftKey))
cachedDrafts.set(newDraftKey, '{}')
assert.deepEqual(api.restoreVoiceDrafts(githubSource, storage, previousSourceKey), {})
cachedDrafts.set(newDraftKey, JSON.stringify({ [id]: correctedReview }))
assert.deepEqual(api.restoreVoiceDrafts(githubSource, storage, previousSourceKey), { [id]: correctedReview })

// Simulate a concurrent edit to another ID: retain it while saving our selected ID.
const other = { ...row, voiceAssetId: 'sud_vo_system_amao_home_cmmn-04', ja: '最新原文', zh: '其他人的译文' }
// GitHub writes are one commit based on the read HEAD; no force push or WAV blob.
const requests = []
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64')
const wrapper = { userMeta: { username: 'tester' }, headers: {}, request: async (endpoint, args) => {
  requests.push({ endpoint, args })
  assert.equal(args.owner, 'chihya72')
  assert.equal(args.repo, 'gakumas-translation-work')
  if (endpoint.includes('git/ref/')) return { data: { object: { sha: 'head' } } }
  if (endpoint.startsWith('GET') && endpoint.includes('git/commits')) return { data: { tree: { sha: 'base-tree' } } }
  if (endpoint.includes('/contents/')) {
    assert.equal(args.ref, 'head')
    assert.ok(['home-voice/data/voices.json', 'home-voice/data/subtitle_ui.json'].includes(args.path))
    return { data: { encoding: 'base64', content: b64(args.path.endsWith('voices.json') ? [row, other] : ui) } }
  }
  return { data: { sha: 'new' } }
} }
const result = await api.saveGithubVoices(githubSource, { [id]: correctedReview }, wrapper)
assert.equal(result.rows[0].ja, edit.ja)
assert.equal(result.rows[0].zh, row.zh)
assert.equal(result.rows[0].reviewed, true)
assert.ok(result.rows[0].reviewed_at)
assert.equal(result.rows[1].zh, other.zh)
assert.equal(result.rows[1].reviewed, undefined)
assert.equal(row.reviewed, undefined)
assert.equal(requests.filter((r) => r.endpoint.startsWith('POST') && r.endpoint.endsWith('/git/blobs')).length, 4)
const tree = requests.find((r) => r.endpoint.endsWith('/git/trees')).args.tree
assert.deepEqual(tree.map((file) => file.path), [
  'home-voice/data/voices.json',
  'home-voice/exports/home_voice_bilingual.json',
  'home-voice/exports/home_voice_bilingual.csv',
  'home-voice/exports/home_voice_subtitles.json',
])
assert.equal(requests.find((r) => r.endpoint.endsWith('/git/trees')).args.base_tree, 'base-tree')
assert.equal(requests.filter((r) => r.endpoint.startsWith('POST') && r.endpoint.endsWith('/git/commits')).length, 1)
assert.equal(requests.filter((r) => r.endpoint.startsWith('PATCH')).length, 1)
assert.equal(result.url, 'https://github.com/chihya72/gakumas-translation-work/commit/new')
const update = requests.at(-1)
assert.equal(update.args.force, false)
assert.deepEqual(requests.find((r) => r.endpoint.startsWith('POST') && r.endpoint.endsWith('/git/commits')).args.parents, ['head'])
const voicesBlob = requests.find((r) => r.endpoint.startsWith('POST') && r.endpoint.endsWith('/git/blobs'))
assert.deepEqual(JSON.parse(Buffer.from(voicesBlob.args.content, 'base64').toString()), result.rows)
const subtitleBlob = requests.filter((r) => r.endpoint.startsWith('POST') && r.endpoint.endsWith('/git/blobs')).at(-1)
assert.deepEqual(JSON.parse(Buffer.from(subtitleBlob.args.content, 'base64').toString()).screenRect, [0.60, 0.686, 0.38, 0.094])
assert.deepEqual(JSON.parse(Buffer.from(subtitleBlob.args.content, 'base64').toString()).textPadding, [48, 48])
requests.length = 0
const reviewedWithoutChanges = await api.saveGithubVoices(githubSource, { [id]: unchangedReview }, wrapper)
assert.equal(reviewedWithoutChanges.rows[0].reviewed, true)
assert.equal(reviewedWithoutChanges.rows[0].ja, row.ja)
assert.equal(reviewedWithoutChanges.rows[0].zh, row.zh)
assert.equal(reviewedWithoutChanges.rows[0].ja_origin, undefined)
assert.equal(requests.filter((r) => r.endpoint.startsWith('POST') && r.endpoint.endsWith('/git/commits')).length, 1)
await assert.rejects(() => api.saveGithubVoices(githubSource, { [id]: unchangedReview }, {}), /登录 GitHub/)
console.log('Home voice checks passed: work repository paths, legacy drafts, review states, literal newlines, unchanged review, current-ID completion, concurrent merge and one text-only GitHub commit.')
