<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, onDeactivated } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { saveAs } from 'file-saver'
import PushHeader from './translate/push/PushHeader.vue'
import { store } from '../store'
import { decodeHomeVoice } from '../helper/home-voice-player'
import {
  localVoiceSource, remoteVoiceSource, parseVoices, previewEdit, mergeVoiceEdits,
  bilingualCsv, voiceTextFiles, saveLocalVoices, saveGithubVoices, importVoiceCsv,
  type HomeVoice, type VoiceEdits, type VoiceSource, type VoiceDirectory,
} from '../helper/home-voice'

const route = useRoute()
const router = useRouter()
const rows = shallowRef<HomeVoice[]>([])
const source = shallowRef<VoiceSource>()
const edits = shallowRef<VoiceEdits>({})
const selectedId = ref(String(route.query.id || ''))
const search = ref('')
const character = ref('')
const state = ref('all')
const page = ref(1)
const pageSize = 25
const busy = ref(false)
const error = ref('')
const notice = ref('')
const commitUrl = ref('')
const owner = ref('chihya72')
const repo = ref('Gakumas-Home-Voice-Translate')
const branch = ref('main')
const fileInput = ref<HTMLInputElement>()
const directoryInput = ref<HTMLInputElement>()
const audio = ref<HTMLAudioElement>()
const audioUrl = ref('')
const decoding = ref(false)
let playbackEpoch = 0
let decodeController: AbortController | undefined

const selected = computed(() => rows.value.find((row) => row.voiceAssetId === selectedId.value))
const editCount = computed(() => Object.keys(edits.value).length)
const characters = computed(() => [...new Map(rows.value.map((row) => [row.characterCode, row.speaker])).entries()])
const visible = computed(() => {
  const query = search.value.trim().toLowerCase()
  return rows.value.filter((row) => {
    const effective = previewEdit(row, edits.value[row.voiceAssetId])
    return (!character.value || row.characterCode === character.value) &&
      (!query || [row.voiceAssetId, row.speaker, effective.ja, effective.zh].join(' ').toLowerCase().includes(query)) &&
      (state.value === 'all' || (state.value === 'draft' && !!edits.value[row.voiceAssetId]) ||
       (state.value === 'pending' && !effective.zh) ||
       (state.value === 'review' && !effective.reviewed && (!!effective.asr_error || !!effective.asr_review?.length)) ||
       (state.value === 'reviewed' && !!effective.reviewed))
  })
})
const pageCount = computed(() => Math.max(1, Math.ceil(visible.value.length / pageSize)))
const paged = computed(() => visible.value.slice((Math.min(page.value, pageCount.value) - 1) * pageSize, Math.min(page.value, pageCount.value) * pageSize))
const currentEdit = computed(() => selected.value && edits.value[selected.value.voiceAssetId])
const jaText = computed({ get: () => currentEdit.value?.ja ?? selected.value?.ja ?? '', set: (value: string) => updateEdit({ ja: value }) })
const zhText = computed({ get: () => currentEdit.value?.zh ?? selected.value?.zh ?? '', set: (value: string) => updateEdit({ zh: value }) })
const keepChinese = computed({ get: () => !!currentEdit.value?.keepChinese, set: (value: boolean) => updateEdit({ keepChinese: value }) })
const reviewed = computed({ get: () => currentEdit.value?.reviewed ?? !!selected.value?.reviewed, set: (value: boolean) => updateEdit({ reviewed: value }) })
const staleChinese = computed(() => !!selected.value && !!currentEdit.value &&
  currentEdit.value.ja !== currentEdit.value.baseJa && currentEdit.value.zh === currentEdit.value.baseZh && !keepChinese.value)

