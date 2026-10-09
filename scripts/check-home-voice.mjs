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
const csv = api.bilingualCsv([row])
assert.equal(csv.trimEnd().split(/\r?\n/).length, 2)
assert.ok(csv.includes('一行目\\n二行目'))
assert.deepEqual(api.importVoiceCsv(csv, [row]), {})
const corrections = api.importVoiceCsv(api.bilingualCsv([{ ...row, ja: edit.ja }]), [row])
assert.equal(corrections[id].ja, edit.ja)
assert.equal(api.mergeVoiceEdits([row], corrections)[0].zh, '')
assert.throws(() => api.importVoiceCsv(csv + csv.split(/\r?\n/)[1], [row]), /重复/)
const files = api.voiceTextFiles([row], { enabled: true })
assert.equal(files.length, 4)
assert.ok(files.every((file) => !/\.(wav|acb)$/.test(file.path)))
assert.equal(JSON.parse(files[3].content).subtitles[0].text, row.zh)
assert.equal(api.voiceTextFiles([{ ...row, zh: '' }], {}).length, 3)

// Simulate a concurrent edit to another ID: retain it while saving our selected ID.
const other = { ...row, voiceAssetId: 'sud_vo_system_amao_home_cmmn-04', ja: '最新原文', zh: '其他人的译文' }
const writes = new Map()
const root = {
  name: 'fixture', getDirectoryHandle: async () => root,
  getFileHandle: async (name) => ({ createWritable: async () => ({ write: async (text) => writes.set(name, text), close: async () => {} }) }),
}
const localSource = { directory: root, load: async () => [row, other], ui: async () => ({ enabled: true }) }
const saved = await api.saveLocalVoices(localSource, { [id]: { ...edit, zh: '校对中文' } })
assert.equal(saved[1].zh, other.zh)
assert.equal(writes.size, 4)
assert.equal(JSON.parse(writes.get('voices.json'))[0].ja, edit.ja)
assert.ok(![...writes.keys()].some((path) => path.endsWith('.wav')))

// GitHub writes are one commit based on the read HEAD; no force push or WAV blob.
const requests = []
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64')
const wrapper = { userMeta: { username: 'tester' }, headers: {}, request: async (endpoint, args) => {
  requests.push({ endpoint, args })
  if (endpoint.includes('git/ref/')) return { data: { object: { sha: 'head' } } }
  if (endpoint.startsWith('GET') && endpoint.includes('git/commits')) return { data: { tree: { sha: 'base-tree' } } }
  if (endpoint.includes('/contents/')) {
    assert.equal(args.ref, 'head')
    return { data: { encoding: 'base64', content: b64(args.path.endsWith('voices.json') ? [row, other] : { enabled: true }) } }
  }
  return { data: { sha: 'new' } }
} }
await api.saveGithubVoices({ github: { owner: 'tester', repo: 'voices', branch: 'main' } }, { [id]: { ...edit, zh: '校对中文' } }, wrapper)
assert.equal(requests.filter((r) => r.endpoint.startsWith('POST') && r.endpoint.endsWith('/git/blobs')).length, 4)
const tree = requests.find((r) => r.endpoint.endsWith('/git/trees')).args.tree
assert.ok(tree.every((file) => file.path.startsWith('data/') || file.path.startsWith('exports/')))
const update = requests.at(-1)
assert.equal(update.args.force, false)
assert.deepEqual(requests.find((r) => r.endpoint.startsWith('POST') && r.endpoint.endsWith('/git/commits')).args.parents, ['head'])
console.log('Home voice checks passed: CSV, corrections, concurrent merge, local saves and text-only GitHub commit.')
