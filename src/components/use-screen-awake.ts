"use client";
import { useEffect, useState } from "react";
export function useScreenAwake(enabled: boolean) {
  const [supported, setSupported] = useState(false),
    [active, setActive] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const available = "wakeLock" in navigator;
    setSupported(available);
    setActive(false);
    setError("");
    if (!enabled || !available) return;
    let disposed = false,
      lock: WakeLockSentinel | null = null,
      requesting = false;
    async function acquire() {
      if (disposed || document.hidden || requesting || (lock && !lock.released))
        return;
      requesting = true;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (disposed) {
          await next.release();
          return;
        }
        lock = next;
        setActive(!next.released);
        setError("");
        next.addEventListener("release", () => {
          if (!disposed) setActive(false);
        });
      } catch {
        if (!disposed) {
          setActive(false);
          setError(
            "Hệ điều hành chưa cho phép giữ màn hình sáng; có thể do chế độ tiết kiệm pin hoặc trang đang ở nền.",
          );
        }
      } finally {
        requesting = false;
      }
    }
    void acquire();
    const onVisible = () => {
      if (!document.hidden) void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (lock && !lock.released) void lock.release().catch(() => {});
    };
  }, [enabled]);
  return { supported, active, error };
}
