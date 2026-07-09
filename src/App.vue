// App.vue

<script setup lang="ts">
import { onMounted, watch, computed } from 'vue'
import { RouterView } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NSelect,
  NNotificationProvider,
  NDialogProvider,
  NAlert,
} from 'naive-ui'

const { locale, availableLocales, t } = useI18n()

const showAlert = computed(() => {
  // return location.hostname === 'viewer.strawberrytree.top'
  return true
})

const options = availableLocales.map((item) => {
  return {
    label: item,
    value: item,
  }
})

onMounted(() => {
  if (localStorage.getItem('locale')) {
    locale.value = localStorage.getItem('locale')!
  }
})

watch(locale, (newVal) => {
  localStorage.setItem('locale', newVal)
})
</script>
<template>
  <div class="app-shell">
    <n-notification-provider placement="top" :max="2">
      <n-dialog-provider>
        <!-- <n-alert v-if="showAlert" type="warning" closable>
          网站后端近日迁移中，可能存在不稳定
        </n-alert> -->
        <header class="app-header">
          <div class="brand">Gakumas Viewer</div>
          <nav class="app-nav" aria-label="主导航">
            <!-- 工作台页面用干净路径，不拖带编辑器的 source/issue/role/hash -->
            <router-link :to="{ path: '/' }">工作台</router-link>
            <router-link :to="{ path: '/history' }">已完成</router-link>
            <router-link :to="{ path: '/archive' }">存档</router-link>
            <router-link :to="{ path: '/admin' }">管理</router-link>
            <router-link :to="{ path: '/about' }">{{
              t('tab.About')
            }}</router-link>
            <!-- |
            <router-link
              :to="{ path: '/user', query: route.query, hash: route.hash }"
              >{{ t('tab.Github') }}</router-link
            > -->
            <!-- |
            <router-link
              :to="{ path: '/list', query: route.query, hash: route.hash }"
              >{{ t('tab.List') }}</router-link
            >
            |
            <router-link
              :to="{ path: '/search', query: route.query, hash: route.hash }"
              >{{ t('tab.Search') }}</router-link
            >
            |
            <router-link
              :to="{ path: '/bgm', query: route.query, hash: route.hash }"
            >
              BGM
            </router-link> -->
          </nav>
          <div class="locale-changer">
            <n-select v-model:value="locale" :options="options" size="small" />
          </div>
        </header>
        <main class="app-content">
          <router-view v-slot="{ Component }">
            <keep-alive>
              <component :is="Component" />
            </keep-alive>
          </router-view>
        </main>
      </n-dialog-provider>
    </n-notification-provider>
  </div>
</template>
<style scoped>
.app-shell {
  min-height: 100dvh;
  padding: 16px;
}

.app-header {
  position: sticky;
  top: 12px;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: min(1180px, 100%);
  margin: 0 auto 18px;
  padding: 8px 10px 8px 16px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(12px);
}

.brand {
  flex: 0 0 auto;
  color: #0f172a;
  font-weight: 700;
}

.app-nav {
  display: flex;
  flex: 1 1 auto;
  justify-content: center;
  gap: 4px;
  min-width: 0;
}

.app-nav a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0 12px;
  border-radius: 8px;
  color: #475569;
  transition: background-color 0.2s ease, color 0.2s ease;
}

.app-nav a:hover,
.app-nav a.router-link-active {
  color: #0f172a;
  background: #e0f2fe;
}

.locale-changer {
  flex: 0 0 86px;
}

.app-content {
  width: min(1180px, 100%);
  margin: 0 auto;
}

@media (max-width: 720px) {
  .app-shell {
    padding: 10px;
  }

  .app-header {
    position: static;
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
  }

  .app-nav {
    justify-content: flex-start;
    overflow-x: auto;
    padding-bottom: 2px;
  }

  .locale-changer {
    flex-basis: auto;
    width: 100%;
  }
}
</style>
