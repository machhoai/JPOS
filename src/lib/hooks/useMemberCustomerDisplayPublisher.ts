"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  listenCustomerDisplayReady,
  publishCustomerDisplayState,
} from "@/lib/services/customerDisplayBridge";
import { useCartStore } from "@/lib/stores/useCartStore";
import type {
  CustomerDisplayMemberSnapshot,
  CustomerDisplayState,
} from "@/lib/types/customerDisplay";
import type {
  MemberMutationStatus,
  MemberProfile,
  MemberRegistrationDraft,
} from "@/lib/types/member";
import {
  createCustomerDisplayOrderSnapshot,
  createIdleCustomerDisplayState,
} from "@/lib/utils/customerDisplayState";
import { showError } from "@/lib/utils/toast";
import type { MemberEditableProfile } from "@/lib/types/memberProfileEdit";

interface MemberDisplayPublisherInput {
  editDraft?: MemberEditableProfile | null;
  editSaved?: boolean;
  enabled: boolean;
  suppressWhenDisabled?: boolean;
  showLookupBalances?: boolean;
  draft: MemberRegistrationDraft;
  mutationStatus: MemberMutationStatus;
  member: MemberProfile | null;
}

function draftBirthDate(draft: MemberRegistrationDraft): string | null {
  if (!draft.birthDay && !draft.birthMonth && !draft.birthYear) return null;
  return `${draft.birthDay || "__"}/${draft.birthMonth || "__"}/${draft.birthYear || "____"}`;
}

function profileBirthDate(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function memberSnapshot(
  draft: MemberRegistrationDraft,
  member: MemberProfile | null,
  showLookupBalances: boolean,
): CustomerDisplayMemberSnapshot {
  return {
    fullName: member?.fullName || draft.fullName,
    phone: member?.phone || draft.phone,
    gender: member?.gender || draft.gender,
    birthDate: member ? profileBirthDate(member.birthDate) : draftBirthDate(draft),
    email: member?.email || draft.email || null,
    memberCode: member?.memberCode || null,
    balances: showLookupBalances && member
      ? {
          integral: member.balances.integral,
          bonus: member.balances.bonus,
          principalVnd: member.balances.principalVnd,
          turns: member.balances.turns,
        }
      : null,
  };
}

export function useMemberCustomerDisplayPublisher({
  editDraft = null,
  editSaved = false,
  enabled,
  suppressWhenDisabled = false,
  showLookupBalances = false,
  draft,
  mutationStatus,
  member,
}: MemberDisplayPublisherInput): void {
  const items = useCartStore((state) => state.items);
  const paymentMethod = useCartStore((state) => state.paymentMethod);
  const orderMember = useCartStore((state) => state.member);
  const order = useMemo(
    () => createCustomerDisplayOrderSnapshot(items, paymentMethod, orderMember),
    [items, orderMember, paymentMethod],
  );
  const defaultState = useMemo<CustomerDisplayState>(
    () => order
      ? { mode: "CART", connectionStatus: "CONNECTED", order, payment: { status: "NOT_STARTED", qr: null } }
      : createIdleCustomerDisplayState("CONNECTED"),
    [order],
  );
  const displayState = useMemo<CustomerDisplayState>(() => {
    if (!enabled) return defaultState;
    if (editDraft || editSaved) {
      return {
        mode: editDraft ? "MEMBER_REVIEW" : "MEMBER_SUCCESS", memberAction: "EDIT",
        connectionStatus: "CONNECTED",
        member: editDraft ? {
          fullName: editDraft.fullName, phone: editDraft.phone, gender: editDraft.gender,
          birthDate: profileBirthDate(editDraft.birthDate), email: editDraft.email,
          memberCode: member?.memberCode ?? null, balances: null,
        } : memberSnapshot(draft, member, false),
        order, payment: { status: "NOT_STARTED", qr: null },
      };
    }
    return {
      mode: !showLookupBalances && mutationStatus === "SUCCEEDED" && member
        ? "MEMBER_SUCCESS"
        : "MEMBER_REVIEW",
      connectionStatus: "CONNECTED",
      member: memberSnapshot(draft, member, showLookupBalances),
      order,
      payment: { status: "NOT_STARTED", qr: null },
    };
  }, [defaultState, draft, enabled, member, mutationStatus, order, showLookupBalances, editDraft, editSaved]);
  const latestStateRef = useRef(displayState);

  useEffect(() => {
    if (!enabled && suppressWhenDisabled) return;
    latestStateRef.current = displayState;
    void publishCustomerDisplayState(displayState).catch((error: unknown) => {
      console.error("[Thành viên] Không thể gửi dữ liệu sang màn hình khách:", error);
      showError("Không thể cập nhật màn hình khách", "Vui lòng kiểm tra kết nối màn hình phụ.");
    });
  }, [displayState, enabled, suppressWhenDisabled]);

  useEffect(() => {
    if (!enabled && suppressWhenDisabled) return;
    let disposed = false;
    let stopListening: (() => void) | null = null;
    void listenCustomerDisplayReady(() => {
      void publishCustomerDisplayState(latestStateRef.current);
    }).then((stop) => {
      if (disposed) stop();
      else stopListening = stop;
    });
    return () => {
      disposed = true;
      stopListening?.();
    };
  }, [enabled, suppressWhenDisabled]);
}
