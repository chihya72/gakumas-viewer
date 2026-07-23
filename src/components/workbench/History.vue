<template>
  <div class="workbench">
    <push-header title="已完成历史" />
    <div v-if="!store.octokitWrapper?.userMeta" class="hint">
      请先登录 GitHub。
    </div>
    <template v-else>
      <div class="toolbar">
        <n-button size="small" :loading="loading" @click="refresh"
          >刷新</n-button
        >
      </div>
      <n-alert v-if="error" type="error" :bordered="false">{{ error }}</n-alert>
      <doc-filters v-slot="{ rows: filteredRows }" :docs="rows" @page="onPage">
        <div v-if="filteredRows.length" class="batchbar">
          <n-checkbox
            :checked="allSelected(filteredRows)"
            :indeterminate="someSelected(filteredRows)"
            @update:checked="toggleAll(filteredRows)"
          >
            全选本页
          </n-checkbox>
          <span class="sel-count">已选 {{ selectedCount }}</span>
          <n-button
            size="small"
            :disabled="!selectedCount"
            :loading="batching"
            @click="batchDownload('csv')"
          >
            批量下载CSV
          </n-button>
          <n-button
            size="small"
            :disabled="!selectedCount"
            :loading="batching"
            @click="batchDownload('txt')"
          >
            批量下载TXT
          </n-button>
          <n-button
            v-if="selectedCount"
            size="small"
            quaternary
            @click="clearSel"
          >
            清空
          </n-button>
        </div>
        <div v-for="d in filteredRows" :key="d.number" class="row">
          <n-checkbox
            class="rowcheck"
            :checked="selected.has(d.number)"
            @update:checked="() => toggle(d.number)"
          />
          <span class="source-time">{{
            formatGmt8(d.sourceCommitTime || '')
          }}</span>
          <span class="title">{{ d.title }}</span>
          <span class="user"
            >翻译：{{ displayUser(d.tr.user)
            }}<template v-if="d.trCsvTime">
              · {{ formatGmt8(d.trCsvTime) }}</template
            ></span
          >
          <span class="user"
            >校对：{{ displayUser(d.pr.user)
            }}<template v-if="d.prCsvTime">
              · {{ formatGmt8(d.prCsvTime) }}</template
            ></span
          >
          <n-button size="tiny" @click="downloadCsv(d)">下载CSV</n-button>
          <n-button size="tiny" @click="downloadChineseTxt(d)"
            >下载TXT</n-button
          >
          <n-button size="tiny" @click="openEditor(d, 'tr')">重新翻译</n-button>
          <n-button size="tiny" @click="openEditor(d, 'pr')">
            重新校对
          </n-button>
        </div>
        <n-empty
          v-if="!loading && !filteredRows.length"
          :description="
            rows.length ? '没有符合筛选条件的文件' : '暂无已完成文件'
          "
        />
      </doc-filters>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onActivated, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NCheckbox, NEmpty, NAlert } from 'naive-ui'
import FileSaver from 'file-saver'
import PushHeader from '../translate/push/PushHeader.vue'
import DocFilters from './DocFilters.vue'
import { store } from '../../store'
import { extractInfoFromCsvText } from '../../helper/csv'
import { displayUser, loadUsers } from '../../helper/users'
import {
  WORK_OWNER,
  WORK_REPO,
  buildChineseTxt,
  docFromIssue,
  editorUrlForPath,
  fetchNameDict,
  fetchRawTxt,
  fillDocSourceCommitTimes,
  fillDocStageCommitTimes,
  formatGmt8,
  isArchivedIssue,
  readWorkFile,
  type DocTask,
  type TrackKey,
} from '../../helper/workflow'

const router = useRouter()
const loading = ref(false)
const error = ref('')
const rows = ref<DocTask[]>([])
const selected = ref<Set<number>>(new Set())
const batching = ref(false)
let lastRefreshAt = 0

const selectedCount = computed(() => selected.value.size)
function toggle(n: number) {
  const s = new Set(selected.value)
  s.has(n) ? s.delete(n) : s.add(n)
  selected.value = s
}
function allSelected(list: DocTask[]) {
  return list.length > 0 && list.every((d) => selected.value.has(d.number))
}
function someSelected(list: DocTask[]) {
  return list.some((d) => selected.value.has(d.number)) && !allSelected(list)
}
// 全选/取消只作用于当前页；翻页时 onPage 会清空勾选，所以 selected 始终只含本页
function toggleAll(list: DocTask[]) {
  const s = new Set(selected.value)
  const all = allSelected(list)
  list.forEach((d) => (all ? s.delete(d.number) : s.add(d.number)))
  selected.value = s
}
function clearSel() {
  selected.value = new Set()
}

// 重新修改：打开已完成阶段文件；再次完成会把对应作者更新为当前用户。
function openEditor(d: DocTask, role: TrackKey) {
  const path = role === 'tr' ? d.translatedPath : d.proofreadPath
  if (!path) {
    alert('该文件缺少路径标记')
    return
  }
  router.push(editorUrlForPath(path, d.number, role))
}

async function refresh() {
  if (!store.octokitWrapper) return
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const [, issues] = await Promise.all([
      loadUsers(store.octokitWrapper),
      store.octokitWrapper.listIssues(WORK_OWNER, WORK_REPO, {
        state: 'closed',
      }),
    ])
    const loaded = (issues as any[])
      .filter((i) => !i.pull_request && !isArchivedIssue(i))
      .map(docFromIssue)
    // 完成时间不在这里查：等 DocFilters 报出当前页再按页补，见 onPage
    rows.value = await fillDocSourceCommitTimes(store.octokitWrapper, loaded)
    lastRefreshAt = Date.now()
  } catch (e: any) {
    error.value = `加载失败：${e?.message || e}`
  }
  loading.value = false
}

