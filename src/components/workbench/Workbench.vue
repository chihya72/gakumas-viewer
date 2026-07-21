<!-- 汉化工作台：全文档总览。一行一剧情，翻译/校对两条独立轨道，各自显示认领人+状态、可各自认领。
     "完成"在编辑器里点，不在这里。 -->
<template>
  <div class="workbench">
    <push-header title="汉化工作台" />

    <div v-if="!store.octokitWrapper?.userMeta" class="hint">
      请先登录 GitHub 账号（需已加入工作组，即对工作仓库有写权限）。
    </div>

    <template v-else>
      <div class="toolbar">
        <n-button size="small" :loading="loading" @click="refresh()"
          >刷新</n-button
        >
        <span class="me">我：{{ displayUser(me) }}</span>
        <n-checkbox v-model:checked="onlyMine">只看我的</n-checkbox>
        <input
          ref="csvUploadInput"
          class="csv-upload-input"
          type="file"
          accept=".csv,text/csv"
          @change="onCsvUploadPicked"
        />
        <template v-if="selected.size">
          <n-button
            size="small"
            type="info"
            :loading="batchBusy"
            @click="batchClaim('tr')"
          >
            批量认领翻译({{ selected.size }})
          </n-button>
          <n-button
            size="small"
            type="info"
            :loading="batchBusy"
            @click="batchClaim('pr')"
          >
            批量认领校对({{ selected.size }})
          </n-button>
        </template>
      </div>

      <n-alert v-if="error" type="error" :bordered="false">{{ error }}</n-alert>

      <doc-filters v-slot="{ rows: filteredRows }" :docs="rows">
        <div v-if="filteredRows.length" class="table-scroll">
          <table class="grid">
            <colgroup>
              <col class="sel-col" />
              <col class="source-col" />
              <col />
              <col class="track-col" />
              <col class="track-col" />
            </colgroup>
            <thead>
              <tr>
                <th class="sel-col">
                  <n-checkbox
                    :checked="areAllSelected(filteredRows)"
                    @update:checked="(v: boolean) => toggleAll(v, filteredRows)"
                  />
                </th>
                <th>入库</th>
                <th>剧情</th>
                <th>翻译</th>
                <th>校对</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="d in filteredRows"
                :key="d.number"
                :class="{ mine: isMine(d) }"
              >
                <td class="sel-col">
                  <n-checkbox
                    :checked="selected.has(d.number)"
                    @update:checked="(v: boolean) => toggleSel(d.number, v)"
                  />
                </td>
                <td class="source-time">
                  {{ formatGmt8(d.sourceCommitTime || '') }}
                </td>
                <td class="doc">
                  <a href="javascript:;" @click="open(d)">{{ d.title }}</a>
                </td>
                <td>
                  <div class="track-line">
                    <n-tag
                      v-if="showTrStatus(d)"
                      class="status-tag"
                      size="small"
                      :type="tagType(d.tr.state)"
                      :bordered="false"
                      :title="trackLabel(d.tr)"
                    >
                      {{ trackLabel(d.tr) }}
                    </n-tag>
                    <span v-if="showTrStatus(d) && d.trCsvTime" class="time">
                      {{ formatGmt8(d.trCsvTime) }}
                    </span>
                    <n-button
                      v-if="showTrDownload(d)"
                      class="neutral-action"
                      size="tiny"
                      @click="downloadCsvPath(d.aiPath, d.title, 'AI机翻')"
                    >
                      下载机翻CSV
                    </n-button>
                    <n-button
                      v-if="d.tr.state === '待认领'"
                      size="tiny"
                      type="info"
                      :disabled="busy === d.number"
                      @click="claim(d, 'tr')"
                    >
                      {{ busy === d.number ? busyText : '认领' }}
                    </n-button>
                    <n-button
                      v-if="canAiComplete(d)"
                      size="tiny"
                      type="warning"
                      :disabled="busy === d.number"
                      @click="aiComplete(d)"
                    >
                      {{ busy === d.number ? busyText : '采用AI稿' }}
                    </n-button>
                    <n-button
                      v-if="d.tr.user === me && d.tr.state === '进行中'"
                      size="tiny"
                      type="primary"
                      @click="open(d, 'tr')"
                    >
                      开始翻译
                    </n-button>
                    <n-button
                      v-if="d.tr.user === me && d.tr.state === '进行中'"
                      size="tiny"
                      type="primary"
                      :disabled="busy === d.number"
                      @click="pickCsvUpload(d, 'tr')"
                    >
                      {{ busy === d.number ? busyText : '上传翻译CSV' }}
                    </n-button>
                    <n-button
                      v-if="showTrDownload(d) && d.tr.state === '完成'"
                      class="neutral-action"
                      size="tiny"
                      @click="open(d, 'tr')"
                    >
                      重新翻译
                    </n-button>
                  </div>
                </td>
                <td>
                  <div class="track-line">
                    <n-tag
                      v-if="showPrStatus(d)"
                      class="status-tag"
                      size="small"
                      :type="
                        d.tr.state === '完成' ? tagType(d.pr.state) : 'default'
                      "
                      :bordered="false"
                      :title="prCellLabel(d)"
                    >
                      {{ prCellLabel(d) }}
                    </n-tag>
                    <span v-if="showPrStatus(d) && d.prCsvTime" class="time">
                      {{ formatGmt8(d.prCsvTime) }}
                    </span>
                    <n-button
                      v-if="d.pr.user === me && d.tr.state === '完成'"
                      class="neutral-action"
                      size="tiny"
                      @click="
                        downloadCsvPath(d.translatedPath, d.title, '翻译')
                      "
                    >
                      下载翻译CSV
                    </n-button>
                    <n-button
                      v-if="
                        d.pr.user === me &&
                        d.tr.state === '完成' &&
                        d.pr.state === '完成'
                      "
                      class="neutral-action"
                      size="tiny"
                      @click="open(d, 'pr')"
                    >
                      重新校对
                    </n-button>
                    <n-button
                      v-if="d.pr.state === '待认领'"
                      size="tiny"
                      type="info"
                      :disabled="busy === d.number"
                      @click="claim(d, 'pr')"
                    >
                      {{ busy === d.number ? busyText : '认领' }}
                    </n-button>
                    <n-button
                      v-if="
                        d.pr.user === me &&
                        d.tr.state === '完成' &&
                        d.pr.state !== '完成'
                      "
                      size="tiny"
                      type="primary"
                      @click="open(d, 'pr')"
                    >
                      开始校对
                    </n-button>
                    <n-button
                      v-if="
                        d.pr.user === me &&
                        d.tr.state === '完成' &&
                        d.pr.state !== '完成'
                      "
                      size="tiny"
                      type="primary"
                      :disabled="busy === d.number"
                      @click="pickCsvUpload(d, 'pr')"
                    >
                      {{ busy === d.number ? busyText : '上传校对CSV' }}
                    </n-button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <n-empty
          v-else-if="!loading"
          :description="
            rows.length ? '没有符合筛选条件的文件' : '工作仓库暂无剧情'
          "
        />
      </doc-filters>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onActivated, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NTag, NEmpty, NAlert, NCheckbox } from 'naive-ui'
