import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bike,
  ClipboardList,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  adminModerate,
  getAdminDashboard,
  type AdminDashboardData,
} from "./services";

type View = "overview" | "users" | "rides" | "reports" | "logs";
const text = (value: unknown, fallback = "-") =>
  typeof value === "string" && value ? value : fallback;
const date = (value: unknown) =>
  typeof value === "string"
    ? new Intl.DateTimeFormat("ko-KR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "-";

export default function AdminPanel({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [view, setView] = useState<View>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ action: string; targetId: string; label: string } | null>(null);
  const [reason, setReason] = useState("");
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setData(await getAdminDashboard());
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "관리 데이터를 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const act = (action: string, targetId: string, label: string) => {
    setReason("");
    setPending({ action, targetId, label });
  };
  const execute = async () => {
    if (!pending) return;
    try {
      await adminModerate({ action: pending.action, targetId: pending.targetId, reason });
      setPending(null);
      await load();
    } catch (reasonValue) {
      setError(
        reasonValue instanceof Error
          ? reasonValue.message
          : "관리 작업에 실패했습니다.",
      );
    }
  };
  return (
    <section className="admin-shell">
      <div className="admin-head" role="banner">
        <div>
          <span>
            <ShieldCheck size={15} /> 관리자 전용
          </span>
          <h1>운영 대시보드</h1>
        </div>
        <div>
          <button aria-label="새로고침" onClick={load}>
            <RefreshCw size={18} />
          </button>
          <button onClick={onClose}>앱으로</button>
        </div>
      </div>
      <div className="admin-tabs" role="tablist" aria-label="관리자 메뉴">
        {(
          [
            ["overview", "요약"],
            ["users", "회원"],
            ["rides", "라이딩"],
            ["reports", "신고"],
            ["logs", "감사 로그"],
          ] as [View, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={view === id}
            className={view === id ? "active" : ""}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="admin-error">{error}</p>}
      {loading ? (
        <div className="admin-loading">운영 데이터를 불러오는 중…</div>
      ) : !data ? null : view === "overview" ? (
        <>
          <div className="admin-stats">
            <article>
              <Users />
              <b>{data.stats.users}</b>
              <span>전체 회원</span>
            </article>
            <article>
              <Bike />
              <b>{data.stats.rides}</b>
              <span>전체 라이딩</span>
            </article>
            <article>
              <AlertTriangle />
              <b>{data.stats.openReports}</b>
              <span>미처리 신고</span>
            </article>
            <article>
              <Activity />
              <b>{data.stats.noShows}</b>
              <span>확정 노쇼</span>
            </article>
          </div>
          <section className="admin-section">
            <h2>운영 체크</h2>
            <div className="ops-list">
              <p>
                <b>신고 대기</b>
                <span>
                  {data.stats.openReports
                    ? "처리가 필요한 신고가 있습니다."
                    : "처리 대기 신고가 없습니다."}
                </span>
              </p>
              <p>
                <b>노쇼 정책</b>
                <span>최소 3표·과반 조건으로 서버에서만 확정됩니다.</span>
              </p>
              <p>
                <b>권한 보안</b>
                <span>
                  모든 관리 작업은 관리자 토큰과 감사 로그를 사용합니다.
                </span>
              </p>
            </div>
          </section>
        </>
      ) : view === "users" ? (
        <section className="admin-section">
          <h2>회원 관리</h2>
          <div className="admin-list">
            {data.users.map((user) => (
              <article key={user.id}>
                <div>
                  <b>{text(user.email, "이메일 미등록")}</b>
                  <span>{user.id}</span>
                  <small>
                    상태 {text(user.status, "active")} · 노쇼{" "}
                    {Number(user.noShowCount ?? 0)}회
                  </small>
                </div>
                <div>
                  <button
                    onClick={() =>
                      act(
                        user.status === "suspended"
                          ? "activate_user"
                          : "suspend_user",
                        user.id,
                        user.status === "suspended"
                          ? "회원 활성화"
                          : "회원 정지",
                      )
                    }
                  >
                    {user.status === "suspended" ? "활성화" : "정지"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : view === "rides" ? (
        <section className="admin-section">
          <h2>라이딩·코스 관리</h2>
          <div className="admin-list">
            {data.rides.map((ride) => (
              <article key={ride.id}>
                <div>
                  <b>{text(ride.title)}</b>
                  <span>
                    {text(ride.purpose) === "solo"
                      ? "혼자 라이딩"
                      : "함께 라이딩"}{" "}
                    · {text(ride.status)}
                  </span>
                  <small>
                    {date(ride.startsAt)} · 참여 {Number(ride.memberCount ?? 0)}
                    /{Number(ride.capacity ?? 0)}
                  </small>
                </div>
                <div>
                  <button
                    onClick={() =>
                      act(
                        ride.status === "숨김" ? "restore_ride" : "hide_ride",
                        ride.id,
                        ride.status === "숨김" ? "라이딩 복구" : "라이딩 숨김",
                      )
                    }
                  >
                    {ride.status === "숨김" ? "복구" : "숨김"}
                  </button>
                  <button
                    onClick={() => act("close_ride", ride.id, "모집 마감")}
                  >
                    마감
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : view === "reports" ? (
        <section className="admin-section">
          <h2>신고·분쟁 처리</h2>
          <div className="admin-list">
            {data.reports.map((report) => (
              <article key={report.id}>
                <div>
                  <b>{text(report.type, "일반 신고")}</b>
                  <span>{text(report.reason, "사유 없음")}</span>
                  <small>
                    상태 {text(report.status)} · {date(report.createdAt)}
                  </small>
                </div>
                <div>
                  <button
                    onClick={() =>
                      act("resolve_report", report.id, "신고 승인")
                    }
                  >
                    승인
                  </button>
                  <button
                    onClick={() =>
                      act("dismiss_report", report.id, "신고 기각")
                    }
                  >
                    기각
                  </button>
                </div>
              </article>
            ))}
            {!data.reports.length && (
              <p className="admin-empty">접수된 신고가 없습니다.</p>
            )}
          </div>
        </section>
      ) : (
        <section className="admin-section">
          <h2>
            <ClipboardList size={18} /> 관리자 감사 로그
          </h2>
          <div className="admin-list logs">
            {data.logs.map((log) => (
              <article key={log.id}>
                <div>
                  <b>{text(log.action)}</b>
                  <span>
                    {text(log.targetType)} · {text(log.targetId)}
                  </span>
                  <small>
                    {date(log.createdAt)} · 관리자 {text(log.adminId)}
                  </small>
                </div>
              </article>
            ))}
            {!data.logs.length && (
              <p className="admin-empty">기록된 관리 작업이 없습니다.</p>
            )}
          </div>
        </section>
      )}
      {pending && (
        <div className="modal-backdrop">
          <form
            className="admin-action-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-action-title"
            onSubmit={(event) => {
              event.preventDefault();
              void execute();
            }}
          >
            <h2 id="admin-action-title">{pending.label}</h2>
            <p>이 작업은 즉시 반영되고 관리자 감사 로그에 기록됩니다.</p>
            <label>
              처리 사유
              <textarea
                autoFocus
                required
                value={reason}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                placeholder="처리 근거를 입력하세요"
              />
            </label>
            <div className="inline-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setPending(null)}
              >
                취소
              </button>
              <button className="danger" type="submit">
                확인하고 실행
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
