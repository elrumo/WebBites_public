<!-- Webbites.io/pages/loginDesktop -->
<template>
  <div class="extension-auth-container">
    <div v-if="currentUser && authSuccess" class="auth-success">
        <div class="mb-4">
            <Icon name="heroicons:check-circle" class="h-12 w-12 text-green-600 dark:text-green-400" />
            <div class="success-title">
                {{ $t('shell.login_desktop.success') }}
            </div>
        </div>
    </div>

    <AuthModal
      v-else
      :isLoggedIn="currentUser"
      :preventClose="true"
      @auth-success="handleAuthSuccess"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { useStore } from '~/stores/myStore';
import { storeToRefs } from 'pinia';
import { useRoute } from 'vue-router';
import Parse from 'parse';

definePageMeta({
    middleware: 'auth'
})

const route = useRoute();
const store = useStore();
const authSuccess = ref(false);
const extensionDetected = ref(false);
const loadingExtAuth = ref(true);
const communicationMethod = ref(null);

const { showAlert } = store;

const {
  showAuthModal,
  currentUser
} = storeToRefs(store);

// Close tab function for extension auth
const closeTab = () => {
  window.close();
};

// Extension detection method
const detectExtension = () => {
  return new Promise((resolve) => {
    // Method 1: Check for bridge element
    const bridge = document.getElementById('webbites-extension-bridge');
    if (bridge && bridge.getAttribute('data-extension-present') === 'true') {
      extensionDetected.value = true;
      communicationMethod.value = 'dom_bridge';
      resolve(true);
      return;
    }
    
    // Method 2: Active detection via events
    let responded = false;
    
    const responseHandler = (event) => {
      if (!responded) {
        responded = true;
        extensionDetected.value = true;
        communicationMethod.value = 'event_response';
        resolve(true);
      }
    };
    
    document.addEventListener('webbites-extension-response', responseHandler, { once: true });
    
    // Send detection request
    document.dispatchEvent(new CustomEvent('webbites-check-extension'));
    
    // Timeout after 1 second
    setTimeout(() => {
      if (!responded) {
        document.removeEventListener('webbites-extension-response', responseHandler);
        resolve(false);
      }
    }, 1000);
  });
};

// Communication method
const sendAuthToExtension = (authData) => {
  if (!extensionDetected.value) {
    console.warn('Extension not detected, cannot send auth data');
    return false;
  }

  console.log("[sendAuthToExtension] authData: ", authData);
  
  // Send via DOM event
  document.dispatchEvent(new CustomEvent('webbites-send-auth', {
    detail: authData
  }));
  
  console.log(`Auth data sent via ${communicationMethod.value}`);
  return true;
};

// Handle successful authentication
const handleAuthSuccess = async () => {
  authSuccess.value = true;
  const user = Parse.User?.current?.() ?? null;

  console.log("user: ", user);
  if(user) navigateTo('/app')
  
};

const logout = async () => {
  try {
    await Parse.User.logOut();
    currentUser.value = null;
    
    localStorage.setItem('filteredSites', '');
    localStorage.setItem('pinnedSites', '');
  } catch (error) {
    console.log(error);
    showAlert({
      type: 'error',
      message: error.message
    });
  }
};

watch(() => authSuccess.value, (val) => {
  console.log("new authSuccess.value: ", authSuccess.value);
});

onMounted(async () => {
  // Always show auth modal
  showAuthModal.value = true;
  
  // Check if user is already authenticated
  if (Parse.User?.current?.()) {
    // Check if current user session is valid
    currentUser.value = Parse.User?.current?.() ?? null;
    showAuthModal.value = false;
    authSuccess.value = true;

    await handleAuthSuccess();
  }
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

.extension-auth-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  padding: 10px;
  background-color: #10b981;
  color: white;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 500;
  z-index: 10;
}

.auth-success {
    @apply
        flex flex-col items-center text-center
        py-5 px-8
        max-w-md 
        bg-white dark:bg-neutral-800 
        border border-neutral-200 dark:border-neutral-700 
        shadow-md 
        rounded-xl
    ;

    /* box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); */
}

.success-title {
  font-size: 1.5rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.success-message {
  color: #6b7280;
  margin-bottom: 1.5rem;
}
</style>