function cacheDrafts() {
  if (!source.value) return
  try { localStorage.setItem(`home-voice-drafts:${source.value.key}`, JSON.stringify(edits.value)) }
  catch { error.value = '浏览器草稿保存失败，请先导出校对 CSV，避免关闭页面后丢失。' }
}
function updateEdit(patch: Partial<VoiceEdits[string]>) {
  const row = selected.value
  if (!row) return
  const current = edits.value[row.voiceAssetId] || { baseJa: row.ja, baseZh: row.zh, ja: row.ja, zh: row.zh }
  edits.value = { ...edits.value, [row.voiceAssetId]: { ...current, ...patch } }
  cacheDrafts()
  notice.value = '已自动保存到浏览器草稿'
}
function discardCurrentDraft() {
  const next = { ...edits.value }
  delete next[selectedId.value]
  edits.value = next
  cacheDrafts()
  notice.value = '本条已恢复为载入的原稿。'
}
function resetFilters() { page.value = 1 }
function stopAudio() {
  playbackEpoch++
  decodeController?.abort()
  audio.value?.pause()
  audio.value?.removeAttribute('src')
  audio.value?.load()
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
  audioUrl.value = ''
  decoding.value = false
}
function select(row: HomeVoice) {
  stopAudio()
  selectedId.value = row.voiceAssetId
  router.replace({ path: '/home-voice', query: { id: row.voiceAssetId } })
}
watch(() => route.query.id, (id) => {
  if (route.path === '/home-voice' && id && String(id) !== selectedId.value) {
    stopAudio()
    selectedId.value = String(id)
  }
})
async function openSource(next: VoiceSource) {
  busy.value = true; error.value = ''; notice.value = ''; commitUrl.value = ''
  try {
    const loaded = await next.load()
    stopAudio()
    rows.value = loaded; source.value = next; page.value = 1
    edits.value = JSON.parse(localStorage.getItem(`home-voice-drafts:${next.key}`) || '{}')
    if (!loaded.some((row) => row.voiceAssetId === selectedId.value)) selectedId.value = loaded[0]?.voiceAssetId || ''
    notice.value = `已读取 ${loaded.length} 条语音；点击播放时解析 ACB。`
  } catch (e: any) { error.value = e.message || String(e) }
  finally { busy.value = false }
}
async function openLocal() {
  error.value = ''
  const picker = (window as unknown as { showDirectoryPicker?: (options: object) => Promise<VoiceDirectory> }).showDirectoryPicker
  if (!picker) { directoryInput.value?.click(); return }
  try {
    const directory = await picker({ mode: 'readwrite' })
    await openSource(localVoiceSource(directory))
  } catch (e: any) { if (e.name !== 'AbortError') error.value = e.message || String(e) }
}
async function openReadOnlyDirectory(event: Event) {
  const files = Array.from((event.target as HTMLInputElement).files || [])
  if (!files.length) return
  const byPath = new Map(files.map((file) => [file.webkitRelativePath.split('/').slice(1).join('/'), file]))
  async function json(path: string) {
    const file = byPath.get(path)
    if (!file) throw new Error(`请选择项目根目录，缺少 ${path}`)
    return JSON.parse(await file.text())
  }
  await openSource({
    key: `local:${files[0].webkitRelativePath.split('/')[0]}`, label: '本地目录（保存时导出 CSV）',
    load: async () => parseVoices(await json('data/voices.json')),
    ui: async () => json('data/subtitle_ui.json'),
    audio: async (row) => {
      const file = byPath.get(row.acb.replace(/\\/g, '/'))
      if (!file) throw new Error(`目录内缺少 ${row.voiceAssetId}.acb`)
      return file.arrayBuffer()
    },
  })
  ;(event.target as HTMLInputElement).value = ''
}
async function openGithub() {
  try {
    const next = remoteVoiceSource(owner.value.trim(), repo.value.trim(), branch.value.trim())
    localStorage.setItem('home-voice-repo', JSON.stringify(next.github))
    await openSource(next)
  } catch (e: any) { error.value = e.message }
}
async function play() {
  if (!selected.value || !source.value) return
  stopAudio()
  const epoch = playbackEpoch
  decodeController = new AbortController()
  decoding.value = true; error.value = ''
  try {
    const buffer = await source.value.audio(selected.value)
    if (epoch !== playbackEpoch) return
    const blob = await decodeHomeVoice(buffer, decodeController.signal)
    if (epoch !== playbackEpoch) return
    audioUrl.value = URL.createObjectURL(blob)
    if (audio.value) {
      audio.value.src = audioUrl.value
      await audio.value.play()
    }
  } catch (e: any) {
    if (e.name !== 'AbortError' && epoch === playbackEpoch) error.value = e.message || String(e)
  } finally { if (epoch === playbackEpoch) decoding.value = false }
}
async function save() {
  if (!source.value || !editCount.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    let saved: HomeVoice[]
    if (source.value.directory) saved = await saveLocalVoices(source.value, edits.value)
    else if (source.value.github) {
      const result = await saveGithubVoices(source.value, edits.value, store.octokitWrapper)
      saved = result.rows; commitUrl.value = result.url
    } else throw new Error('请导出校对 CSV，再使用 run.py 第 6 项导入；Chrome / Edge 可直接保存本地目录。')
    rows.value = saved; edits.value = {}; cacheDrafts()
    notice.value = saved.some((row) => !row.zh.trim()) ?
      '校对已保存，尚有待更新中文；补齐后再导出正式字幕。上一份完整字幕保留。' : '校对和字幕导出已保存。'
  } catch (e: any) { error.value = e.message || String(e) }
  finally { busy.value = false }
}
async function exportFile(kind: 'csv' | 'json') {
  try {
    const updated = mergeVoiceEdits(rows.value, edits.value)
    if (kind === 'csv') saveAs(new Blob([bilingualCsv(updated)], { type: 'text/csv;charset=utf-8' }), 'home_voice_review.csv')
    else {
      if (updated.some((row) => !row.zh.trim())) throw new Error('还有未翻译或待更新的中文，请补齐后导出正式字幕。')
      const file = voiceTextFiles(updated, await source.value!.ui()).find((file) => file.path.endsWith('subtitles.json'))!
      saveAs(new Blob([file.content], { type: 'application/json;charset=utf-8' }), 'home_voice_subtitles.json')
    }
  } catch (e: any) { error.value = e.message }
}
async function importCsv(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    edits.value = { ...edits.value, ...importVoiceCsv(await file.text(), rows.value) }
    cacheDrafts(); notice.value = 'CSV 校对内容已载入草稿，请检查后保存。'
  } catch (e: any) { error.value = e.message }
  ;(event.target as HTMLInputElement).value = ''
}
onMounted(async () => {
  try {
    const settings = JSON.parse(localStorage.getItem('home-voice-repo') || '{}')
    if (settings.owner) { owner.value = settings.owner; repo.value = settings.repo; branch.value = settings.branch }
  } catch { /* Use the default project when saved settings are invalid. */ }
  if (import.meta.env.DEV) {
    const base = '/home-voice-local/'
    async function request(path: string) {
      const response = await fetch(base + path, { cache: 'no-store' })
      if (!response.ok) throw new Error('本地项目不可用，请打开项目目录或选择 GitHub 仓库。')
      return response
    }
    await openSource({ key: 'dev:home-voice', label: '本地开发项目（选择目录后可保存）',
      load: async () => parseVoices(await (await request('data/voices.json')).json()),
      ui: async () => (await request('data/subtitle_ui.json')).json(),
      audio: async (row) => (await request(row.acb.replace(/\\/g, '/'))).arrayBuffer(),
    })
  } else {
    await openGithub()
  }
})
onDeactivated(stopAudio)
onBeforeUnmount(stopAudio)
</script>

