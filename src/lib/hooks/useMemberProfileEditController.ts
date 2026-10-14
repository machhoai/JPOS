"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMemberProfileEditStore } from "@/lib/stores/useMemberProfileEditStore";
import { useMemberStore } from "@/lib/stores/useMemberStore";
import { useCartStore } from "@/lib/stores/useCartStore";
import { fetchMemberProfileHistory, updateMemberProfile, updateMemberProfileSyncRetry, validateMemberProfileDraft } from "@/lib/services/memberProfileEditService";
import { showError, showPromise } from "@/lib/utils/toast";
import type { MemberProfileChange } from "@/lib/types/memberProfileEdit";
import type { MemberProfile } from "@/lib/types/member";

function profileDraft(member: MemberProfile) {
  return { fullName: member.fullName, phone: member.phone, nickName: member.nickName || member.fullName,
    gender: member.gender, birthDate: member.birthDate, email: member.email };
}
export function useMemberProfileEditController(member: MemberProfile | null, shopId: number, warehouseId: string | null, enabled: boolean, canReadHistory = true) {
  const state = useMemberProfileEditStore();
  const [historyScope, setHistoryScope] = useState<string | null>(null);
  const [changes, setChanges] = useState<MemberProfileChange[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const scopeKey = enabled && member && warehouseId ? `${warehouseId}:${shopId}:${member.uid}` : null;
  const scopeRef = useRef(scopeKey);
  useEffect(() => { scopeRef.current = scopeKey; }, [scopeKey]);
  const memberRef = useRef(member);
  useEffect(() => { memberRef.current = member; }, [member]);
  const requestSequence = useRef(0);
  const scope = member && warehouseId ? { uid: member.uid, shopId, warehouseId } : null;
  const editing = scopeKey !== null && state.scopeKey === scopeKey && state.draft !== null;
  useEffect(() => {
    if (!editing) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const beforeNavigate = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!anchor) return;
      const current = useMemberProfileEditStore.getState();
      if (current.saving || current.uncertain || !window.confirm("Bỏ các thay đổi chưa lưu và rời trang?")) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", beforeNavigate, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", beforeNavigate, true); };
  }, [editing]);
  const saved = scopeKey !== null && state.scopeKey === scopeKey && state.saved;
  useEffect(() => {
    useMemberProfileEditStore.getState().reset();
    return () => { useMemberProfileEditStore.getState().reset(); };
  }, [scopeKey]);
  const applyProfile = useCallback((profile: Partial<MemberProfile>) => {
    const current = useMemberStore.getState().currentMember;
    if (!current || current.uid !== memberRef.current?.uid || (profile.profileRevision ?? 0) < (current.profileRevision ?? 0)) return;
    const { fullName, phone, nickName, gender, birthDate, email, profileRevision, remoteConfirmedRevision, syncStatus } = profile;
    const next = { ...current, fullName: fullName ?? current.fullName, phone: phone ?? current.phone, nickName: nickName ?? current.nickName,
      gender: gender ?? current.gender, birthDate: birthDate === undefined ? current.birthDate : birthDate,
      email: email === undefined ? current.email : email, profileRevision, remoteConfirmedRevision, syncStatus };
    useMemberStore.getState().completeLookup(next);
    const cart = useCartStore.getState();
    if (cart.member?.uid === current.uid && !cart.isPaymentLocked) cart.setMember(next);
  }, []);
  const loadHistory = useCallback(async (more = false) => {
    const currentMember = memberRef.current;
    if (!scopeKey || !currentMember || !warehouseId) return;
    const sequence = ++requestSequence.current;
    setLoadingHistory(true);
    try {
      const result = await fetchMemberProfileHistory({ uid: currentMember.uid, shopId, warehouseId }, more ? nextCursor ?? undefined : undefined, !canReadHistory);
      if (scopeRef.current !== scopeKey || sequence !== requestSequence.current) return;
      setHistoryScope(scopeKey);
      setChanges(previous => more ? [...previous, ...result.changes] : result.changes);
      setNextCursor(result.nextCursor); setHistoryError(null);
      applyProfile(result.profile);
    } catch (error: unknown) {
      console.error("[Hồ sơ] Không thể tải lịch sử chỉnh sửa.");
      if (scopeRef.current === scopeKey && sequence === requestSequence.current) setHistoryError(error instanceof Error ? error.message : "Không thể tải lịch sử.");
    } finally { if (scopeRef.current === scopeKey && sequence === requestSequence.current) setLoadingHistory(false); }
  }, [applyProfile, nextCursor, scopeKey, shopId, warehouseId, canReadHistory]);
  const loadHistoryRef = useRef(loadHistory);
  useEffect(() => { loadHistoryRef.current = loadHistory; }, [loadHistory]);
  useEffect(() => {
    if (!scopeKey || !state.historyVisible) return;
    void loadHistoryRef.current();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadHistoryRef.current(); }, 15000);
    return () => window.clearInterval(timer);
  }, [scopeKey, state.historyVisible]);
  const start = (resolveOperationId?: string) => {
    if (!scopeKey || !member || useCartStore.getState().isPaymentLocked) return;
    state.start(scopeKey, profileDraft(member), member.profileRevision ?? 0, resolveOperationId);
  };
  const cancel = () => {
    if (state.saving || state.uncertain) return false;
    if (state.draft && member && JSON.stringify(state.draft) !== JSON.stringify(profileDraft(member)) && !window.confirm("Bỏ các thay đổi chưa lưu?")) return false;
    state.reset();
    return true;
  };
  const save = async () => {
    const currentEdit = useMemberProfileEditStore.getState();
    if (!scope || !scopeKey || scopeRef.current !== scopeKey || !currentEdit.draft || currentEdit.saving || useCartStore.getState().isPaymentLocked) return;
    let requestStarted = false;
    try {
      const snapshot = currentEdit.submitted ?? { ...scope, ...(currentEdit.resolveOperationId ? { resolveOperationId: currentEdit.resolveOperationId } : {}), ...validateMemberProfileDraft(currentEdit.draft), baseRevision: currentEdit.baseRevision, operationId: crypto.randomUUID() };
      const activeKey = scopeKey;
      useMemberProfileEditStore.setState({ submitted: snapshot, saving: true, error: null });
      requestStarted = true;
      const result = await showPromise(updateMemberProfile(snapshot), {
        loading: "Đang lưu thông tin…", success: "Đã lưu thông tin", error: "Chưa thể lưu thông tin",
        successDescription: "Thông tin đã lưu tại POS. HK được đồng bộ ở nền.", errorDescription: "Vui lòng kiểm tra kết quả hoặc thử lại với cùng mã thao tác.",
        onRetry: () => { void save(); },
      });
      if (scopeRef.current !== activeKey || useMemberProfileEditStore.getState().submitted?.operationId !== snapshot.operationId) return;
      applyProfile(result.profile);
      if (useMemberStore.getState().lookupMode === "PHONE") useMemberStore.getState().setLookupQuery(result.profile.phone);
      useMemberProfileEditStore.setState({ draft: null, submitted: null, saving: false, uncertain: false, saved: true, error: null });
      void loadHistory();
    } catch (error: unknown) {
      console.error("[Hồ sơ] Lưu thông tin chưa hoàn tất.");
      if (scopeRef.current !== scopeKey) return;
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      const definitive = ["invalid-argument", "permission-denied", "failed-precondition", "already-exists", "aborted"].some(value => code.includes(value));
      const message = error instanceof Error ? error.message : "Không thể lưu thông tin.";
      useMemberProfileEditStore.setState({ saving: false, uncertain: !definitive && !!useMemberProfileEditStore.getState().submitted,
        ...(definitive ? { submitted: null } : {}), error: message });
      if (!requestStarted) showError("Chưa thể lưu thông tin", message);
    }
  };
  const reloadEditor = async () => {
    if (!scope || !scopeKey || state.saving || state.uncertain || !window.confirm("Tải bản đã lưu và bỏ những thông tin đang nhập?")) return;
    try {
      const result = await fetchMemberProfileHistory(scope, undefined, !canReadHistory);
      if (scopeRef.current !== scopeKey || !memberRef.current) return;
      applyProfile(result.profile);
      state.start(scopeKey, profileDraft({ ...memberRef.current, ...result.profile }), result.profile.profileRevision ?? 0);
    } catch (error: unknown) { console.error("[Hồ sơ] Không thể tải bản đã lưu."); showError("Không thể tải hồ sơ", error instanceof Error ? error.message : "Vui lòng thử lại."); }
  };
  const retry = async (operationId: string) => {
    if (!scope) return;
    try {
      await showPromise(updateMemberProfileSyncRetry(scope, operationId), { loading: "Đang xếp lại đồng bộ…", success: "Đã yêu cầu đồng bộ lại", error: "Không thể đồng bộ lại", successDescription: "Tác vụ sẽ được xử lý ở nền.", errorDescription: "Vui lòng thử lại.", onRetry: () => { void retry(operationId); } });
      await loadHistory();
    } catch { console.error("[Hồ sơ] Không thể yêu cầu đồng bộ lại."); }
  };
  let validationError: string | null = null;
  if (editing && state.draft) { try { validateMemberProfileDraft(state.draft); } catch (error) { validationError = error instanceof Error ? error.message : "Dữ liệu không hợp lệ."; } }
  if (editing && state.draft && member && ((member.email && !state.draft.email) || (member.birthDate && !state.draft.birthDate))) validationError = "Chưa hỗ trợ xóa email hoặc ngày sinh đã có trên HK.";
  const unchanged = editing && member && JSON.stringify(state.draft) === JSON.stringify(profileDraft(member));
  return { editing, saved, draft: editing ? state.draft : null, saving: state.saving, uncertain: state.uncertain,
    error: state.error, validationError, canSave: !state.saving && (!validationError || state.uncertain) && (!unchanged || state.uncertain || !!state.resolveOperationId || (member?.profileRevision === 0 && member.syncStatus === "NEEDS_ACTION")),
    changes: historyScope === scopeKey ? changes : [], nextCursor: historyScope === scopeKey ? nextCursor : null, historyError: historyScope === scopeKey ? historyError : null, loadingHistory, start, cancel, save, retry, reloadEditor, loadHistory, setHistoryVisible: (historyVisible: boolean) => useMemberProfileEditStore.setState({ historyVisible }), change: state.change };
}
