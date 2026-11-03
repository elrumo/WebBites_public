<template>
  <!-- AuthModal.vue — the sign-in card mirrors the native app's SignInView:
       charcoal canvas, faded grid, green bloom behind the mark, translucent
       fields with a green focus ring, and white pill buttons. -->
  <UModal
    v-model:open="showAuthModal"
    :dismissible="!(preventClose)"
    :ui="{ content: 'sm:max-w-md bg-transparent shadow-none ring-0 divide-y-0' }"
  >
    <template #content>
      <div class="auth-card dark">
        <div class="auth-grid" aria-hidden="true"></div>
        <div class="auth-bloom" aria-hidden="true"></div>

        <UButton
          v-if="!preventClose"
          icon="i-heroicons-x-mark"
          variant="ghost"
          color="neutral"
          square
          class="auth-close"
          :aria-label="$t('common.close')"
          @click="showAuthModal = false"
        />

        <div class="relative flex flex-col gap-6">
          <img
            src="@/assets/images/WebBites-Icon.png"
            alt="WebBites"
            class="auth-mark"
          >

          <div class="space-y-1">
            <h1 class="text-xl font-bold text-white">
              {{ stepTitle }}
            </h1>
            <p class="text-sm text-white/55">
              {{ stepSubtitle }}
            </p>
          </div>

          <!-- Login form -->
          <div class="flex flex-col gap-3">
            <input
              id="emailInput"
              v-model="email"
              autofocus
              type="email"
              data-form-type="email"
              autocomplete="email"
              class="brand-field"
              :disabled="waitlistDone"
              :placeholder="$t('settings.auth.email_placeholder')"
              @keyup.enter="doesAccountExist"
            >

            <!-- userName -->
            <Transition name="slide-up">
              <input
                v-if="isSignUp || isWaitlist && !isLoggedIn"
                id="userName"
                v-model="userName"
                autofocus
                type="text"
                data-form-type="username"
                autocomplete="name"
                class="brand-field"
                :disabled="waitlistDone"
                :placeholder="$t('settings.auth.name_placeholder')"
                @keyup.enter="nextStep"
              >
            </Transition>

            <!-- Password -->
            <Transition name="slide-up">
              <div v-if="(isLogin || isSignUp) && emailIsValid && !isLoggedIn" class="flex flex-col gap-2">
                <input
                  id="password"
                  v-model="password"
                  type="password"
                  data-form-type="password"
                  :autocomplete="isSignUp ? 'new-password' : 'current-password'"
                  class="brand-field"
                  :placeholder="$t('settings.auth.password_placeholder')"
                  @keyup.enter="nextStep"
                  @focus="passwordInputFocused = true; showPasswordErrors = false"
                  @blur="passwordInputFocused = false; showPasswordErrors = true"
                >

                <Transition name="slide-up">
                  <div v-if="shouldShowPasswordValidation" class="space-y-1">
                    <p v-for="message in passwordValidationMessages" :key="message" class="brand-error">
                      {{ message }}
                    </p>
                  </div>
                  <p v-else-if="isSignUp" class="brand-hint">
                    {{ $t('settings.auth.password_requirements') }}
                  </p>
                </Transition>
              </div>
            </Transition>

            <!-- Repeat Password -->
            <Transition name="slide-up">
              <div v-if="isSignUp && !isLoggedIn" class="flex flex-col gap-2">
                <input
                  id="passwordRepeated"
                  v-model="passwordRepeated"
                  type="password"
                  data-form-type="password,new"
                  autocomplete="new-password"
                  class="brand-field"
                  :placeholder="$t('settings.auth.repeat_password')"
                  @keyup.enter="nextStep"
                  @focus="passwordRepeatInputFocused = true; showPasswordRepeatErrors = false"
                  @blur="passwordRepeatInputFocused = false; showPasswordRepeatErrors = true"
                >
                <Transition name="slide-up">
                  <p v-if="!passwordsMatch && shouldShowPasswordRepeatValidation" class="brand-error">
                    {{ $t('auth_modal.passwords_mismatch') }}
                  </p>
                </Transition>
              </div>
            </Transition>

            <Transition name="slide-up">
              <p v-if="loginError" class="brand-error">
                {{ loginError }}
              </p>
            </Transition>

            <!-- Message alert -->
            <Transition name="slide-up">
              <UAlert v-if="message.length > 0" color="info" variant="solid" icon="i-heroicons-information-circle">
                <p v-html="message"></p>
              </UAlert>
            </Transition>

            <template v-if="!isLoggedIn">
              <UButton
                id="authModalFooter"
                class="brand-pill mt-1"
                :disabled="!isFormValid || loading"
                :loading="loading"
                @click="nextStep"
              >
                {{ primaryLabel }}
              </UButton>

              <Transition name="slide-up">
                <button v-if="isLogin" type="button" class="brand-quiet" @click="resetPassword">
                  {{ $t('settings.auth.reset_password') }}
                </button>
              </Transition>
            </template>

            <div v-else class="flex flex-col gap-3 mt-1">
              <UButton v-if="!isExtensionAuth" to="app" class="brand-pill">
                {{ $t('auth.go_to_app') }}
              </UButton>
              <button type="button" class="brand-quiet" @click="logout">
                {{ $t('auth.logout') }}
              </button>
            </div>
          </div>

          <div class="flex items-center gap-3 text-xs text-white/45">
            <span class="h-px flex-1 bg-white/12"></span>
            {{ $t('common.or') || 'or' }}
            <span class="h-px flex-1 bg-white/12"></span>
          </div>

          <SignInWithApple :compact="false" class="brand-pill" />
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup>
import { ref, watch, computed, onMounted } from 'vue';