<template>
  <section class="voice-page">
    <push-header title="主页语音校对" />
    <div class="source-bar">
      <button :disabled="busy" @click="openLocal">打开本地项目目录</button>
      <details>
        <summary>GitHub 仓库</summary>
        <div class="repo-fields">
          <label>用户<input v-model="owner" /></label>
          <label>仓库<input v-model="repo" /></label>
          <label>分支<input v-model="branch" /></label>
          <button :disabled="busy" @click="openGithub">读取仓库</button>
        </div>
      </details>
      <span class="source-label">{{ source?.label || '选择语音项目开始校对' }}</span>
    </div>
    <input ref="directoryInput" hidden type="file" webkitdirectory multiple @change="openReadOnlyDirectory" />
    <input ref="fileInput" hidden type="file" accept=".csv,text/csv" @change="importCsv" />
    <p class="hint">点击播放才解析 ACB。音频仅在浏览器内存中使用；本地目录的文件不会上传。</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="notice" role="status" class="notice">{{ notice }} <a v-if="commitUrl" :href="commitUrl" target="_blank" rel="noopener">查看提交</a></p>
    <div v-if="rows.length" class="workspace">
      <aside class="voice-list">
        <div class="filters">
          <label>搜索 ID 或台词<input v-model="search" type="search" @input="resetFilters" /></label>
          <div class="filter-row">
            <label>角色<select v-model="character" @change="resetFilters"><option value="">全部角色</option><option v-for="[code, name] in characters" :key="code" :value="code">{{ name || code }}</option></select></label>
            <label>状态<select v-model="state" @change="resetFilters"><option value="all">全部</option><option value="draft">有草稿</option><option value="pending">中文待更新</option><option value="review">识别待复核</option><option value="reviewed">已校对</option></select></label>
          </div>
          <span class="hint">匹配 {{ visible.length }} / {{ rows.length }} 条</span>
        </div>
        <div class="list-items" aria-label="语音列表">
          <button v-for="row in paged" :key="row.voiceAssetId" :class="{ active: row.voiceAssetId === selectedId }" :aria-pressed="row.voiceAssetId === selectedId" @click="select(row)">
            <span class="row-heading">{{ row.speaker }} <small v-if="edits[row.voiceAssetId]">有草稿</small><small v-else-if="row.reviewed">已校对</small></span>
            <span class="voice-id">{{ row.voiceAssetId }}</span>
            <span class="preview">{{ previewEdit(row, edits[row.voiceAssetId]).ja || '待识别' }}</span>
          </button>
        </div>
        <div class="pagination"><button :disabled="page <= 1" @click="page--">上一页</button><span>{{ Math.min(page, pageCount) }} / {{ pageCount }}</span><button :disabled="page >= pageCount" @click="page++">下一页</button></div>
      </aside>
      <article v-if="selected" class="editor">
        <div class="editor-title"><h2>{{ selected.speaker }} <span>语音校对</span></h2><label class="check"><input v-model="reviewed" type="checkbox" />已校对</label></div>
        <p class="voice-id selected-id">{{ selected.voiceAssetId }}</p>
        <div class="player">
          <button class="primary" :disabled="decoding" @click="play">{{ decoding ? '解析 ACB…' : '播放 / 重播' }}</button>
          <button :disabled="!audioUrl && !decoding" @click="stopAudio">停止</button>
          <audio ref="audio" controls preload="none" aria-label="主页语音播放器" />
        </div>
        <p v-if="selected.asr_error || selected.asr_review?.length" class="hint">识别提示：{{ selected.asr_error || selected.asr_review?.join('、') }}</p>
        <label class="text-field">日语 · OpenMOSS 转写<textarea v-model="jaText" lang="ja" rows="6" spellcheck="false" /></label>
        <label class="text-field">简体中文 · 机翻与校对<textarea v-model="zhText" lang="zh-CN" rows="6" spellcheck="false" /></label>
        <div v-if="currentEdit?.ja !== undefined && currentEdit.ja !== currentEdit.baseJa" class="source-changed">
          <p v-if="staleChinese">日文已修改，当前旧中文将在保存时清空。请同步校对中文，或确认它仍然适用。</p>
          <label class="check"><input v-model="keepChinese" type="checkbox" />确认保留当前中文</label>
        </div>
        <details class="original"><summary>查看本次载入的原稿</summary><p lang="ja">{{ selected.ja }}</p><p lang="zh-CN">{{ selected.zh }}</p></details>
        <div class="actions">
          <button class="primary" :disabled="busy || !editCount || (!source?.directory && !source?.github)" @click="save">{{ busy ? '保存中…' : source?.github ? '提交文本到 GitHub' : '保存到本地项目' }}{{ editCount ? `（${editCount} 条）` : '' }}</button>
          <button :disabled="busy" @click="exportFile('csv')">导出校对 CSV</button>
          <button :disabled="busy" @click="fileInput?.click()">导入校对 CSV</button>
          <button :disabled="busy" @click="exportFile('json')">导出中文字幕</button>
          <button v-if="currentEdit" :disabled="busy" @click="discardCurrentDraft">撤销本条草稿</button>
        </div>
        <p class="hint">编辑自动暂存到浏览器。CSV 使用字面量 \n，导出 JSON 保留换行。重新识别或补齐机翻使用本地 run.py 第 3、4 步。</p>
      </article>
    </div>
    <div v-else-if="!busy" class="empty">打开 <b>Gakumas-Home-Voice-Translate</b> 项目目录即可读取 ACB 和日中对照文本。也可读取已发布的 GitHub 仓库。</div>
    <p v-if="busy && !rows.length" role="status">正在读取语音总表…</p>
  </section>
