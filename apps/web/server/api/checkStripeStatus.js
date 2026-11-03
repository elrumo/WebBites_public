// Billing is a separate add-on (the hosted service). Without it there is nothing to check.
// A billing layer replaces this file with the real implementation.
export default defineEventHandler(() => ({ billing: false }))