import Parse from 'parse';
import { useStore } from '~/stores/myStore';
import { storeToRefs } from 'pinia';
import party from "party-js";
import { useRouter, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
const { t } = useI18n();

// Store setup
const store = useStore();
const router = useRouter();
const route = useRoute();

const { logout } = store;
const { 
  showAuthModal, 
  alert, 
  isLoggedIn 
} = storeToRefs(store);

const { 
  showAlert, 
  createDebounce,
  signInWithApple
} = store;

// Emit events
const emit = defineEmits(['auth-success']);

// Props
const props = defineProps({
    preventClose: {
        type: Boolean,
        default: false
    },
    isExtensionAuth: {
        type: Boolean,
        default: false
    }
});


// Refs
const currentBookmarkManager = ref('');
const whatAiLooksLike = ref('');
const mostInterested = ref('');

const inputSize = ref('lg');
const email = ref('');
const passwordRepeated = ref('');
const password = ref('');
const userName = ref('');
const debounce = ref(createDebounce());
const passwordInputFocused = ref(false);
const passwordRepeatInputFocused = ref(false);
const showPasswordErrors = ref(false);
const showPasswordRepeatErrors = ref(false);

const waitlistDone = ref(false);
const isSignUp = ref(false);
const isLogin = ref(false);
const isWaitlist = ref(false);

const waitListUser = ref({});
const loading = ref(false);
const currentUser = ref(null);
const loginError = ref('');
const logInVisible = ref(false);
const message = ref('');

// Computed properties
const emailIsValid = computed(() => {
  const re = /\S+@\S+\.\S+/;
  return re.test(email.value);
});

const isPasswordValid = computed(() => {
  const regex = /^(?=.*\d).{2,}$/;

  if (isLogin.value) {
    return password.value.length > 5;
  } else if (isSignUp.value) {
    return regex.test(password.value) &&
           password.value.length > 5 &&
           password.value === passwordRepeated.value;
  }
  return false;
});

const passwordValidationMessages = computed(() => {
  if (!isSignUp.value || !password.value) return [];
  
  const messages = [];
  
  // Check length requirement
  if (password.value.length < 6) {
    const needed = 6 - password.value.length;
    messages.push(t('auth_modal.password_needs_chars', { n: needed }, needed));
  }
  
  // Check number requirement
  if (!/\d/.test(password.value)) {
    messages.push(t('auth_modal.password_needs_number'));
  }
  
  return messages;
});

const shouldShowPasswordValidation = computed(() => {
  if (!isSignUp.value || !password.value) return false;
  
  // Always show success immediately
  if (passwordValidationMessages.value.length === 0) return true;
  
  // Show errors only if user has clicked away or we explicitly want to show them
  return showPasswordErrors.value;
});

const passwordsMatch = computed(() => {
  if (!isSignUp.value) return true;
  return password.value === passwordRepeated.value;
});

const shouldShowPasswordRepeatValidation = computed(() => {
  if (!isSignUp.value || !passwordRepeated.value) return false;
  
  // Always show success immediately
  if (passwordsMatch.value) return true;
  
  // Show errors only if user has clicked away or we explicitly want to show them
  return showPasswordRepeatErrors.value;
});

const isSignUpValid = computed(() => {
  if (isLogin.value) {
    return emailIsValid.value && isPasswordValid.value;
  } else if (isSignUp.value) {
    return emailIsValid.value && isPasswordValid.value && userName.value.length > 0;
  }
  return emailIsValid.value;
});

const isFormValid = computed(() => {
  if (!isLogin.value && !isSignUp.value && !isPasswordValid.value) {
    return emailIsValid.value;
  }
  if (isLogin.value) return emailIsValid.value;
  if (isSignUp.value) return isSignUpValid.value;
  if (isWaitlist.value) return emailIsValid.value;
});

const stepTitle = computed(() => {
  if (isLogin.value) return t('settings.auth.welcome_back');
  if (isSignUp.value) return t('settings.auth.create_account');
  return t('settings.auth.email_continue');
});

const stepSubtitle = computed(() => {
  if (isLogin.value) return t('settings.auth.welcome_back_description');
  if (isSignUp.value) return t('settings.auth.create_account_step_description');
  return t(props.isExtensionAuth ? 'auth.extension_login_description' : 'settings.auth.create_account_description');
});

const primaryLabel = computed(() => {
  if (isLogin.value) return t('auth.sign_in');
  if (isSignUp.value) return t('settings.auth.create_account_button');
  return t('common.continue');
});

// Methods
const confetti = (target) => {
  party.confetti(target);
};

const resetPassword = () => {
  Parse.User.requestPasswordReset(email.value)
    .then(() => {
      showAlert({
        message: t('auth.email_success'),
        permanent: true
      });
    })
    .catch((error) => {
      showAlert({
        message: t('auth.email_error') + error.code + ' ' + error.message,
        type: 'error'
      });
    });
};

const isAlreadyOnWailist = async () => {
  try {
    const requestBody = {
      email: email.value,
      name: userName.value,
      funcName: 'isEmailOnWaitlist'
    };

    let waitlistEntry = await $fetch('/api/authFlow', { method: 'POST', body: requestBody });

    waitlistEntry = waitlistEntry.waitlistEntries;
    const canCreateAccount = waitlistEntry.canCreateAccount;

    waitListUser.value = waitlistEntry[0];

    return {
      isOnList: waitlistEntry.length > 0,
      waitlistEntry,
      canCreateAccount
    };
  } catch (error) {
    console.error('Error calling isEmailOnWaitlist: ', error);
    return {
      isOnList: false,
      waitlistEntry: []
    };
  }
};

const addToParseWaitlist = async () => {
  try {
    const requestBody = {
      email: email.value,
      name: userName.value,
      waitlistQuestionnaire: {
        currentBookmarkManager: currentBookmarkManager.value,
        mostInterested: mostInterested.value,
        whatAiLooksLike: whatAiLooksLike.value,
      },
      funcName: 'saveToWaitlist'
    };

    let savedEmail = await $fetch('/api/authFlow', { method: 'POST', body: requestBody });

    savedEmail = savedEmail.result;
    console.log('waitlist saved', savedEmail);
    waitlistDone.value = true;
    showAlert({ message: t('auth.waitlist_success_alert') });
  } catch (error) {
    waitlistDone.value = true;
    showAlert({ message: t('common.error_try_again') });
    loading.value = false;
    console.log('waitlist save error', error);
  }
};

const signUp = async () => {
  if (isSignUpValid.value) {
    try {
      // Sign up via server-side endpoint (uses master key to bypass CLP restrictions)
      const signupResponse = await $fetch('/api/auth/signup', {
        method: 'POST',
        body: {
          email: email.value,
          password: password.value,
          userName: userName.value
        }
      });

      if (!signupResponse.success) {
        throw new Error(signupResponse.message || t('auth_modal.signup_failed'));
      }

      // Use Parse.User.become() to set the current user with the session token
      const signedUpUser = await Parse.User.become(signupResponse.sessionToken);
      store.userId = signedUpUser.id;
      console.log("signUpUser: ", signedUpUser);

      // After successful signup, login with the new auth system using session token
      const loginResponse = await $fetch('/api/auth/login', {
        method: 'POST',
        body: {
          sessionToken: signupResponse.sessionToken
        }
      });

      if (loginResponse.success) {
        console.log("Success signing up and logging in");

        try{
          useTrackEvent('signupCompleted', { props: { userId: signedUpUser.id } });
        } catch(error){
          console.log('error tracking signup: ', error);
        }

        // Emit auth success event for extension auth
        emit('auth-success');

        // Only push to app route if current route is index and not extension auth
        if (route.name === 'index' && !props.isExtensionAuth) {
          router.push({ name: 'app' });
        }
      } else {
        throw new Error(loginResponse.message || t('auth_modal.login_after_signup_failed'));
      }
    } catch (error) {
      console.log("error signing up: ", error);
      showAlert({ message: error.message });
      loading.value = false;
      waitlistDone.value = false;
    } finally {
      loading.value = false;
    }
  }
};

const login = async () => {
  if (!isSignUpValid.value) {
    return false;
  }

  loading.value = true;

  try {
    let loginResponse = await useAuth().login(email.value, password.value)
    if(!loginResponse.success) throw new Error(loginResponse.message || t('auth_modal.login_failed'));

    let user = await Parse.User.become(loginResponse.sessionToken);
    store.userId = user.id;

    const parseSession = useCookie('parse.session')
    
    log('[authModal] loginResponse: ', loginResponse)
    log('[authModal] parseSession: ', parseSession.value)
    log('[authModal] user: ', user)
    log('[authModal] user.id: ', user.id)
    
    // Emit auth success event for extension auth
    emit('auth-success');

    try{
      useTrackEvent('loginCompleted', { props: { userId: user.id } });
    } catch(error){
      console.log('[authModal] error doesAccountExist: ', error);
    }
    
    if (!props.isExtensionAuth) {
      showAuthModal.value = false;
      // Only push to app route if current route is index
      if (route.name === 'index') {
        router.push({ name: 'app' });
      }
    }

    try {
      if (window.clarity) window.clarity("event", "SignIn");
    } catch (error) {
      console.log(error);
    }

    currentUser.value = user;
    console.log('[authModal] currentUser.value: ', currentUser.value);
    loading.value = false;
    return true;
  } catch (error) {
    console.error('Login error:', error);
    loginError.value = error.data?.message || error.message || t('auth_modal.login_failed');
    loading.value = false;
    return false;
  }
};

const doesAccountExist = async () => {
  try {
    loading.value = true;

    if (!emailIsValid.value) {
      loading.value = false;
      return false;
    }

    // console.log("email.value: ", email.value);

    // Check if user exists
    const requestBody = {
      email: email.value,
      funcName: 'findEmail'
    };

    let users = await $fetch('/api/authFlow', { method: 'POST', body: requestBody });

    if (!users.isNewUser) {
      // Existing user - show login form
      isSignUp.value = false;
      isWaitlist.value = false;
      isLogin.value = true;
    } else {
      // New user - allow direct signup
      isSignUp.value = true;
      isWaitlist.value = false;
      isLogin.value = false;
    }

    try{
      useTrackEvent('signupStarted');
    } catch(error){
      console.log('error doesAccountExist: ', error);
    }

    loading.value = false;
  } catch (error) {
    console.log("error finding account, doesAccountExist: ", error);
    loading.value = false;
  }
};

const nextStep = async () => {
  if(!isFormValid.value || loading.value) return;

  loading.value = true;

  if (isLogin.value) {
    await login();
  } else if (isSignUp.value) {
    await signUp();
  }
};

// Watchers
watch(showAuthModal, (val) => {
  logInVisible.value = val;
  if(val){
    setTimeout(() => {
      let emailInput = document.getElementById('emailInput');
      if(emailInput) emailInput.focus();
    }, 10);
  }
});

watch(email, (val) => {
  email.value = val.toLowerCase().trim();
  debounce.value(() => doesAccountExist(), 300);
});

watch(alert, (val) => {
  if (val.show) {
    setTimeout(() => {
      alert.value.type = 'success';
      alert.value.show = false;
    }, 8000);
  }
}, { deep: true });

watch(waitListUser, (val) => {
  if (val != undefined && Object.keys(val).length > 0) {
    userName.value = val.name;
  }
}, { deep: true });

// Lifecycle hooks
onMounted(() => {
  // if (Parse.User.current()) {
  //   currentUser.value = Parse.User.current();
  // }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const inputs = document.querySelectorAll('input');
      const activeElementIndex = Array.from(inputs).indexOf(document.activeElement);

      if (e.shiftKey) {
        const previousInput = inputs[activeElementIndex - 1];
        if (previousInput) {
          previousInput.focus();
        }
      } else {
        const nextInput = inputs[activeElementIndex + 1];
        if (nextInput) {
          nextInput.focus();
        }
      }
    }
  });
});
</script>

