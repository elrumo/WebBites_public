// Billing add-on. Without billing there is nothing to buy or manage.
export default defineEventHandler(() => {
  throw createError({ statusCode: 404, statusMessage: 'Billing is not enabled on this installation' })
})