import { store } from '../../store'
import PushHeader from '../translate/push/PushHeader.vue'
import DocFilters from './DocFilters.vue'
import FileSaver from 'file-saver'
import { displayUser, loadUsers } from '../../helper/users'
import { extractInfoFromCsvText, type CsvDataLine } from '../../helper/csv'
import {
  WORK_OWNER,
  WORK_REPO,
  WORK_BRANCH,
  docFromIssue,
  formatGmt8,
  fileCommitTime,
  fillDocSourceCommitTimes,
  aiCompleteTranslation,
  isArchivedIssue,
  sortBySourceCommitTime,
  applyTrack,
  editorUrlForPath,
  pushContentToWorkPath,
  updateWorkRecord,
  validateRowsHtmlTags,
  workRawUrl,
  type DocTask,
  type TrackKey,
  type TrackState,
} from '../../helper/workflow'

const router = useRouter()
const loading = ref(false)
const busy = ref<number | null>(null)
const batchBusy = ref(false)
const error = ref('')
const onlyMine = ref(false)
const docs = ref<DocTask[]>([])
const csvUploadInput = ref<HTMLInputElement | null>(null)
const pendingUpload = ref<{ d: DocTask; role: TrackKey } | null>(null)
const busyText = ref('')
let refreshSeq = 0
const activatedRefresh = () => {
  if (!busy.value && !batchBusy.value) refresh(docs.value.length === 0)
}
// 多选（批量认领用）
const selected = ref<Set<number>>(new Set())

