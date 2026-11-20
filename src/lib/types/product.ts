// =============================================================================
// Product Types — POS product catalog
// =============================================================================

/**
 * Nhóm sản phẩm trong hệ thống POS.
 * Mapping từ numeric ID của HK API sang nhãn tiếng Việt.
 */
export const CATEGORY_MAP: Record<number, string> = {
    1: "Gói Xu",
    2: "Gói Điểm",
    4: "Vé lượt",
    6: "Nạp Thẻ",
    10: "Sản phẩm lưu niệm",
};

/** Thứ tự hiển thị các nhóm sản phẩm. */
export const CATEGORY_IDS = [4, 10, 1, 2, 6] as const;

/**
 * Nhóm phụ (typeName) bên trong mỗi category.
 * Dùng để hiển thị sub-tab hoặc badge.
 */
export interface ProductType {
    typeId: string;
    typeName: string;
}

/**
 * Sản phẩm POS — cấu trúc chung cho cả 3 nhóm.
 * Dữ liệu gốc từ HK API, hiện dùng mock data.
 */
export interface Product {
    vietnamSettingsVersion?: number;
    sendSaleToHk?: boolean;
    /** ID sản phẩm (setMealId hoặc passticketId hoặc giftId) */
    goodsId: string;
    /** Tên hiển thị */
    goodsName: string;
    /** Mô tả / ghi chú */
    description?: string;
    /** Giá bán chưa thuế (VND) */
    price: number;
    /** Giá sau thuế (VND) — dùng cho hiển thị lên UI */
    afterTaxPrice: number;
    /** Giá gạch ngang (giá gốc trước giảm giá) */
    underlinePrice: number;
    /** Category chính: 1 = Gói thành viên, 4 = Vé lượt, 10 = Sản phẩm lưu niệm */
    category: number;
    /** Sub-category name */
    subCategory: string;
    /** Type ID (nhóm phụ) */
    typeId: string;
    /** Type name (tên nhóm phụ) */
    typeName: string;
    /** Stable subgroup identifier persisted with the catalog. */
    groupKey?: string;
    /** Màu chữ (hex) từ HK API — dùng cho card */
    foreColor: string;
    /** Màu nền (hex) từ HK API — dùng cho card */
    backColor: string;
    /** Giá trị gốc của gói từ trường `amount` tại lần đồng bộ gần nhất. */
    principalPoints?: number;
    /** Giá trị thưởng từ tổng `giveConfigs[].giveAmount` tại lần đồng bộ gần nhất. */
    bonusPoints?: number;
    /** Thuế suất (%) */
    taxRate: number;
    /** Kiểu thuế HK: 1 = phần trăm, 2 = số tiền cố định. */
    taxRateType?: number;
    /** Đang mở bán */
    isOpenSales: boolean;
    /** Đang kích hoạt */
    isEnabled: boolean;
    /** Số vé vật lý cần in cho mỗi đơn vị sản phẩm vé. */
    ticketsPerUnit?: number;
    /** Số lượng tồn kho (nếu áp dụng) */
    amount: number;
    /** Badge hiển thị (nếu có) */
    badge?: string;
    /** Mô tả giảm giá (nếu có) */
    discountDesc?: string;
    /** Mã vạch (cho sản phẩm lưu niệm) */
    barCode?: string;
    /** Mã sản phẩm (cho sản phẩm lưu niệm) */
    giftNo?: string;
    /** ISO 8601 timestamp đồng bộ lần cuối */
    lastSyncAt?: string;
}
