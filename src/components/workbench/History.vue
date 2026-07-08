<template>
  <div class="workbench">
    <push-header title="已完成历史" />
    <div v-if="!store.octokitWrapper?.userMeta" class="hint">
      请先登录 GitHub。
    </div>
    <template v-else>
      <div class="toolbar">
        <n-button size="small" :loading="loading" @click="refresh">刷新</n-button>
      </div>
      <n-alert v-if="error" type="error" :bordered="false">{{ error }}</n-alert>
      <div v-for="d in rows" :key="d.number" class="row">
        <n-tag size="small" type="success" :bordered="false">完成</n-tag>
        <span class="title">{{ d.title }}</span>
        <span class="user">翻译：{{ displayUser(d.tr.user) }}</span>
        <span class="user">校对：{{ displayUser(d.pr.user) }}</span>
        <n-button size="tiny" @click="downloadCsv(d)">校对CSV</n-button>
        <n-button size="tiny" @click="downloadChineseTxt(d)">纯中文TXT</n-button>
      </div>
      <n-empty v-if="!loading && !rows.length" description="暂无已完成文件" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { NButton, NTag, NEmpty, NAlert } from 'naive-ui'
import FileSaver from 'file-saver'
import PushHeader from '../translate/push/PushHeader.vue'
import { store } from '../../store'
import { extractInfoFromCsvText } from '../../helper/csv'
import { displayUser } from '../../helper/users'
import {
  WORK_OWNER,
  WORK_REPO,
  buildChineseTxt,
  docFromIssue,
  fetchNameDict,
  fetchRawTxt,
  isArchivedIssue,
  workRawUrl,
  type DocTask,
} from '../../helper/workflow'

const loading = ref(false)
const error = ref('')
const rows = ref<DocTask[]>([])

async function refresh() {
  if (!store.octokitWrapper) return
  loading.value = true
  error.value = ''
  try {
    const issues = await store.octokitWrapper.listIssues(WORK_OWNER, WORK_REPO, {
      state: 'closed',
    })
    rows.value = (issues as any[])
      .filter((i) => !i.pull_request && !isArchivedIssue(i))
      .map(docFromIssue)
      .sort((a, b) => b.number - a.number)
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
</script>

<style scoped>
.workbench {
  max-width: 980px;
  margin: 0 auto;
  text-align: left;
}
.hint,
.user {
  color: #888;
}
.toolbar {
  margin: 10px 0;
}
.row {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 7px 0;
  border-bottom: 1px solid #eee;
}
.title {
  flex: 1;
  font-weight: 600;
  word-break: break-all;
}
.user {
  font-size: 12px;
  white-space: nowrap;
}
</style>