function areAllSelected(visible: DocTask[]) {
  return (
    visible.length > 0 && visible.every((d) => selected.value.has(d.number))
  )
}
function toggleSel(n: number, v: boolean) {
  const s = new Set(selected.value)
  if (v) s.add(n)
  else s.delete(n)
  selected.value = s
}
function toggleAll(v: boolean, visible: DocTask[]) {
  const next = new Set(selected.value)
  visible.forEach((d) => (v ? next.add(d.number) : next.delete(d.number)))
  selected.value = next
}

// 批量认领：只处理该轨仍为"待认领"的行，其余静默跳过
async function batchClaim(k: TrackKey) {
  if (!store.octokitWrapper) return
  batchBusy.value = true
  let done = 0
  try {
    for (const d of rows.value) {
      if (!selected.value.has(d.number)) continue
      if (d[k].state !== '待认领') continue
      await applyTrack(store.octokitWrapper, d.number, k, {
        user: me.value,
        state: '进行中',
      })
      done++
    }
    selected.value = new Set()
    await refresh()
    alert(`批量认领${k === 'tr' ? '翻译' : '校对'}完成：${done} 个`)
  } catch (e: any) {
    alert(`批量认领中断：${e?.message || e}（已完成 ${done} 个）`)
    await refresh()
  }
  batchBusy.value = false
}

// 一键完成翻译：直接采用 AI 机翻稿，译者=CSV 里的 AI 名
async function aiComplete(d: DocTask) {
  if (!store.octokitWrapper) return
  if (!confirm(`直接采用 AI 机翻稿作为 ${d.title} 的翻译成稿？`)) return
  busy.value = d.number
  busyText.value = '处理中'
  try {
    await aiCompleteTranslation(store.octokitWrapper, d, me.value)
    await refresh()
  } catch (e: any) {
    alert(`一键完成失败：${e?.message || e}`)
  }
  busy.value = null
  busyText.value = ''
}

const me = computed(() => store.octokitWrapper?.userMeta?.username || '')

function isMine(d: DocTask) {
  return d.tr.user === me.value || d.pr.user === me.value
}
const rows = computed(() =>
  onlyMine.value ? docs.value.filter(isMine) : docs.value
)

function canAiComplete(d: DocTask) {
  return (
    d.tr.state === '待认领' &&
    !d.tr.user &&
    !!d.pr.user &&
    d.pr.user === me.value
  )
}

function tagType(s: TrackState) {
  return s === '完成' ? 'success' : s === '进行中' ? 'warning' : 'default'
}

function trackLabel(t: DocTask['tr']) {
  return t.user ? `${displayUser(t.user)} · ${t.state}` : '待认领'
}

function showTrStatus(d: DocTask) {
  return !isMine(d) || d.tr.state === '待认领'
}

function showTrDownload(d: DocTask) {
  return isMine(d) && d.tr.state !== '待认领'
}

// 校对列显示文案：未认领始终"待认领"；已认领但翻译未完成显示"待校对"
function prCellLabel(d: DocTask) {
  if (!d.pr.user) return '待认领'
  return `${displayUser(d.pr.user)} · ${
    d.tr.state !== '完成' ? '待校对' : d.pr.state
  }`
}

function showPrStatus(d: DocTask) {
  return !isMine(d) || d.pr.state === '待认领' || d.tr.state !== '完成'
}

