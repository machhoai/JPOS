/**
 * Read-only bduck-system collections used by POS authentication.
 * POS must never create, update, or delete documents in these collections.
 */
export const SHARED_AUTH_COLLECTIONS = {
  users: "users",
  employeeProfiles: "employee_profiles",
  roles: "roles",
  userWarehouseRoles: "user_warehouse_roles",
  warehouses: "warehouses",
} as const;

/**
 * Collections owned by the POS application.
 *
 * `jpos_products` is a legacy collection name already used in production.
 * New POS-owned collections must use the `pos_` prefix.
 */
export const POS_COLLECTIONS = {
  products: "jpos_products",
  orders: "pos_orders",
  paymentStatus: "pos_payment_status",
  paymentChecks: "pos_payment_checks",
  orderSummaries: "pos_order_summaries",
  paymentSettings: "pos_payment_settings",
  luckyDrawSettings: "pos_lucky_draw_settings",
  productVisibilitySettings: "pos_product_visibility_settings",
  productSyncRuns: "pos_product_sync_runs",
  devices: "pos_devices",
  members: "pos_members",
  memberCompensations: "pos_member_compensations",
  voucherCampaignSettings: "pos_voucher_campaign_settings",
  voucherRedemptions: "pos_voucher_redemptions",
} as const;
