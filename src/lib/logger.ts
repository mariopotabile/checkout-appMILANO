// src/lib/logger.ts
const isDev = process.env.NODE_ENV === 'development'

export const logger = {
  log: (...args: any[]) => {
    if (isDev) console.log(...args)
  },
  error: (...args: any[]) => {
    console.error(...args) // Errori sempre visibili
  },
  warn: (...args: any[]) => {
    if (isDev) console.warn(...args)
  },
}
