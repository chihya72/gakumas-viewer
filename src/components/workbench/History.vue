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
      <div v-for="d in rows" :key="d.number" class="row">
        <n-tag size="small" type="success" :bordered="false">完成</n-tag>
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
      <n-empty v-if="!loading && !rows.length" description="暂无已完成文件" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onActivated, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NTag, NEmpty, NAlert } from 'naive-ui'
import FileSaver from 'file-saver'
import PushHeader from '../translate/push/PushHeader.vue'
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
  fileCommitTime,
  formatGmt8,
  isArchivedIssue,
  workRawUrl,
  type DocTask,
  type TrackKey,
} from '../../helper/workflow'

const router = useRouter()
const loading = ref(false)
const error = ref('')
const rows = ref<DocTask[]>([])

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
    await loadUsers(store.octokitWrapper)
    const issues = await store.octokitWrapper.listIssues(
      WORK_OWNER,
      WORK_REPO,
      {
        state: 'closed',
      }
    )
    rows.value = (issues as any[])
      .filter((i) => !i.pull_request && !isArchivedIssue(i))
      .map(docFromIssue)
      .sort((a, b) => b.number - a.number)
    // 补 翻译/校对 CSV 各自的最后 commit 时间
    const w = store.octokitWrapper
    await Promise.all(
      rows.value.map(async (d) => {
        d.trCsvTime = await fileCommitTime(w, d.translatedPath)
        d.prCsvTime = await fileCommitTime(w, d.proofreadPath)
      })
    )
  } catch (e: any) {
    error.value = `加载失败：${e?.message || e}`
  }
  loading.value = false
}

async function downloadCsv(d: DocTask) {
  const r = await fetch(workRawUrl(d.proofreadPath))
  if (!r.ok) {
    alert(`校对CSV下载失败: ${r.status}`)
    return
  }
  FileSaver.saveAs(await r.blob(), `${d.title}_校对.csv`)
}

async function downloadChineseTxt(d: DocTask) {
  const [rawTxt, csvResp, dict] = await Promise.all([
    fetchRawTxt(d.title),
    fetch(workRawUrl(d.proofreadPath)),
    fetchNameDict(),
  ])
  if (rawTxt === null || !csvResp.ok) {
    alert('纯中文TXT生成失败：原始TXT或校对CSV不存在')
    return
  }
  try {
    const { data } = extractInfoFromCsvText(await csvResp.text())
    const merged = buildChineseTxt(rawTxt, data, dict)
    FileSaver.saveAs(
      new Blob([merged], { type: 'text/plain;charset=utf-8' }),
      `${d.title}.txt`
    )
  } catch (e: any) {
    alert(`纯中文TXT生成失败：${e?.message || e}`)
  }
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
  if (store.octokitWrapper?.userMeta) refresh()
})
</script>

<script lang="ts">
export default {
  name: 'HistoryPanel',
}
</script>

<style scoped>
.workbench {
  width: min(1170px, calc(100vw - 48px));
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
  grid-template-columns: auto minmax(220px, 1fr) 190px 190px repeat(4, 82px);
  gap: 10px;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid #e2e8f0;
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
</style>
