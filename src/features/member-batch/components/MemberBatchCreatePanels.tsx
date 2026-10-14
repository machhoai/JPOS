import {AlertTriangle,CirclePause,CirclePlay,Download,FileSpreadsheet,LoaderCircle,Radio,RefreshCw,ShoppingCart,SkipForward,Trash2,Upload} from 'lucide-react';
import {downloadMemberBatchTemplate} from '../helpers/memberBatchImport';
import {downloadResult} from '../helpers/memberBatchPresentation';
import type {useMemberBatchWorkspaceController} from '../hooks/useMemberBatchWorkspaceController';
interface Props {controller:ReturnType<typeof useMemberBatchWorkspaceController>}
export default function MemberBatchCreatePanels({controller}:Props){
const {job,current,stats,phaseMessage,warehouseMismatch,hasPointRows,canCompensate,isImporting,importErrors,fileInputRef,handleFile,handleStart,handlePauseAndSell,handleSkip,handleClear,retryCurrent,goToSales}=controller;
return (                <section className="grid gap-4 lg:grid-cols-[minmax(320px,0.75fr)_minmax(480px,1.25fr)]">
                  <div className="rounded-3xl border border-[var(--color-border)] bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.14em] text-orange-600">Bước 1</p>
                        <h2 className="mt-1 text-lg font-extrabold">Nhập danh sách Excel</h2>
                      </div>
                      <FileSpreadsheet className="size-7 text-emerald-600" />
                    </div>
                    <p className="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">
                      Hỗ trợ .xlsx và .csv. Bắt buộc có Họ và tên, Số điện thoại, Giới tính và Số điểm cần nạp. Ngày sinh và Email có thể để trống.
                    </p>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isImporting || job?.status === "RUNNING" || job?.status === "PAUSE_REQUESTED"}
                        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--color-accent)] px-4 text-sm font-extrabold text-white disabled:opacity-50"
                      >
                        {isImporting ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}
                        {isImporting ? "Đang đọc file..." : "Chọn file Excel"}
                      </button>
                      <button
                        type="button"
                        onClick={downloadMemberBatchTemplate}
                        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-[var(--color-border)] px-4 text-sm font-bold text-[var(--color-text-secondary)]"
                      >
                        <Download className="size-4" /> Tải file mẫu
                      </button>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void handleFile(file);
                      }}
                    />
                    {importErrors.length > 0 ? (
                      <div className="mt-4 max-h-44 space-y-2 overflow-y-auto rounded-2xl border border-red-200 bg-red-50 p-3">
                        {importErrors.map((error, index) => (
                          <p key={`${error.rowNumber}-${index}`} className="text-sm font-semibold text-red-700">
                            {error.rowNumber ? `Dòng ${error.rowNumber}: ` : ""}{error.message}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-3xl border border-[var(--color-border)] bg-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.14em] text-orange-600">Bước 2</p>
                        <h2 className="mt-1 text-lg font-extrabold">Đọc và xử lý lần lượt</h2>
                      </div>
                      {job ? <p className="font-mono text-xs font-bold text-slate-500">{job.fileName}</p> : null}
                    </div>

                    {!job ? (
                      <div className="mt-4 flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--color-border-subtle)] bg-slate-50 p-6 text-center">
                        <FileSpreadsheet className="size-10 text-slate-300" />
                        <p className="mt-3 font-extrabold text-slate-700">Chưa có danh sách</p>
                        <p className="mt-1 text-sm text-slate-500">Nhập file để kiểm tra dữ liệu trước khi bật đầu đọc.</p>
                      </div>
                    ) : (
                      <div className="mt-4 space-y-4">
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <div className="rounded-2xl bg-slate-50 p-3"><p className="text-2xl font-black">{job.items.length}</p><p className="text-xs font-bold text-slate-500">Tổng dòng</p></div>
                          <div className="rounded-2xl bg-emerald-50 p-3"><p className="text-2xl font-black text-emerald-700">{stats.completed}</p><p className="text-xs font-bold text-emerald-600">Hoàn thành</p></div>
                          <div className="rounded-2xl bg-red-50 p-3"><p className="text-2xl font-black text-red-700">{stats.failed}</p><p className="text-xs font-bold text-red-600">Có lỗi</p></div>
                          <div className="rounded-2xl bg-sky-50 p-3"><p className="text-2xl font-black text-sky-700">{stats.points.toLocaleString("vi-VN")}</p><p className="text-xs font-bold text-sky-600">Tổng điểm</p></div>
                        </div>
                        <progress aria-label="Tiến độ cấp thẻ" max={job.items.length || 1} value={stats.completed + stats.skipped} className="h-2.5 w-full overflow-hidden rounded-full accent-emerald-500" />

                        {warehouseMismatch ? (
                          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
                            Lô này thuộc điểm bán {job.warehouseName}. Hãy chuyển về đúng điểm bán trước khi tiếp tục.
                          </div>
                        ) : null}
                        {hasPointRows && !canCompensate ? (
                          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
                            Tài khoản hiện tại chưa có quyền nạp điểm. Có thể kiểm tra file nhưng không thể bắt đầu lô có điểm.
                          </div>
                        ) : null}

                        {current && job.status !== "COMPLETED" ? (
                          <div className={`rounded-3xl border p-5 ${current.errorMessage ? "border-red-200 bg-red-50" : "border-orange-200 bg-orange-50"}`}>
                            <div className="flex items-start gap-4">
                              <span className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ${current.errorMessage ? "bg-red-100 text-red-600" : "bg-white text-orange-600"}`}>
                                {current.errorMessage ? <AlertTriangle className="size-6" /> : <Radio className={`size-6 ${job.status === "RUNNING" ? "animate-pulse" : ""}`} />}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Dòng {current.rowNumber} · {job.currentIndex + 1}/{job.items.length}</p>
                                <h3 className="mt-1 text-xl font-black text-slate-950">{current.fullName}</h3>
                                <p className="mt-1 font-mono text-sm font-bold text-slate-600">{current.phone} · {current.points.toLocaleString("vi-VN")} điểm</p>
                                <div className="mt-4 rounded-2xl bg-white/80 p-4">
                                  <p className="font-black text-slate-900">{current.errorMessage || phaseMessage.title}</p>
                                  <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">
                                    {current.errorMessage
                                      ? current.safeStage === "CARD_ATTACHED"
                                        ? "Thẻ đã gắn an toàn. Bấm thử lại để tiếp tục nạp điểm."
                                        : "Bấm thử lại và đọc lại đúng thẻ. JPOS không giữ dữ liệu thẻ tạm sau lỗi hoặc tạm dừng."
                                      : phaseMessage.description}
                                  </p>
                                  {current.memberCode ? <p className="mt-2 font-mono text-sm font-black text-emerald-700">Thẻ: {current.memberCode}</p> : null}
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : null}

                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                          {["READY", "PAUSED"].includes(job.status) ? (
                            <button type="button" onClick={handleStart} disabled={warehouseMismatch || (hasPointRows && !canCompensate)} className="inline-flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-sm font-extrabold text-white disabled:opacity-40">
                              <CirclePlay className="size-5" /> {job.status === "READY" ? "Bắt đầu lô" : "Tiếp tục tại dòng đang dừng"}
                            </button>
                          ) : null}
                          {job.status === "NEEDS_ATTENTION" ? (
                            <button type="button" onClick={retryCurrent} className="inline-flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-orange-600 px-4 text-sm font-extrabold text-white">
                              <RefreshCw className="size-5" /> Thử lại dòng này
                            </button>
                          ) : null}
                          {["RUNNING", "PAUSE_REQUESTED", "NEEDS_ATTENTION"].includes(job.status) ? (
                            <button type="button" onClick={handlePauseAndSell} disabled={job.status === "PAUSE_REQUESTED"} className="inline-flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 text-sm font-extrabold text-white disabled:opacity-60">
                              {job.status === "PAUSE_REQUESTED" ? <LoaderCircle className="size-5 animate-spin" /> : <CirclePause className="size-5" />}
                              {job.status === "PAUSE_REQUESTED" ? "Đang dừng an toàn..." : "Tạm dừng & bán hàng"}
                            </button>
                          ) : null}
                          {job.status === "PAUSED" ? (
                            <button type="button" onClick={goToSales} className="inline-flex min-h-13 items-center justify-center gap-2 rounded-2xl border border-[var(--color-border)] bg-white px-4 text-sm font-bold text-slate-700">
                              <ShoppingCart className="size-5" /> Về bán hàng
                            </button>
                          ) : null}
                          {job.status === "NEEDS_ATTENTION" ? (
                            <button type="button" onClick={handleSkip} className="inline-flex min-h-13 items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700">
                              <SkipForward className="size-5" /> Bỏ qua dòng
                            </button>
                          ) : null}
                          {job.status === "COMPLETED" ? (
                            <button type="button" onClick={() => downloadResult(job.items, job.fileName)} className="inline-flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-sm font-extrabold text-white">
                              <Download className="size-5" /> Xuất kết quả
                            </button>
                          ) : null}
                          {!job || !["RUNNING", "PAUSE_REQUESTED"].includes(job.status) ? (
                            <button type="button" onClick={handleClear} className="inline-flex min-h-13 items-center justify-center gap-2 rounded-2xl border border-red-200 bg-white px-4 text-sm font-bold text-red-700">
                              <Trash2 className="size-5" /> Xóa lô
                            </button>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>
                </section>);
}