<style>
/* Unscoped on purpose: the pills style UButton roots two components deep
   (SignInWithApple → UButton → button), which scoped CSS doesn't reach. */
.auth-card {
  position: relative;
  overflow: hidden;
  padding: 2rem;
  border-radius: 1.75rem;
  color: #fff;
  background: linear-gradient(180deg, #262628 0%, #161618 55%, #161618 100%);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(255, 255, 255, 0.10);
}

/* The site's grid_bg.svg, fading out toward the edges like the native AuthBackdrop. */
.auth-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: url('/images/grid_bg.svg');
  background-size: 640px auto;
  opacity: 0.35;
  mask-image: radial-gradient(circle at 50% 22%, #000 0%, rgba(0, 0, 0, 0.35) 40%, transparent 75%);
  -webkit-mask-image: radial-gradient(circle at 50% 22%, #000 0%, rgba(0, 0, 0, 0.35) 40%, transparent 75%);
}

/* The green bloom behind the mark, breathing slowly. */
.auth-bloom {
  position: absolute;
  left: 50%;
  top: -8%;
  width: 110%;
  aspect-ratio: 1;
  translate: -50% 0;
  pointer-events: none;
  background: radial-gradient(circle, rgba(34, 197, 94, 0.30) 0%, transparent 55%);
  filter: blur(30px);
  mix-blend-mode: screen;
  animation: auth-bloom 7s ease-in-out infinite alternate;
}

@keyframes auth-bloom {
  from { scale: 0.94; opacity: 0.65; }
  to   { scale: 1.12; opacity: 0.95; }
}

@media (prefers-reduced-motion: reduce) {
  .auth-bloom { animation: none; }
}

.auth-close {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  z-index: 1;
  color: rgba(255, 255, 255, 0.6) !important;
}

.auth-mark {
  width: 56px;
  height: 56px;
  filter: drop-shadow(0 8px 24px rgba(34, 197, 94, 0.55));
}

.brand-field {
  width: 100%;
  font-size: 16px;
  color: #fff;
  padding: 15px 18px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  outline: none;
  transition: background 0.18s, border-color 0.18s, box-shadow 0.18s;
}
.brand-field::placeholder { color: rgba(255, 255, 255, 0.35); }
.brand-field:focus {
  background: rgba(255, 255, 255, 0.10);
  border-color: #4ade80;
  box-shadow: 0 0 0 0.5px #4ade80, 0 0 12px rgba(74, 222, 128, 0.30);
}
.brand-field:disabled { opacity: 0.5; }

.brand-hint {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.45);
}

.brand-error {
  font-size: 0.8125rem;
  color: rgb(255, 140, 133);
  padding: 8px 12px;
  border-radius: 12px;
  background: rgba(239, 68, 68, 0.14);
}

/* The white pill the landing page uses for its calls to action. */
.auth-card .brand-pill {
  width: 100%;
  height: 52px;
  justify-content: center;
  border-radius: 9999px;
  font-size: 17px;
  font-weight: 600;
  color: #171717 !important;
  background: #fff !important;
  box-shadow: 0 10px 18px rgba(0, 0, 0, 0.35);
  transition: transform 0.18s, background 0.18s, box-shadow 0.18s, opacity 0.18s;
}
.auth-card .brand-pill:hover:not(:disabled) { background: rgba(255, 255, 255, 0.92) !important; }
.auth-card .brand-pill:active:not(:disabled) { transform: scale(0.97); }
.auth-card .brand-pill:disabled {
  opacity: 1 !important;
  color: rgba(255, 255, 255, 0.45) !important;
  background: rgba(255, 255, 255, 0.10) !important;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14);
}

.brand-quiet {
  align-self: center;
  font-size: 0.8125rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.6);
  transition: color 0.18s;
}
.brand-quiet:hover { color: #fff; }
</style>
