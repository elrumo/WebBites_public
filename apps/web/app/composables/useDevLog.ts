export const log = (...args: any[]) => {
  const isDevelopment = import.meta.dev

  let isDevParam = false
  if (process.client && typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search)
    isDevParam = urlParams.get('isDev') === 'true'
  }

  if (isDevelopment || isDevParam) {
    console.log(...args)
  }
}

export const useDevLog = () => {
  return {
    log
  }
}
