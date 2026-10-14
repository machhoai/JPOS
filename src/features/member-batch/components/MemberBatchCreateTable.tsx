import {CheckCircle2} from 'lucide-react';
import {formatDateTime} from '@/lib/utils/dateFormat';
import {safeStageLabel,stageTone} from '../helpers/memberBatchPresentation';
import type {MemberBatchJob} from '../types/memberBatch';
export default function MemberBatchCreateTable({job}:{job:MemberBatchJob|null}){return (<>{job ? (
                  <section className="overflow-hidden rounded-3xl border border-[var(--color-border)] bg-white shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
                      <div>
                        <h2 className="font-extrabold">Tiến độ từng thành viên</h2>
                        <p className="mt-1 text-xs font-semibold text-slate-500">Tiến độ được lưu trên máy POS này và tự khôi phục khi quay lại route.</p>
                      </div>
                      {job.status === "COMPLETED" ? <CheckCircle2 className="size-7 text-emerald-600" /> : null}
                    </div>
                    <div className="max-h-[430px] overflow-auto">
                      <table className="w-full min-w-[920px] border-collapse text-left text-sm">
                        <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                          <tr><th className="px-4 py-3">Dòng</th><th className="px-4 py-3">Thành viên</th><th className="px-4 py-3">Điện thoại</th><th className="px-4 py-3">Điểm</th><th className="px-4 py-3">Mã thẻ</th><th className="px-4 py-3">Trạng thái</th><th className="px-4 py-3">Chi tiết</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {job.items.map((item, index) => (
                            <tr key={item.id} className={index === job.currentIndex && job.status !== "COMPLETED" ? "bg-orange-50/50" : ""}>
                              <td className="px-4 py-3 font-mono font-bold">{item.rowNumber}</td>
                              <td className="px-4 py-3 font-bold text-slate-900">{item.fullName}</td>
                              <td className="px-4 py-3 font-mono text-slate-600">{item.phone}</td>
                              <td className="px-4 py-3 font-bold text-sky-700">{item.points.toLocaleString("vi-VN")}</td>
                              <td className="px-4 py-3 font-mono font-bold text-slate-700">{item.memberCode || "—"}</td>
                              <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${stageTone(item.safeStage)}`}>{safeStageLabel(item.safeStage)}</span></td>
                              <td className="max-w-sm px-4 py-3 text-xs font-semibold text-slate-500">{item.errorMessage || (item.completedAt ? `Xong lúc ${formatDateTime(item.completedAt)}` : "")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ) : null}</>);}
