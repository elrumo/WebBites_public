<template>
  <div class="extension-auth-container">
    <div class="absolute top-8 left-1/2 transform -translate-x-1/2 flex flex-row items-center justify-center gap-2">
      <Logo 
        :isImage="true"
        :isText="true"
        imageSize="sm"
      />
    </div>
    
    <div class="auth-card">
      <div class="max-w-[90vw] min-w-[300px] md:w-[400px] p-7">
        <div class="text-left mb-6 space-y-1">
          <h1 class="text-lg font-bold">
            {{ $t('settings.auth.reset_password') }}
          </h1>

          <p class="font-light opacity-70 text-md hover:opacity-100 transition">
            {{ $t('auth.reset_password_description') }}
          </p>
        </div>

        <Transition name="slide-up">
          <UAlert
            v-if="successMessage.length > 0"
            color="primary"
            variant="soft"
            class="mb-4"
            :description="successMessage"
          />
        </Transition>

        <Transition name="slide-up">
          <UAlert
            v-if="errorMessage.length > 0"
            color="red"
            variant="soft"
            class="mb-4"
            :description="errorMessage"
          />
        </Transition>

        <div class="flex flex-col gap-4">
          <!-- Password -->
          <UFormField :label="$t('settings.auth.password')">
            <UInput
              id="passwordInput"
              autofocus
              @keyup.enter="resetPassword"
              @focus="passwordInputFocused = true; showPasswordErrors = false"
              @blur="passwordInputFocused = false; showPasswordErrors = true"
              type="password"
              data-form-type="password"
              :placeholder="$t('settings.auth.password_placeholder')"
              v-model="password"
              class="w-full"
              :size="inputSize"
              color="neutral"
            />
            <Transition name="slide-up">
              <div v-if="shouldShowPasswordValidation" class="mt-2 space-y-1">
                <p v-for="message in passwordValidationMessages" :key="message" class="text-sm text-red-500">
                  {{ message }}
                </p>
              </div>
              <p v-else class="input-info">
                {{ $t('settings.auth.password_requirements') }}
              </p>
            </Transition>
          </UFormField>

          <!-- Confirm Password -->
          <UFormField :label="$t('settings.auth.repeat_password')">
            <UInput
              id="confirmPasswordInput"
              @keyup.enter="resetPassword"
              @focus="passwordRepeatInputFocused = true; showPasswordRepeatErrors = false"
              @blur="passwordRepeatInputFocused = false; showPasswordRepeatErrors = true"
              type="password"
              data-form-type="password,new"
              :placeholder="$t('settings.auth.password_placeholder')"
              v-model="confirmPassword"
              class="w-full"
              :size="inputSize"
              color="neutral"
            />
            <Transition name="slide-up">
              <div v-if="shouldShowPasswordRepeatValidation" class="mt-2">
                <p v-if="!passwordsMatch" class="text-sm text-red-500">
                  {{ $t('password_reset_page.mismatch') }}
                </p>
              </div>
            </Transition>
          </UFormField>
        </div>

        <!-- Button -->
        <div class="flex justify-end items-center space-x-4 mt-8">
          <UButton
            @click="navigateTo('/')"
            variant="ghost"
            color="neutral"
          >
            {{ $t('common.cancel') }}
          </UButton>

          <UButton
            @click="resetPassword"
            :disabled="!isFormValid || loading"
            :loading="loading"
            color="primary"
          >
            <span v-if="loading"> {{ $t('settings.auth.reset_password') }} </span>
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { useStore } from '~/stores/myStore';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import Parse from 'parse';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

definePageMeta({
    middleware: 'auth'
})

const route = useRoute();
const router = useRouter();
const store = useStore();

// Refs
const inputSize = ref('lg');
const password = ref('');
const confirmPassword = ref('');
const passwordInputFocused = ref(false);
const passwordRepeatInputFocused = ref(false);
const showPasswordErrors = ref(false);
const showPasswordRepeatErrors = ref(false);
const loading = ref(false);
const errorMessage = ref('');
const successMessage = ref('');

const { showAlert } = store;
// const { currentUser } = storeToRefs(store);

// Computed properties
const isPasswordValid = computed(() => {
  const regex = /^(?=.*\d).{2,}$/;
  return regex.test(password.value) &&
         password.value.length > 5 &&
         password.value === confirmPassword.value;
});

const passwordValidationMessages = computed(() => {
  if (!password.value) return [];

  const messages = [];

  // Check length requirement
  if (password.value.length < 6) {
    const needed = 6 - password.value.length;
    messages.push(t('password_reset_page.chars_needed', { count: needed }, needed));
  }

  // Check number requirement
  if (!/\d/.test(password.value)) {
    messages.push(t('password_reset_page.number_needed'));
  }

  return messages;
});

const shouldShowPasswordValidation = computed(() => {
  if (!password.value) return false;

  // Always show success immediately
  if (passwordValidationMessages.value.length === 0) return true;

  // Show errors only if user has clicked away or we explicitly want to show them
  return showPasswordErrors.value;
});

const passwordsMatch = computed(() => {
  return password.value === confirmPassword.value;
});

const shouldShowPasswordRepeatValidation = computed(() => {
  if (!confirmPassword.value) return false;

  // Always show success immediately
  if (passwordsMatch.value) return true;

  // Show errors only if user has clicked away or we explicitly want to show them
  return showPasswordRepeatErrors.value;
});

const isFormValid = computed(() => {
  return isPasswordValid.value && password.value.length > 5 && passwordsMatch.value;
});

// Methods
const resetPassword = async () => {
  if (!isFormValid.value) {
    return;
  }

  loading.value = true;
  errorMessage.value = '';
  successMessage.value = '';

  try {
    // Parse's reset link carries only the token (the older hosted one also carried the username).
    const token = route.query.token;

    if (!token) {
      throw new Error('Invalid reset link. Please request a new password reset.');
    }

    let verifiedPassword = await $fetch('/api/auth/passwordReset', {
      method: 'POST',
      body: JSON.stringify({ token, username: route.query.username, password: password.value })
    });

    console.log('verifiedPassword: ', verifiedPassword);
    
    if(!verifiedPassword.success){
      throw new Error('Password reset error: ' + verifiedPassword.error);
    }

    successMessage.value = t('auth.password_reset_success');

    // Redirect to login after 2 seconds
    setTimeout(() => {
      navigateTo('/?login=true');
    }, 1000);

  } catch (error) {
    console.error('Password reset error:', error);
    errorMessage.value = t('auth.password_reset_error');
    console.error('Password reset error:', errorMessage.value);
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  const token = route.query.token;

  if(!token){
    router.push({ name: 'index' })
    return
  }
  
  // Focus on password input
  setTimeout(() => {
    const passwordInput = document.getElementById('passwordInput');
    if (passwordInput) passwordInput.focus();
  }, 100);
});

</script>

<style scoped>
@reference "../assets/css/tailwind.css";
.extension-auth-container {
  @apply
    h-screen
    flex flex-col items-center justify-center
    bg-neutral-100 dark:bg-neutral-900
  ;
}

.auth-card {
  @apply
    flex flex-col
    max-w-md
    bg-white dark:bg-neutral-800
    border border-neutral-200 dark:border-neutral-700
    shadow-lg
    rounded-xl
  ;
}

.input-info {
  @apply text-sm text-gray-500 dark:text-gray-400 mt-1;
}

/* Transition animations matching AuthModal */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}

.slide-up-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}

.slide-up-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>