async function refresh(includeTimes = false) {
  if (!store.octokitWrapper) return
  if (loading.value) return
  const seq = ++refreshSeq
  loading.value = true
  error.value = ''
  try {
    const [, issues] = await Promise.all([
      loadUsers(store.octokitWrapper),
      store.octokitWrapper.listIssues(WORK_OWNER, WORK_REPO),
    ])
    const oldTimes = new Map(docs.value.map((d) => [d.number, d]))
    docs.value = (issues as any[])
      .filter((i) => !i.pull_request && !isArchivedIssue(i))
      .map(docFromIssue)
      .map((d) => {
        const old = oldTimes.get(d.number)
        return {
          ...d,
          sourceCommitTime: old?.sourceCommitTime,
          trCsvTime: old?.trCsvTime,
          prCsvTime: old?.prCsvTime,
        }
      })
      .sort(sortBySourceCommitTime)
    if (includeTimes) fillCommitTimes(seq)
  } catch (e: any) {
    error.value = `加载失败：${e?.message || e}（确认工作仓库存在且有权限）`
  }
  loading.value = false
}

async function fillCommitTimes(seq: number) {
  const w = store.octokitWrapper
  if (!w) return
  const docsWithSourceTime = await fillDocSourceCommitTimes(w, docs.value)
  const times = await Promise.all(
    docsWithSourceTime.map(async (d) => ({
      number: d.number,
      trCsvTime:
        d.tr.state === '完成' ? await fileCommitTime(w, d.translatedPath) : '',
      prCsvTime:
        d.pr.state === '完成' ? await fileCommitTime(w, d.proofreadPath) : '',
    }))
  )
  if (seq !== refreshSeq) return
  const byNumber = new Map(times.map((t) => [t.number, t]))
  docs.value = docsWithSourceTime.map((d) => ({
    ...d,
    ...byNumber.get(d.number),
  }))
}

async function downloadCsvPath(path: string, title: string, label: string) {
  if (!store.octokitWrapper) return
  try {
    const file: any = await store.octokitWrapper.getContent(
      WORK_OWNER,
      WORK_REPO,
      WORK_BRANCH,
      path,
      true
    )
    FileSaver.saveAs(
      new Blob([base64ToUtf8(file.content)], {
        type: 'text/csv;charset=utf-8',
      }),
      `${title}_${label}.csv`
    )
  } catch (e: any) {
    alert(`${label}CSV下载失败：${e?.message || e}`)
  }
}

function validateSourceText(base: CsvDataLine[], uploaded: CsvDataLine[]) {
  if (base.length !== uploaded.length)
    return [`行数不一致：仓库 ${base.length} 行，本地 ${uploaded.length} 行`]
  const errors: string[] = []
  base.forEach((row, i) => {
    const next = uploaded[i]
    if (row.id !== next.id) {
      errors.push(`第 ${i + 2} 行ID不一致：${row.id} / ${next.id}`)
      return
    }
    if (row.text !== next.text) errors.push(`第 ${i + 2} 行日语原文被修改`)
  })
  return errors
}

function utf8ToBase64(text: string) {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin)
}

function base64ToUtf8(b64: string) {
  const bin = atob(b64.replace(/\n/g, ''))
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function pickCsvUpload(d: DocTask, role: TrackKey) {
  pendingUpload.value = { d, role }
  if (!csvUploadInput.value) return
  csvUploadInput.value.value = ''
  csvUploadInput.value.click()
}

async function onCsvUploadPicked(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0] || null
  const job = pendingUpload.value
  if (!file || !job || !store.octokitWrapper) return
  pendingUpload.value = null
  await uploadCsv(job.d, job.role, file)
}