// 只给当前页没查过的行补翻译/校对完成时间；缓存命中的不重复请求
async function onPage(pageRows: DocTask[]) {
  // 翻页即清空勾选：只计算当前页，不跨页累积
  selected.value = new Set()
  if (!store.octokitWrapper) return
  const pending = pageRows.filter((d) => d.trCsvTime === undefined)
  if (!pending.length) return
  const filled = await fillDocStageCommitTimes(store.octokitWrapper, pending)
  const byNumber = new Map(filled.map((d) => [d.number, d]))
  rows.value = rows.value.map((d) => byNumber.get(d.number) || d)
}

// 取校对 CSV 成品的 blob（API 直读而非 raw：raw 无视查询串，刚完成的文件会下到上一版）
async function csvBlob(d: DocTask): Promise<{ blob: Blob; name: string } | null> {
  const text = await readWorkFile(store.octokitWrapper, d.proofreadPath)
  if (text === null) return null
  return {
    blob: new Blob([text], { type: 'text/csv;charset=utf-8' }),
    name: `${d.title}_校对.csv`,
  }
}

// 由原文 TXT + 校对 CSV + 人名字典合成纯中文 TXT 的 blob
async function txtBlob(d: DocTask): Promise<{ blob: Blob; name: string } | null> {
  const [rawTxt, csvText, dict] = await Promise.all([
    fetchRawTxt(d.title),
    readWorkFile(store.octokitWrapper, d.proofreadPath),
    fetchNameDict(),
  ])
  if (rawTxt === null || csvText === null) return null
  const { data } = extractInfoFromCsvText(csvText)
  return {
    blob: new Blob([buildChineseTxt(rawTxt, data, dict)], {
      type: 'text/plain;charset=utf-8',
    }),
    name: `${d.title}.txt`,
  }
}

async function downloadCsv(d: DocTask) {
  const b = await csvBlob(d)
  if (!b) return void alert('校对CSV下载失败：文件不存在或无权限')
  FileSaver.saveAs(b.blob, b.name)
}

async function downloadChineseTxt(d: DocTask) {
  try {
    const b = await txtBlob(d)
    if (!b) return void alert('纯中文TXT生成失败：原始TXT或校对CSV不存在')
    FileSaver.saveAs(b.blob, b.name)
  } catch (e: any) {
    alert(`纯中文TXT生成失败：${e?.message || e}`)
  }
}

// 批量下载勾选文件的校对 CSV 或纯中文 TXT。逐个 saveAs（不引入打包依赖），
// 每次间隔一点避免浏览器丢掉连续下载；失败的汇总提示，不中断其余。
async function batchDownload(kind: 'csv' | 'txt') {
  const picked = rows.value.filter((d) => selected.value.has(d.number))
  if (!picked.length || batching.value) return
  batching.value = true
  const fails: string[] = []
  try {
    for (const d of picked) {
      try {
        const b = kind === 'csv' ? await csvBlob(d) : await txtBlob(d)
        if (!b) {
          fails.push(d.title)
          continue
        }
        FileSaver.saveAs(b.blob, b.name)
        await new Promise((r) => setTimeout(r, 150))
      } catch {
        fails.push(d.title)
      }
    }
  } finally {
    batching.value = false
  }
  if (fails.length)
    alert(
      `${picked.length - fails.length}/${picked.length} 已下载。失败 ${
        fails.length
      } 个：\n${fails.slice(0, 10).join('\n')}${fails.length > 10 ? '\n…' : ''}`
    )
}

watch(
  () => store.octokitWrapper?.userMeta?.username,
  (u) => {
    if (u) refresh()
  }
)
onMounted(() => {
  if (store.octokitWrapper?.userMeta) refresh()
})
onActivated(() => {
  if (store.octokitWrapper?.userMeta && Date.now() - lastRefreshAt > 30_000)
    refresh()
})
</script>

<script lang="ts">
export default {
  name: 'HistoryPanel',
}
</script>

<style scoped>
.workbench {
  width: min(1170px, 100%);
  max-width: 1170px;
  margin: 0 auto;
  text-align: left;
}
.hint,
.user {
  color: #64748b;
}
.toolbar {
  margin: 10px 0;
}
.row {
  display: grid;
  grid-template-columns: 28px 112px minmax(196px, 1fr) 190px 190px repeat(4, 82px);
  gap: 10px;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid #e2e8f0;
}
.batchbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 0;
  border-bottom: 1px solid #e2e8f0;
}
.sel-count {
  color: #64748b;
  font-size: 12px;
}
.rowcheck {
  justify-self: center;
}
.title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.user {
  font-size: 12px;
  white-space: nowrap;
}
.row :deep(.n-button) {
  width: 82px;
  white-space: nowrap;
}
.source-time {
  color: #64748b;
  font-size: 12px;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .row {
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 12px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.82);
    margin-bottom: 10px;
  }

  .rowcheck,
  .source-time,
  .title,
  .user {
    grid-column: 1 / -1;
  }
  .rowcheck {
    justify-self: start;
  }

  .title {
    white-space: normal;
  }

  .user {
    white-space: normal;
  }

  .row :deep(.n-button) {
    width: 100%;
    min-height: 36px;
  }
}
</style>
