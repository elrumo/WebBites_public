// Billing add-on: an administrator changing a user's plan. Without billing there are no plans.
export default defineEventHandler(() => {
  throw createError({ statusCode: 404, statusMessage: 'Billing is not enabled on this installation' })
})
