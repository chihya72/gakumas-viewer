// User.vue

<template>
  <n-space vertical class="user-container">
    <div v-if="!store.isLoading" class="full-width">
      <direct-push></direct-push>
    </div>
  </n-space>
</template>

<script setup lang="ts">
import { store } from '../../../store'
import { NSpace } from 'naive-ui'
import DirectPush from './DirectPush.vue'
</script>

<style scoped>
.n-collapse {
  margin-bottom: 15px;
}
</style>
