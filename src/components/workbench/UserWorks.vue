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

      <section v-if="ranking.length" class="stats" aria-label="数据分析">
        <div class="tiles">
          <div v-for="t in tiles" :key="t.label" class="tile">
            <span class="tile-value">{{ t.value }}</span>
            <span class="tile-label">{{ t.label }}</span>
          </div>
        </div>

        <h4 class="chart-title">各成员完成量</h4>
        <p class="legend">
          <span class="key"><i class="swatch tr" />翻译</span>
          <span class="key"><i class="swatch pr" />校对</span>
        </p>
        <div class="bars">
          <!-- display:contents 让三个格子直接落进外层网格，各行才对得齐 -->
          <div v-for="row in ranking" :key="row.id" class="bar-row">
            <button
              class="bar-label"
              :class="{ active: row.id === who }"
              :title="`只看 ${row.id}`"
              @click="pick(row.id === who ? '' : row.id)"
            >
              {{ row.id }}
            </button>
            <span class="bar-track">
              <i
                v-if="row.tr"
                class="seg tr"
                :style="{ width: `${(row.tr / barMax) * 100}%` }"
              />
              <i
                v-if="row.pr"
                class="seg pr"
                :style="{ width: `${(row.pr / barMax) * 100}%` }"
              />
            </span>
            <span class="bar-value">{{ row.tr }} / {{ row.pr }}</span>
          </div>
        </div>
      </section>
      <doc-filters
        v-if="who"
        v-slot="{ rows: filteredRows }"
        :docs="myDocs"
        :archived-numbers="archived"
      >
        <div v-for="d in filteredRows" :key="d.number" class="row">
          <span class="time">{{ formatGmt8(d.sourceCommitTime || '') }}</span>
          <!-- 存档标签放进标题格：条件单元格会让后面整列错位 -->
          <span class="title">
            {{ d.title }}
            <n-tag
              v-if="archived.has(d.number)"
              size="small"
              type="warning"
              :bordered="false"
            >
              已存档
            </n-tag>
          </span>
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

const userOptions = computed(() =>
  ranking.value.map((r) => ({
    label: `${r.id}（${r.tr + r.pr}）`,
    value: r.id,
  }))
)

const myDocs = computed(() =>
  who.value ? docs.value.filter((d) => rolesOf(d).length) : []
)
const trCount = computed(
  () => myDocs.value.filter((d) => rolesOf(d).includes('tr')).length
)
const prCount = computed(
  () => myDocs.value.filter((d) => rolesOf(d).includes('pr')).length
)

// 全员排行：统计只用已在内存的 issue 数据，不发任何额外请求
const ranking = computed(() => {
  const counts = new Map<string, { tr: number; pr: number }>()
  for (const d of docs.value)
    for (const key of ['tr', 'pr'] as TrackKey[]) {
      const id = ownerId(d[key].user)
      if (!id) continue
      const row = counts.get(id) || { tr: 0, pr: 0 }
      row[key] += 1
      counts.set(id, row)
    }
  return [...counts]
    .map(([id, row]) => ({ id, ...row }))
    .sort((a, b) => b.tr + b.pr - (a.tr + a.pr) || a.id.localeCompare(b.id))
})
// 所有条共用同一刻度，长度之间才可比
const barMax = computed(() =>
  Math.max(1, ...ranking.value.map((r) => r.tr + r.pr))
)

const tiles = computed(() => {
  const claimed = docs.value.filter((d) => d.tr.user || d.pr.user).length
  return [
    { label: '文件总数', value: docs.value.length },
    {
      label: '已翻译',
      value: docs.value.filter((d) => d.tr.state === '完成').length,
    },
    {
      label: '已校对',
      value: docs.value.filter((d) => d.pr.state === '完成').length,
    },
    { label: '有人认领', value: claimed },
    { label: '参与成员', value: ranking.value.length },
  ]
})

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
/* 两条序列的颜色取自校验过的分类色板（明暗两模式六项检查全通过） */
.stats {
  --series-tr: #2a78d6;
  --series-pr: #008300;
  margin: 14px 0 18px;
  padding: 14px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.82);
}
.tiles {
  display: flex;
  flex-wrap: wrap;
  gap: 22px;
}
.tile {
  display: flex;
  flex-direction: column;
}
.tile-value {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.2;
}
.tile-label {
  color: #64748b;
  font-size: 12px;
}
.chart-title {
  margin: 16px 0 6px;
  font-size: 13px;
  font-weight: 600;
}
.legend {
  display: flex;
  gap: 14px;
  margin: 0 0 8px;
  color: #64748b;
  font-size: 12px;
}
.key {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.swatch.tr,
.seg.tr {
  background: var(--series-tr);
}
.swatch.pr,
.seg.pr {
  background: var(--series-pr);
}
.bars {
  display: grid;
  /* 名字列按最长的个人 ID 留宽，超出省略并靠 title 提示 */
  grid-template-columns: 136px minmax(0, 1fr) 62px;
  gap: 6px 10px;
  align-items: center;
}
.bar-row {
  display: contents;
}
.bar-label,
.bar-value {
  color: #64748b;
  font-size: 12px;
  white-space: nowrap;
}
/* 条名可点，直接筛出这个人的文件 */
.bar-label {
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;
}
.bar-label:hover,
.bar-label.active {
  color: #0f172a;
  font-weight: 600;
}
.bar-value {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.bar-track {
  display: flex;
  height: 10px;
}
/* 段之间留 2px 表面色缝隙，相邻色块不糊在一起 */
.seg {
  height: 100%;
  border-radius: 2px;
}
.seg + .seg {
  margin-left: 2px;
}

.row {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr) 240px 64px;
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
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  font-weight: 600;
}
.roles {
  display: flex;
  justify-content: center;
  gap: 6px;
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
