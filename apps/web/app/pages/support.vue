<template>
  <LegalPage
    :title="$t('help_pages.support.title')"
    :subtitle="$t('help_pages.support.subtitle')"
    :updated="''"
  >
    <section class="well">
      <h3 class="!mt-0">{{ $t('help_pages.support.email_us') }}</h3>
      <p>
        <a :href="`mailto:${LEGAL.email}`" class="text-base">{{ LEGAL.email }}</a>
      </p>
      <p>
        {{ $t('help_pages.support.email_body') }}
      </p>
      <p class="text-sm opacity-60">
        {{ $t('help_pages.support.operated_by', { operator: LEGAL.operator, address: LEGAL.address }) }}
      </p>
    </section>

    <section>
      <h2>{{ $t('help_pages.support.where_title') }}</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>{{ $t('help_pages.support.col_want') }}</th><th>{{ $t('help_pages.support.col_go') }}</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>{{ $t('help_pages.support.row_bug') }}</td>
              <i18n-t keypath="help_pages.support.row_bug_go" tag="td">
                <template #chat><NuxtLink to="/help">{{ $t('help_pages.support.chat_link') }}</NuxtLink></template>
                <template #email><a :href="`mailto:${LEGAL.email}`">{{ LEGAL.email }}</a></template>
              </i18n-t>
            </tr>
            <tr>
              <td>{{ $t('help_pages.support.row_feature') }}</td>
              <td><NuxtLink to="/feedback">{{ $t('help_pages.support.feedback_board') }}</NuxtLink></td>
            </tr>
            <tr>
              <td>{{ $t('help_pages.support.row_changes') }}</td>
              <td><NuxtLink to="/changes">{{ $t('help_pages.support.changelog') }}</NuxtLink></td>
            </tr>
            <tr>
              <td>{{ $t('help_pages.support.row_api') }}</td>
              <td><NuxtLink to="/developers">{{ $t('help_pages.support.developer_docs') }}</NuxtLink></td>
            </tr>
            <tr>
              <td>{{ $t('help_pages.support.row_import') }}</td>
              <td><NuxtLink to="/export-bookmarks">{{ $t('help_pages.support.import_guide') }}</NuxtLink></td>
            </tr>
            <tr>
              <td>{{ $t('help_pages.support.row_security') }}</td>
              <i18n-t keypath="help_pages.support.row_security_go" tag="td">
                <template #email><a :href="`mailto:${LEGAL.email}`">{{ LEGAL.email }}</a></template>
              </i18n-t>
            </tr>
            <tr>
              <td>{{ $t('help_pages.support.row_rights') }}</td>
              <i18n-t keypath="help_pages.support.row_rights_go" tag="td">
                <template #link><NuxtLink to="/privacy">{{ $t('help_pages.support.privacy_policy') }}</NuxtLink></template>
              </i18n-t>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section>
      <h2>{{ $t('help_pages.support.faq_title') }}</h2>
      <i18n-t keypath="help_pages.support.faq_body" tag="p">
        <template #link><NuxtLink to="/faq">{{ $t('help_pages.support.faq_link') }}</NuxtLink></template>
      </i18n-t>
    </section>

    <section>
      <h2>{{ $t('help_pages.support.security_title') }}</h2>
      <i18n-t keypath="help_pages.support.security_body" tag="p">
        <template #email><a :href="`mailto:${LEGAL.email}`">{{ LEGAL.email }}</a></template>
      </i18n-t>
    </section>

    <!-- Signed-in visitors already get the real HelpBites widget (mounted
         globally in app.vue); this is the floating chat for everyone else. -->
    <SupportAnonBubble v-if="!isLoggedIn" />
  </LegalPage>
</template>

<script setup>
// `LEGAL` is imported rather than auto-imported: the template compiles
// against setup bindings, and an auto-import never becomes one.
import { LEGAL } from '~/utils/legal'
import { useStore } from '~/stores/myStore'
import { storeToRefs } from 'pinia'
// Content only — the shell, the styles and the <head> live in LegalPage.
const { isLoggedIn } = storeToRefs(useStore())
</script>
