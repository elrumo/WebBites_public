import { useRuntimeConfig } from '#app'
import { setCookie } from 'h3'

export default defineNuxtRouteMiddleware(async (to, from) => {

  // Only run on server side to prevent duplicate execution
  if (import.meta.client) {
    console.log('🔒 [CLIENT] AUTH MIDDLEWARE for route:', to.path)
    return
  }
  
  console.log('🔒 [SERVER] AUTH MIDDLEWARE for route:', to.path)
})
