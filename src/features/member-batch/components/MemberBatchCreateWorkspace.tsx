"use client";
import {LoaderCircle} from 'lucide-react';
import {useMemberBatchWorkspaceController} from '../hooks/useMemberBatchWorkspaceController';
import MemberBatchCreatePanels from './MemberBatchCreatePanels';
import MemberBatchCreateTable from './MemberBatchCreateTable';
export default function MemberBatchCreateWorkspace(){const controller=useMemberBatchWorkspaceController();return <div className="space-y-4">{!controller.hasHydrated?<div className="flex min-h-40 items-center justify-center gap-2"><LoaderCircle className="size-6 animate-spin"/>Đang khôi phục tiến độ...</div>:<><MemberBatchCreatePanels controller={controller}/><MemberBatchCreateTable job={controller.job}/></>}</div>; }
