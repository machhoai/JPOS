"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { IoAlbums, IoDesktop, IoDocument, IoHome, IoPeople, IoSettings, IoTicket, IoTime } from "react-icons/io5";
import { useUpdater } from "@/features/updater/components/UpdateProvider";
import { useAuth } from "@/lib/contexts/AuthContext";
import { ORDER_HISTORY_READ_PERMISSION } from "@/lib/auth/permissions";
import { usePayOSReconciliationStore } from "@/features/payments/store/usePayOSReconciliationStore";

interface SidebarProps {
    onLogout: () => void;
}

const NAV_ITEMS = [
    {
        href: "/",
        label: "Bán hàng",
        icon: <IoHome />
    },
    {
        href: "/members",
        label: "Thành viên",
        icon: <IoPeople />
    },
    {
        href: "/voucher-redemption",
        label: "Đổi voucher",
        icon: <IoTicket />
    },
    {
        href: "/orders",
        label: "Đơn hàng",
        icon: <IoDocument />
    },
    {
        href: "/shift-close",
        label: "Kết ca",
        icon: <IoTime />
    },
    {
        href: "/display-control",
        label: "Điều khiển màn hình khách",
        icon: <IoDesktop />
    },
    {
        href: "/members/batch",
        label: "Tạo thẻ hàng loạt",
        icon: <IoAlbums />
    },
];

export default function Sidebar({ onLogout }: SidebarProps) {
    const pathname = usePathname();
    const updater = useUpdater();
    const { user, effectiveWarehouseId, hasPermission } = useAuth();
    const paymentScope = user && effectiveWarehouseId ? `${user.uid}:${effectiveWarehouseId}` : null;
    const pendingPayOSCount = usePayOSReconciliationStore((state) =>
        paymentScope && state.scopeKey === paymentScope ? state.pendingCount : 0,
    );
    const hasAvailableUpdate = updater.availableVersion !== null;
    const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
    const logoutButtonRef = useRef<HTMLButtonElement>(null);
    const cancelButtonRef = useRef<HTMLButtonElement>(null);
    const confirmButtonRef = useRef<HTMLButtonElement>(null);

    const openLogoutConfirm = useCallback(() => {
        setIsLogoutConfirmOpen(true);
    }, []);

    const closeLogoutConfirm = useCallback(() => {
        setIsLogoutConfirmOpen(false);
        window.requestAnimationFrame(() => logoutButtonRef.current?.focus());
    }, []);

    const confirmLogout = useCallback(() => {
        setIsLogoutConfirmOpen(false);
        onLogout();
    }, [onLogout]);

    useEffect(() => {
        if (!isLogoutConfirmOpen) return;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        cancelButtonRef.current?.focus();

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                closeLogoutConfirm();
                return;
            }

            if (event.key !== "Tab") return;
            const firstButton = cancelButtonRef.current;
            const lastButton = confirmButtonRef.current;
            if (!firstButton || !lastButton) return;

            if (event.shiftKey && document.activeElement === firstButton) {
                event.preventDefault();
                lastButton.focus();
            } else if (!event.shiftKey && document.activeElement === lastButton) {
                event.preventDefault();
                firstButton.focus();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [closeLogoutConfirm, isLogoutConfirmOpen]);

    return (
        <>
            <aside className="w-[72px] bg-white border-r border-[var(--color-border)] flex flex-col items-center py-2 shrink-0 z-10">
                <div
                    className="relative w-10 h-10 flex items-center justify-center mb-7"
                    aria-label="Joy POS"
                >
                    <img src="/images/logo/logo.png" alt="Joy POS" className="object-contain" />
                </div>

                <nav className="flex flex-col items-center gap-2 w-full" aria-label="Điều hướng chính">
                    {NAV_ITEMS.filter((item) =>
                        item.href !== "/orders" ||
                        hasPermission(ORDER_HISTORY_READ_PERMISSION, effectiveWarehouseId || undefined)
                    ).map((item) => {
                        const isActive = item.href === "/"
                            ? pathname === "/"
                            : item.href === "/members"
                                ? pathname === "/members"
                                : pathname.startsWith(item.href);
                        const badgeCount = item.href === "/orders" ? pendingPayOSCount : 0;
                        const label = badgeCount > 0
                            ? `${item.label} · ${badgeCount} đơn PayOS chờ xác nhận`
                            : item.label;

                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`relative size-13 flex items-center justify-center rounded-xl transition-colors text-xl ${isActive
                                    ? "text-[var(--color-accent)] bg-orange-50"
                                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                                    }`}
                                aria-label={label}
                                title={label}
                            >
                                {isActive && (
                                    <span className="absolute -left-[9px] w-[3px] h-9 rounded-r-full bg-[var(--color-accent)]" />
                                )}
                                {item.icon}
                                {badgeCount > 0 && (
                                    <span aria-hidden="true" className="absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
                                        {badgeCount > 99 ? "99+" : badgeCount}
                                    </span>
                                )}
                            </Link>
                        );
                    })}
                </nav>

                <div className="mt-auto flex flex-col items-center gap-2">
                    <Link
                        href="/settings"
                        className={`relative w-11 h-11 flex items-center justify-center rounded-xl transition-colors ${pathname.startsWith("/settings")
                            ? "text-[var(--color-accent)] bg-orange-50"
                            : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                            }`}
                        title="Cài đặt"
                        aria-label="Cài đặt"
                    >
                        <IoSettings className="w-5 h-5" />
                        {hasAvailableUpdate && (
                            <span
                                className="absolute right-1.5 top-1.5 size-2.5 rounded-full border-2 border-white bg-red-500"
                                aria-label="Có bản cập nhật JPOS mới"
                            />
                        )}
                    </Link>
                    <button
                        ref={logoutButtonRef}
                        type="button"
                        onClick={openLogoutConfirm}
                        className="w-11 h-11 flex items-center justify-center rounded-xl text-[var(--color-text-muted)] hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Đăng xuất"
                        aria-label="Đăng xuất"
                        aria-haspopup="dialog"
                        aria-expanded={isLogoutConfirmOpen}
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3-3H9.75m9 0-3-3m3 3-3 3" />
                        </svg>
                    </button>
                </div>
            </aside>

            {isLogoutConfirmOpen && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
                    onMouseDown={(event) => event.target === event.currentTarget && closeLogoutConfirm()}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="logout-confirm-title"
                        aria-describedby="logout-confirm-description"
                        className="w-full max-w-sm rounded-3xl border border-white/70 bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.28)]"
                    >
                        <div className="flex size-11 items-center justify-center rounded-2xl bg-red-50 text-red-500" aria-hidden="true">
                            <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3-3H9.75m9 0-3-3m3 3-3 3" />
                            </svg>
                        </div>
                        <h2 id="logout-confirm-title" className="mt-4 text-lg font-extrabold text-[var(--color-text-primary)]">
                            Xác nhận đăng xuất
                        </h2>
                        <p id="logout-confirm-description" className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
                            Bạn có chắc muốn đăng xuất khỏi hệ thống JPOS không?
                        </p>
                        <div className="mt-6 grid grid-cols-2 gap-3">
                            <button
                                ref={cancelButtonRef}
                                type="button"
                                onClick={closeLogoutConfirm}
                                className="min-h-11 rounded-xl border border-[var(--color-border)] bg-white px-4 text-sm font-bold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                            >
                                Hủy
                            </button>
                            <button
                                ref={confirmButtonRef}
                                type="button"
                                onClick={confirmLogout}
                                className="min-h-11 rounded-xl bg-red-500 px-4 text-sm font-bold text-white transition-colors hover:bg-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
                            >
                                Đăng xuất
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