async function uploadCsv(d: DocTask, role: TrackKey, file: File) {
  if (!store.octokitWrapper) return
  const label = role === 'tr' ? '翻译' : '校对'
  const sourcePath = role === 'tr' ? d.aiPath : d.translatedPath
  const targetPath = role === 'tr' ? d.translatedPath : d.proofreadPath
  busy.value = d.number
  busyText.value = role === 'tr' ? '翻译上传中' : '校对上传中'
  try {
    const [baseFile, text] = await Promise.all([
      store.octokitWrapper.getContent(
        WORK_OWNER,
        WORK_REPO,
        WORK_BRANCH,
        sourcePath,
        true
      ),
      file.text(),
    ])
    const base = extractInfoFromCsvText(base64ToUtf8((baseFile as any).content))
    const uploaded = extractInfoFromCsvText(text)
    const textErrors = validateSourceText(base.data, uploaded.data)
    if (textErrors.length)
      throw new Error(
        `日语原文不一致，禁止上传：\n${textErrors.slice(0, 5).join('\n')}`
      )
    const tagErrors = validateRowsHtmlTags(uploaded.data)
    if (tagErrors.length)
      throw new Error(
        `HTML标签无效，禁止上传：\n${tagErrors.slice(0, 5).join('\n')}`
      )
    await pushContentToWorkPath(
      store.octokitWrapper,
      targetPath,
      utf8ToBase64(text),
      `${label}上传完成 ${d.title}`
    )
    await updateWorkRecord(
      store.octokitWrapper,
      d.title,
      role,
      me.value,
      targetPath
    )
    await applyTrack(store.octokitWrapper, d.number, role, {
      user: me.value,
      state: '完成',
    })
    await refresh()
    alert(`${label}CSV上传完成`)
  } catch (e: any) {
    const msg = e?.message || e
    alert(
      String(msg).includes('禁止上传') ? msg : `${label}CSV上传失败：${msg}`
    )
  }
  busy.value = null
  busyText.value = ''
}

function open(d: DocTask, role?: TrackKey) {
  const path =
    role === 'tr'
      ? d.tr.state === '完成'
        ? d.translatedPath
        : d.aiPath
      : role === 'pr'
      ? d.pr.state === '完成'
        ? d.proofreadPath
        : d.translatedPath
      : d.tr.state === '完成'
      ? d.translatedPath
      : d.aiPath
  if (!path) {
    alert('该剧情缺少文件路径标记')
    return
  }
  router.push(editorUrlForPath(path, d.number, role))
}

// 认领某轨：写 我:进行中（不自动跳转，认领后自己点"打开"）
async function claim(d: DocTask, k: TrackKey) {
  if (!store.octokitWrapper) return
  busy.value = d.number
  busyText.value = '认领中'
  try {
    await updateWorkRecord(
      store.octokitWrapper,
      d.title,
      k,
      me.value,
      '',
      '进行中'
    )
    await applyTrack(store.octokitWrapper, d.number, k, {
      user: me.value,
      state: '进行中',
    })
    await refresh()
  } catch (e: any) {
    alert(`认领失败：${e?.message || e}`)
  }
  busy.value = null
  busyText.value = ''
}

watch(
  () => store.octokitWrapper?.userMeta?.username,
  (u) => {
    if (u) refresh()
  }
)
onMounted(() => {
  if (store.octokitWrapper?.userMeta) refresh(true)
})
onActivated(activatedRefresh)
</script>

<script lang="ts">
export default {
  name: 'WorkbenchPanel',
}
</script>

