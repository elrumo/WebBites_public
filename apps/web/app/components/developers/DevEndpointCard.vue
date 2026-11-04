<template>
  <div :id="anchor" class="dev-endpoint">
    <div class="flex flex-wrap items-center gap-2">
      <UBadge :color="methodColor(endpoint.method)" size="sm" class="font-mono">{{ endpoint.method }}</UBadge>
      <code class="font-mono text-sm text-white">{{ endpoint.path }}</code>
    </div>

    <div class="text-[15px] leading-relaxed text-neutral-400" v-html="described" />

    <div v-if="endpoint.params.length" class="flex flex-col gap-2">
      <div class="dev-endpoint-label">
        {{ endpoint.method === 'GET' || endpoint.method === 'DELETE' ? 'Parameters' : 'Body' }}
      </div>
      <div class="docs-table-wrap">
        <table class="docs-table">
          <thead>
            <tr><th>Name</th><th>In</th><th>Required</th><th>Description</th></tr>
          </thead>
          <tbody>
            <tr v-for="p in endpoint.params" :key="p.name">
              <td><code class="font-mono">{{ p.name }}</code></td>
              <td>{{ p.in }}</td>
              <td>{{ p.required ? 'yes' : 'no' }}</td>
              <td>{{ p.description }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <DevCode :code="curlFor(endpoint)" language="bash" label="Request" />
    <DevCode :code="endpoint.example" language="json" label="Response" />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { curlFor, methodColor } from '~/utils/devApi'
import DevCode from '~/components/developers/DevCode.vue'

const props = defineProps({
  endpoint: { type: Object, required: true },
})

const anchor = computed(() => `endpoint-${props.endpoint.id}`)

// Descriptions carry `backticked` words; render those as inline code.
const described = computed(() =>
  props.endpoint.description
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
)
</script>

<style scoped>
@reference "../../assets/css/tailwind.css";

.dev-endpoint {
  @apply flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5;
  scroll-margin-top: 6rem;
}

.dev-endpoint-label { @apply text-xs font-semibold uppercase tracking-wider text-neutral-500; }

/* Inline code only: the blocks inside DevCode style themselves. */
.dev-endpoint :deep(:not(pre) > code) {
  @apply rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[0.85em] text-green-200;
}
</style>
