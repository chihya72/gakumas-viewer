<template>
  <div class="doc-filters" role="search" aria-label="文档筛选">
    <n-select
      v-model:value="story"
      class="filter-select"
      size="small"
      aria-label="按剧情类型筛选"
      :options="storyOptions"
    />
    <n-select
      v-model:value="status"
      class="filter-select"
      size="small"
      aria-label="按文档状态筛选"
      :options="statusOptions"
    />
    <n-input
      v-model:value="search"
      class="filter-search"
      size="small"
      clearable
      aria-label="搜索文件名"
      placeholder="搜索文件名"
    />
    <span class="filter-count" aria-live="polite">
      {{ pagedRows.length }} / {{ filteredRows.length }} / {{ docs.length }}
    </span>
  </div>
  <div v-if="dateGroups.length > 1" class="doc-pager">
    <n-button size="small" :disabled="activeIndex <= 0" @click="go(-1)">
      上一页
    </n-button>
    <span class="pager-label" aria-live="polite">
      {{ datePageLabel(activeKey, pagedRows.length) }} · {{ activeIndex + 1 }} /
      {{ dateGroups.length }}
    </span>
    <n-button
      size="small"
      :disabled="activeIndex >= dateGroups.length - 1"
      @click="go(1)"
    >
      下一页
    </n-button>
  </div>
  <slot :rows="pagedRows" />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NInput, NSelect } from 'naive-ui'
import type { DocTask } from '../../helper/workflow'
import {
  datePageLabel,
  groupDocsByDate,
  matchesDocFilters,
  type DocStatus,
  type StoryKind,
} from '../../helper/document-filter'

const props = withDefaults(
  defineProps<{
    docs: DocTask[]
    archivedNumbers?: Set<number>
    allArchived?: boolean
  }>(),
  { archivedNumbers: () => new Set<number>(), allArchived: false }
)

const story = ref<StoryKind | 'all'>('all')
const status = ref<DocStatus | 'all'>('all')
const search = ref('')
const route = useRoute()
const router = useRouter()
// 页码存在 URL 的 ?d=YYYY-MM-DD，刷新和分享链接都能回到同一页
const page = computed(() => String(route.query.d || ''))

const storyOptions = [
  { label: '全部剧情', value: 'all' },
  { label: 'P卡剧情', value: 'cidol' },
  { label: 'S卡剧情', value: 'csprt' },
  { label: '好感度剧情', value: 'dear' },
  { label: '活动剧情', value: 'event' },
  { label: '培养故事', value: 'pstory' },
  { label: '培养事件', value: 'pevent' },
  { label: '其它剧情', value: 'other' },
]
const statusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '待翻译', value: '待翻译' },
  { label: '翻译中', value: '翻译中' },
  { label: '待校对', value: '待校对' },
  { label: '校对中', value: '校对中' },
  { label: '已完成', value: '已完成' },
  { label: '已存档', value: '已存档' },
]

const filteredRows = computed(() =>
  props.docs.filter((d) =>
    matchesDocFilters(
      d,
      story.value,
      status.value,
      search.value,
      props.allArchived || props.archivedNumbers?.has(d.number)
    )
  )
)

const dateGroups = computed(() => groupDocsByDate(filteredRows.value))
// 筛选变化后 URL 里的日期可能已不存在 → 回落到最新一页，不用 watch 重置
const activeIndex = computed(() => {
  const i = dateGroups.value.findIndex(([k]) => k === page.value)
  return i < 0 ? 0 : i
})
const activeKey = computed(() => dateGroups.value[activeIndex.value]?.[0] ?? '')
const pagedRows = computed(() => dateGroups.value[activeIndex.value]?.[1] ?? [])

function go(step: number) {
  const key = dateGroups.value[activeIndex.value + step]?.[0]
  if (key === undefined) return
  router.replace({ query: { ...route.query, d: key || undefined } })
}
</script>

<style scoped>
.doc-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 0;
}
.filter-select {
  width: 140px;
}
.filter-search {
  width: min(280px, 100%);
}
.filter-count {
  color: #64748b;
  font-size: 12px;
  white-space: nowrap;
}
.doc-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin: 12px 0;
}
.pager-label {
  color: #64748b;
  font-size: 12px;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .doc-filters {
    flex-wrap: wrap;
  }
  .filter-select {
    flex: 1 1 calc(50% - 4px);
    width: auto;
  }
  .filter-search {
    flex: 1 1 calc(100% - 48px);
    width: auto;
  }
}
</style>
