import type { ProjectTemplate } from "./types";

const INDEX_CONTENT = `import { createApp } from "vue";
import App from "./App.vue";

createApp(App).mount("#root");
`;

const APP_CONTENT = `<script setup lang="ts">
import { ref } from "vue";

const count = ref(0);
</script>

<template>
  <div class="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-emerald-500 to-teal-600 p-8">
    <div class="rounded-2xl bg-white/90 p-8 shadow-2xl backdrop-blur">
      <h1 class="mb-6 text-center text-3xl font-bold text-gray-800">
        Vue App
      </h1>
      <p class="mb-4 text-center text-gray-600">
        Edit the code and click "Run" to see changes
      </p>
      <div class="flex flex-col items-center gap-4">
        <span class="text-5xl font-bold text-emerald-600">{{ count }}</span>
        <button
          class="rounded-lg bg-emerald-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-emerald-700"
          @click="count++"
        >
          Increment
        </button>
      </div>
    </div>
  </div>
</template>
`;

export const vueTemplate: ProjectTemplate = {
  dependencies: [{ name: "vue", version: "^3.5.0" }],
  description: "Vue.js app with TypeScript and a counter example",
  files: [
    { content: INDEX_CONTENT, path: "/index.ts" },
    { content: APP_CONTENT, path: "/App.vue" },
  ],
  icon: "lucide:hexagon",
  id: "vue",
  name: "Vue.js",
};
