export default defineNuxtPlugin(() => {
  // Global error handler for authentication errors
  const handleAuthError = async (error: any) => {
    if (error.status === 401 || error.statusCode === 401) {
      console.warn('Authentication error detected, logging out user')
      
      try {
        // Clear authentication
        await $fetch('/api/auth/logout', { method: 'POST' })
        
        // Clear Parse session client-side
        if (window.Parse?.User?.current?.()) {
          await window.Parse.User.logOut()
        }
      } catch (logoutError) {
        console.error('Error during logout:', logoutError)
        // Fallback: clear Parse session cookie manually (wb_api_key is httpOnly and can only be cleared server-side)
        document.cookie = 'parse.session=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;'
        try {
          await window.Parse.User.logOut()
        } catch (err) {
          console.error('Error logging out user 2:', err)
        }
      }
      
      // Redirect to login page
      await navigateTo('/login')
    }
  }

  // Add global error handler for $fetch
  $fetch.create({
    onResponseError({ response }) {
      if (response.status === 401) {
        handleAuthError(response)
      }
    }
  })

  // Add global error handler for unhandled promise rejections
  if (process.client) {
    window.addEventListener('unhandledrejection', (event) => {
      const error = event.reason
      if (error && (error.status === 401 || error.statusCode === 401)) {
        handleAuthError(error)
        event.preventDefault() // Prevent the error from being logged to console
      }
    })
  }

  return {
    provide: {
      handleAuthError
    }
  }
})