<style scoped>
.workbench {
  width: min(1400px, 100%);
  max-width: 1170px;
  margin: 0 auto;
  text-align: left;
}
.hint {
  margin: 20px 0;
  color: #64748b;
}
.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  margin: 10px 0;
}
.csv-upload-input {
  display: none;
}
.me {
  color: #64748b;
  font-size: 11px;
}
.workbench :deep(.n-button),
.workbench :deep(.n-checkbox) {
  font-size: 14px;
}
.table-scroll {
  overflow-x: auto;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.82);
  -webkit-overflow-scrolling: touch;
}
.grid {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  min-width: 760px;
  font-size: 14px;
}
.grid th,
.grid td {
  border-bottom: 1px solid #e2e8f0;
  padding: 12px;
  text-align: left;
  vertical-align: middle;
}
.grid tbody tr:last-child td {
  border-bottom: 0;
}
.grid th {
  color: #64748b;
  font-weight: 500;
  font-size: 12px;
  background: #f8fafc;
}
.sel-col {
  width: 34px;
}
.source-col {
  width: 112px;
}
.track-col {
  width: 360px;
}
.grid th:nth-child(3),
.grid td:nth-child(3) {
  padding-right: 20px;
}
.grid th:nth-child(4),
.grid td:nth-child(4) {
  padding-left: 16px;
  padding-right: 16px;
}
.grid th:nth-child(5),
.grid td:nth-child(5) {
  padding-left: 16px;
  padding-right: 16px;
}
.grid tr.mine {
  background: #eff6ff;
}
.doc {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.doc a {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 30px;
}
.doc .parts {
  color: #aaa;
  font-size: 12px;
  margin-left: 6px;
}
.track-line {
  display: grid;
  grid-template-columns: repeat(3, 104px);
  column-gap: 8px;
  align-items: center;
  min-height: 32px;
  justify-content: start;
  width: max-content;
  white-space: nowrap;
}
.status-tag {
  --n-height: 32px !important;
  --n-padding: 0 12px !important;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 104px;
  height: 32px;
  min-width: 0;
  box-sizing: border-box;
  text-align: center;
}
.status-tag :deep(.n-tag__content) {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 32px;
  font-size: 13px;
  line-height: 32px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.track-line :deep(.n-button) {
  width: 104px;
  height: 32px;
  font-size: 14px;
  white-space: nowrap;
}
.neutral-action {
  --n-color: #f3f3f5 !important;
  --n-color-hover: #f7f7f9 !important;
  --n-color-pressed: #e9eaee !important;
  --n-border: 1px solid #e5e7eb !important;
  --n-border-hover: 1px solid #d9dce3 !important;
  --n-border-pressed: 1px solid #cfd3dc !important;
  --n-text-color: #111827 !important;
  --n-text-color-hover: #111827 !important;
  --n-text-color-pressed: #111827 !important;
}
.time {
  color: #999;
  font-size: 13px;
  white-space: nowrap;
  line-height: 32px;
}
.source-time {
  color: #64748b;
  font-size: 12px;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .toolbar {
    gap: 8px;
  }

  .toolbar :deep(.n-button) {
    min-height: 36px;
  }

  .me {
    flex-basis: 100%;
  }

  .table-scroll {
    overflow-x: visible;
    border: 0;
    border-radius: 0;
    background: transparent;
  }

  .grid,
  .grid tbody,
  .grid tr,
  .grid td {
    display: block;
  }

  .grid colgroup,
  .grid thead {
    display: none;
  }

  .grid {
    min-width: 0;
  }

  .grid td {
    min-width: 0;
    padding: 0;
    border-bottom: 0;
  }

  .grid tr {
    display: grid;
    grid-template-columns: auto minmax(84px, max-content) minmax(0, 1fr);
    gap: 8px 10px;
    margin-bottom: 10px;
    padding: 12px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.86);
  }

  .grid tr.mine {
    background: #eff6ff;
  }

  .grid td.sel-col {
    grid-column: 1;
    grid-row: 1;
    width: 34px;
    align-self: center;
  }

  .grid td.source-time {
    grid-column: 2;
    grid-row: 1;
    align-self: center;
    font-size: 11px;
  }

  .grid td.doc {
    grid-column: 3;
    grid-row: 1;
  }

  .doc a {
    line-height: 1.45;
    white-space: normal;
    word-break: break-all;
  }

  .grid td:nth-child(4),
  .grid td:nth-child(5) {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: 42px minmax(0, 1fr);
    gap: 8px;
    align-items: start;
    padding-top: 10px;
    border-top: 1px solid #e2e8f0;
  }

  .grid td:nth-child(4)::before,
  .grid td:nth-child(5)::before {
    color: #64748b;
    font-size: 12px;
    line-height: 32px;
  }

  .grid td:nth-child(4)::before {
    content: '翻译';
  }

  .grid td:nth-child(5)::before {
    content: '校对';
  }

  .track-line {
    grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
    gap: 6px;
    width: 100%;
    white-space: normal;
  }

  .status-tag,
  .track-line :deep(.n-button) {
    width: 100%;
  }

  .time {
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
</style>
