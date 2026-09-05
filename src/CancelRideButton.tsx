import { useState } from "react";
import { cancelRide } from "./services";

export function CancelRideButton({ rideId, onCancelled }: { rideId: string; onCancelled: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!confirm) return <button className="secondary" onClick={() => setConfirm(true)}>라이딩 취소·정리</button>;
  return <section className="notice" aria-label="라이딩 취소 확인">
    <b>이 라이딩을 취소하고 목록에서 정리할까요?</b>
    <p>모든 참여자의 목록에서 사라지고 새 참여가 중단됩니다. 미출발 모집 방은 알림을 켠 참여자에게 취소 알림을 보냅니다. 처리 후 방 생성 한도가 비워집니다.</p>
    {error && <p role="alert" className="form-error">{error}</p>}
    <button className="secondary" disabled={busy} onClick={() => setConfirm(false)}>돌아가기</button>{" "}
    <button className="danger" disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try { await cancelRide(rideId); onCancelled(); }
      catch (e) { setError(e instanceof Error ? e.message : "취소하지 못했습니다. 다시 시도해 주세요."); }
      finally { setBusy(false); }
    }}>{busy ? "정리 중…" : "취소·정리 확인"}</button>
  </section>;
}
