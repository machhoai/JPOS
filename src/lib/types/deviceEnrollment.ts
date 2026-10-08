export interface PosDeviceCredential {
  device_id: string;
  device_credential: string;
  warehouse_id: string;
  last_verified_at?: string;
}

export interface PosDeviceActivationResult {
  device: {
    id: string;
    warehouse_id: string;
    name: string;
    status: "ACTIVE" | "REVOKED";
  };
  device_credential: string;
}

export interface RemotePosReceiptSettings {
  warehouse_id: string;
  version: number;
  paper_size: "POS58" | "POS80" | "POS82";
  theme: "CLASSIC" | "NATIONAL_DAY" | "TET";
  theme_messages: Record<string, string>;
  theme_message_font_size_pt: number;
  store_name: string;
  store_address: string;
  hotline: string;
  after_sales_text: string;
  footer_message: string;
  logo_data_url: string | null;
  logo_content_url?: string | null;
  logo_checksum_sha256?: string | null;
  logo_width_mm: number;
  logo_max_height_mm: number;
  logo_contrast_percent: number;
  invoice_qr_size_mm: number;
  invoice_qr_title_font_size_pt: number;
  invoice_qr_hint_font_size_pt: number;
  font_weights: import("@/features/receipt/types/receipt").ReceiptFontWeights;
  show_logo: boolean;
  show_cashier: boolean;
  show_contact: boolean;
  show_item_tax: boolean;
  show_invoice_request_qr: boolean;
  show_theme_message: boolean;
  default_tax_rate: number;
}

export type RemotePosReceiptSettingsPayload = Omit<
  RemotePosReceiptSettings,
  "warehouse_id" | "version"
>;

export interface PosReceiptSettingsWatchResult {
  changed: boolean;
  receipt_settings: RemotePosReceiptSettings | null;
  server_time: string;
}

export interface RemotePosTicketSettings {
  warehouse_id: string;
  version: number;
  paper_size: "POS58" | "POS80" | "POS82";
  ticket_height_mm: number;
  store_name: string;
  ticket_title: string;
  subtitle: string;
  instructions: string;
  footer_message: string;
  logo_data_url: string | null;
  logo_content_url?: string | null;
  logo_checksum_sha256?: string | null;
  logo_width_mm: number;
  logo_max_height_mm: number;
  logo_contrast_percent: number;
  qr_size_mm: number;
  title_font_size_pt: number;
  product_font_size_pt: number;
  body_font_size_pt: number;
  font_weight: import("@/features/receipt/types/receipt").ReceiptFontWeight;
  show_logo: boolean;
  show_order_code: boolean;
  show_issued_at: boolean;
  show_price: boolean;
  show_sequence: boolean;
  auto_print_after_payment: boolean;
}

export type RemotePosTicketSettingsPayload = Omit<
  RemotePosTicketSettings,
  "warehouse_id" | "version"
>;

export interface PosTicketSettingsWatchResult {
  changed: boolean;
  ticket_settings: RemotePosTicketSettings | null;
  server_time: string;
}

export interface PosDeviceHeartbeatResult {
  device: PosDeviceActivationResult["device"];
  server_time: string;
}

export interface PosDeviceConfigVersions {
  cash_drawer_settings?: number | null;
  receipt_settings: number | null;
  ticket_settings: number | null;
  payment_settings: number | null;
  customer_display_settings: number | null;
}

export interface PosDeviceConfigSyncResult {
  cash_drawer_settings?: import("@/features/printer/helpers/remoteCashDrawerSettings").RemoteCashDrawerSettings | null;
  versions: PosDeviceConfigVersions;
  changed: Record<Exclude<keyof PosDeviceConfigVersions, "cash_drawer_settings">, boolean> & { cash_drawer_settings?: boolean };
  receipt_settings: RemotePosReceiptSettings | null;
  ticket_settings: RemotePosTicketSettings | null;
  payment_settings: import("@/lib/types/paymentSettings").FixedTransferSettings | null;
  customer_display_settings: import("@/lib/types/customerDisplayAdvertising").CustomerDisplayAdvertisingView | null;
  server_time: string;
}

export type PosCustomerDisplaySettingsWatchResult =
  import("@/lib/types/customerDisplayAdvertising").CustomerDisplayAdvertisingWatchResult;