</template>

<style scoped>
.voice-page { --voice-ink: #0f172a; --voice-muted: #475569; --voice-border: #cbd5e1; --voice-primary: #075985; color: var(--voice-ink); }
.source-bar, .repo-fields, .filter-row, .pagination, .editor-title, .player, .actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.source-bar { margin: 16px 0 8px; }
.source-label { font-size: 13px; color: var(--voice-muted); overflow-wrap: anywhere; }
button, input, select, textarea { font: inherit; }
button { min-height: 44px; border: 1px solid var(--voice-border); border-radius: 6px; padding: 8px 12px; background: #fff; color: var(--voice-ink); cursor: pointer; }
button:hover { background: #f0f9ff; }
button:disabled { opacity: .55; cursor: default; }
button.primary { color: #fff; background: var(--voice-primary); border-color: var(--voice-primary); }
button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, summary:focus-visible { outline: 3px solid #0284c7; outline-offset: 2px; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
input:not([type=checkbox]), select, textarea { width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid var(--voice-border); border-radius: 6px; color: var(--voice-ink); background: #fff; min-height: 44px; }
summary { cursor: pointer; min-height: 44px; line-height: 44px; }
.repo-fields { padding: 12px 0; align-items: end; }
.repo-fields label { flex: 1; min-width: 140px; }
.hint { color: var(--voice-muted); font-size: 13px; line-height: 1.6; }
.error, .notice { padding: 12px; border-radius: 6px; overflow-wrap: anywhere; }
.error { color: #991b1b; background: #fef2f2; }
.notice { color: #075985; background: #f0f9ff; }
.workspace { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 16px; align-items: start; }
.voice-list, .editor { background: #fff; border: 1px solid var(--voice-border); border-radius: 8px; }
.filters { display: grid; gap: 12px; padding: 16px; border-bottom: 1px solid var(--voice-border); }
.filter-row label { flex: 1; min-width: 0; }
.list-items { max-height: 590px; overflow-y: auto; }
.list-items button { display: grid; gap: 6px; width: 100%; text-align: left; border: 0; border-bottom: 1px solid #e2e8f0; border-radius: 0; padding: 12px 16px; }
.list-items button.active { background: #e0f2fe; box-shadow: inset 3px 0 var(--voice-primary); }
.row-heading { font-weight: 600; }
.row-heading small { margin-left: 8px; font-weight: 400; color: var(--voice-primary); }
.voice-id { font-family: monospace; font-size: 12px; overflow-wrap: anywhere; color: var(--voice-muted); }
.preview { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pagination { padding: 12px; justify-content: space-between; font-size: 13px; }
.editor { padding: 20px; }
.editor-title { justify-content: space-between; }
h2 { margin: 0; font-size: 22px; }
h2 span { font-size: 14px; font-weight: 400; color: var(--voice-muted); }
.check { flex-direction: row; align-items: center; min-height: 44px; }
.check input { width: 18px; height: 18px; }
.selected-id { margin: 8px 0 16px; }
.player { margin-bottom: 20px; }
audio { flex: 1; min-width: 200px; width: 100%; height: 44px; }
.text-field { margin: 16px 0; font-weight: 600; }
textarea { font-size: 16px; font-weight: 400; line-height: 1.75; resize: vertical; }
.source-changed { color: #854d0e; background: #fefce8; padding: 8px 12px; border-radius: 6px; font-size: 14px; }
.original p { white-space: pre-wrap; line-height: 1.75; }
.actions { border-top: 1px solid var(--voice-border); padding-top: 16px; margin-top: 16px; }
.empty { padding: 40px 24px; text-align: center; border: 1px dashed var(--voice-border); border-radius: 8px; line-height: 1.8; }
@media (max-width: 800px) { .workspace { grid-template-columns: 1fr; } .list-items { max-height: 260px; } .editor { padding: 16px; } .repo-fields { flex-direction: column; align-items: stretch; } label { font-size: 16px; } }
</style>
