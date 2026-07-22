<!-- 个人记录：以人为索引，列出某人翻译过或校对过的全部文件（含已完成和已存档）。 -->
<template>
  <div class="workbench">
    <push-header title="个人记录" />
    <div v-if="!store.octokitWrapper?.userMeta" class="hint">
      请先登录 GitHub。
    </div>
    <template v-else>
      <div class="toolbar">
        <n-button size="small" :loading="loading" @click="refresh">
          刷新
        </n-button>
        <n-select
          :value="who"
          class="who-select"
          size="small"
          filterable
          aria-label="选择成员"
          placeholder="选择成员"
          :options="userOptions"
          @update:value="pick"
        />
        <span v-if="who" class="summary">
          翻译 {{ trCount }} · 校对 {{ prCount }}
        </span>
      </div>
      <n-alert v-if="error" type="error" :bordered="false">{{ error }}</n-alert>
      <doc-filters
        v-if="who"
        v-slot="{ rows: filteredRows }"
        :docs="myDocs"
        :archived-numbers="archived"
      >
        <div v-for="d in filteredRows" :key="d.number" class="row">
          <span class="time">{{ formatGmt8(d.sourceCommitTime || '') }}</span>
          <n-tag
            v-if="archived.has(d.number)"
            size="small"
            type="warning"
            :bordered="false"
          >
            已存档
          </n-tag>
          <span class="title">{{ d.title }}</span>
          <span class="roles">
            <n-tag
              v-for="key in rolesOf(d)"
              :key="key"
              size="small"
              :type="d[key].state === '完成' ? 'success' : 'info'"
              :bordered="false"
            >
              {{ TRACK_LABEL[key] }} · {{ d[key].state }}
            </n-tag>
          </span>
          <n-button size="tiny" @click="open(d)">打开</n-button>
        </div>
        <n-empty v-if="!filteredRows.length" description="没有符合条件的文件" />
      </doc-filters>
      <n-empty
        v-else-if="!loading"
        description="选择一位成员查看其做过的文件"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAlert, NButton, NEmpty, NSelect, NTag } from 'naive-ui'
import PushHeader from '../translate/push/PushHeader.vue'
import DocFilters from './DocFilters.vue'
import { store } from '../../store'
import { displayUser, loadUsers } from '../../helper/users'
import {
  TRACK_LABEL,
  WORK_OWNER,
  WORK_REPO,
  docFromIssue,
  editorUrlForPath,
  fillDocSourceCommitTimes,
  formatGmt8,
  isArchivedIssue,
  type DocTask,
  type TrackKey,
} from '../../helper/workflow'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const error = ref('')
const docs = ref<DocTask[]>([])
const archived = ref<Set<number>>(new Set())

// 选中的成员存在 ?u=，刷新和分享链接都能回到同一个人
const who = computed(() => String(route.query.u || ''))

// 轨道上的 GitHub login / qq-号 统一折算成个人 ID，两端算同一个人
function ownerId(user: string) {
  return user ? displayUser(user) : ''
}

function rolesOf(d: DocTask): TrackKey[] {
  return (['tr', 'pr'] as TrackKey[]).filter(
    (key) => ownerId(d[key].user) === who.value
  )
}

const userOptions = computed(() => {
  const counts = new Map<string, number>()
  for (const d of docs.value)
    for (const key of ['tr', 'pr'] as TrackKey[]) {
      const id = ownerId(d[key].user)
      if (id) counts.set(id, (counts.get(id) || 0) + 1)
    }
  return [...counts]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([id, n]) => ({ label: `${id}（${n}）`, value: id }))
})

const myDocs = computed(() =>
  who.value ? docs.value.filter((d) => rolesOf(d).length) : []
)
const trCount = computed(
  () => myDocs.value.filter((d) => rolesOf(d).includes('tr')).length
)
const prCount = computed(
  () => myDocs.value.filter((d) => rolesOf(d).includes('pr')).length
)

function pick(id: string) {
  router.replace({
    query: { ...route.query, u: id || undefined, d: undefined },
  })
}

function open(d: DocTask) {
  const role = rolesOf(d)[0]
  const path = role === 'pr' ? d.proofreadPath : d.translatedPath
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
      store.octokitWrapper.listIssues(WORK_OWNER, WORK_REPO, { state: 'all' }),
    ])
    const list = (issues as any[]).filter((i) => !i.pull_request)
    archived.value = new Set(
      list.filter(isArchivedIssue).map((i) => i.number as number)
    )
    docs.value = list.map(docFromIssue)
  } catch (e: any) {
    error.value = `加载失败：${e?.message || e}`
  }
  loading.value = false
}

// 入库时间一个文件一次请求，只给选中成员的那几十条补，不给全仓补
watch([who, () => docs.value.length], async () => {
  if (!who.value || !store.octokitWrapper) return
  const pending = myDocs.value.filter((d) => d.sourceCommitTime === undefined)
  if (!pending.length) return
  const filled = await fillDocSourceCommitTimes(store.octokitWrapper, pending)
  const byNumber = new Map(filled.map((d) => [d.number, d.sourceCommitTime]))
  docs.value = docs.value.map((d) =>
    byNumber.has(d.number)
      ? { ...d, sourceCommitTime: byNumber.get(d.number) }
      : d
  )
})

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
  if (store.octokitWrapper?.userMeta && !docs.value.length) refresh()
})
</script>

<script lang="ts">
export default {
  name: 'UserWorksPanel',
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
.summary {
  color: #64748b;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0;
}
.who-select {
  width: 220px;
}
.summary {
  font-size: 12px;
  white-space: nowrap;
}
.row {
  display: grid;
  grid-template-columns: 112px auto minmax(196px, 1fr) 260px 64px;
  gap: 10px;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid #e2e8f0;
}
.time {
  color: #64748b;
  font-size: 12px;
  white-space: nowrap;
}
.title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.roles {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

@media (max-width: 720px) {
  .row {
    grid-template-columns: auto 1fr;
    gap: 8px;
    padding: 12px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.82);
    margin-bottom: 10px;
  }
  .time,
  .title,
  .roles {
    grid-column: 1 / -1;
  }
  .title {
    white-space: normal;
  }
  .who-select {
    flex: 1 1 auto;
    width: auto;
  }
}
</style>
