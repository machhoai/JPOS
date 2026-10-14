import { create } from "zustand";
import type { MemberEditableProfile } from "@/lib/types/memberProfileEdit";
import type { MemberProfileEditInput } from "@/lib/services/memberProfileEditService";

interface MemberProfileEditState {
  scopeKey: string | null;
  draft: MemberEditableProfile | null;
  resolveOperationId: string | null;
  baseRevision: number;
  submitted: MemberProfileEditInput | null;
  historyVisible: boolean;
  saving: boolean;
  uncertain: boolean;
  saved: boolean;
  error: string | null;
  start: (scopeKey: string, draft: MemberEditableProfile, revision: number, resolveOperationId?: string) => void;
  change: (values: Partial<MemberEditableProfile>) => void;
  reset: () => void;
}
const empty = { scopeKey: null, draft: null, baseRevision: 0, resolveOperationId: null, submitted: null, historyVisible: true, saving: false, uncertain: false, saved: false, error: null };
export const useMemberProfileEditStore = create<MemberProfileEditState>(set => ({
  ...empty,
  start: (scopeKey, draft, baseRevision, resolveOperationId) => set({ ...empty, scopeKey, draft: { ...draft }, baseRevision, resolveOperationId: resolveOperationId ?? null }),
  change: values => set(state => state.saving || state.uncertain || !state.draft ? state : { draft: { ...state.draft, ...values }, error: null }),
  reset: () => set(empty),
}));
