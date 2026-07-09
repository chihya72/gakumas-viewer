<template>
  <!-- the "avatar" element displays the avatar image -->
  <div v-if="name" class="avatar">
    <img :src="avatarUrl" :alt="name" @error="onAvatarError" />
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { getAvatarPath } from '../../helper/path'

// define the props for the component
export default defineComponent({
  props: {
    // the name of the speaker, which is used to determine the avatar image
    name: {
      type: String,
      required: true,
    },
  },
  computed: {
    // compute the URL of the avatar image based on the name of the speaker
    avatarUrl() {
      return getAvatarPath(this.name)
      // return `/icon/${this.name}.webp`;
    },
  },
  methods: {
    onAvatarError(e: Event) {
      const img = e.target as HTMLImageElement
      img.onerror = null
      img.src = getAvatarPath('')
    },
  },
})
</script>

<style scoped>
/* add styles for the "Avatar" component here */
img {
  width: 20vw;
  max-width: 120px;
  height: auto;
}

.avatar {
  padding: 10px 10px 10px 0px;
}

@media (max-width: 720px) {
  img {
    width: 64px;
  }

  .avatar {
    padding-right: 8px;
  }
}
</style>
