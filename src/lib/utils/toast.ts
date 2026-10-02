// =============================================================================
// Toast Utility — Wrapper chuẩn hóa goey-toast cho hệ thống JPOS
// Mục đích: Ép buộc mọi thông báo đều 100% Tiếng Việt, có đầy đủ
// title + description, và nút "Thử lại" khi lỗi.
// =============================================================================

import { gooeyToast } from "goey-toast";

/** Cấu hình mặc định cho toast */
const DEFAULT_TIMING = { displayDuration: 5000 };
const DEFAULT_PRESET = "snappy" as const;

// ── Simple toasts ───────────────────────────────────────────────────────

export function showSuccess(title: string, description?: string) {
    gooeyToast.success(title, {
        description,
        preset: DEFAULT_PRESET,
        timing: DEFAULT_TIMING,
    });
}

export function showError(title: string, description?: string) {
    gooeyToast.error(title, {
        description,
        preset: DEFAULT_PRESET,
        timing: { displayDuration: 8000 },
    });
}

export function showInfo(title: string, description?: string) {
    gooeyToast.info(title, {
        description,
        preset: DEFAULT_PRESET,
        timing: DEFAULT_TIMING,
    });
}

export function showWarning(title: string, description?: string) {
    gooeyToast.warning(title, {
        description,
        preset: DEFAULT_PRESET,
        timing: { displayDuration: 6000 },
    });
}

// ── Promise toast (cho mọi thao tác bất đồng bộ) ───────────────────────

interface PromiseToastOptions {
    loading: string;
    success: string;
    error: string;
    successDescription?: string;
    errorDescription?: string | ((error: unknown) => string);
    /** Callback retry khi gặp lỗi */
    onRetry?: () => void;
}

/**
 * Bọc một Promise với goey-toast:
 * - Hiển thị loading khi đang xử lý
 * - Hiển thị success/error khi hoàn tất
 * - Tự động có nút "Thử lại" khi lỗi (nếu truyền onRetry)
 *
 * @example
 * ```ts
 * showPromise(checkout(shopId), {
 *   loading: "Đang tạo đơn hàng...",
 *   success: "Thanh toán thành công",
 *   error: "Lỗi thanh toán",
 *   successDescription: "Đơn hàng đã được ghi nhận",
 *   errorDescription: "Vui lòng thử lại hoặc kiểm tra kết nối",
 *   onRetry: () => checkout(shopId),
 * });
 * ```
 */
export function showPromise<T>(promise: Promise<T>, opts: PromiseToastOptions): Promise<T> {
    gooeyToast.promise(promise, {
        loading: opts.loading,
        success: opts.success,
        error: opts.error,
        description: {
            success: opts.successDescription || "Thao tác đã được hoàn tất.",
            error: opts.errorDescription || "Vui lòng thử lại hoặc kiểm tra kết nối mạng.",
        },
        ...(opts.onRetry && {
            action: {
                error: {
                    label: "Thử lại",
                    onClick: opts.onRetry,
                },
            },
        }),
    });

    return promise;
}
