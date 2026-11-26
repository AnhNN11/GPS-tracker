"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { captureLocation, gpsErrorMessage } from "@/lib/gps-client";
import type { Reading } from "@/lib/geo";
export type LocationReceipt = {
  reading: Reading;
  status: string;
  receivedAt: number;
};
export function useLocationSharing(
  userId: string | undefined,
  enabled: boolean,
  upload: (reading: Reading) => Promise<LocationReceipt>,
  onSaved: (receipt: LocationReceipt) => void,
) {
  const [phase, setPhase] = useState<
    "idle" | "locating" | "sending" | "saved" | "error"
  >("idle");
  const [error, setError] = useState("");
  const callbacks = useRef({ upload, onSaved });
  callbacks.current = { upload, onSaved };
  const epoch = useRef(0),
    inFlight = useRef<number | null>(null);
  const captureNow = useCallback(async () => {
    const generation = epoch.current;
    if (
      !enabled ||
      !userId ||
      document.hidden ||
      inFlight.current === generation
    )
      return;
    inFlight.current = generation;
    setError("");
    setPhase("locating");
    try {
      if (!navigator.geolocation)
        throw new Error(
          "Trình duyệt không hỗ trợ GPS. Mở trang bằng Chrome hoặc Safari qua HTTPS.",
        );
      if (!navigator.onLine)
        throw new Error("Đang mất mạng. Kết nối lại Internet để gửi GPS.");
      const reading = await captureLocation(navigator.geolocation);
      if (generation !== epoch.current) return;
      setPhase("sending");
      const receipt = await callbacks.current.upload(reading);
      if (generation !== epoch.current) return;
      callbacks.current.onSaved(receipt);
      setPhase("saved");
    } catch (error) {
      if (generation === epoch.current) {
        setError(gpsErrorMessage(error));
        setPhase("error");
      }
    } finally {
      if (inFlight.current === generation) inFlight.current = null;
    }
  }, [enabled, userId]);
  useEffect(() => {
    epoch.current++;
    setPhase("idle");
    setError("");
    if (!enabled || !userId) return;
    void captureNow();
    const timer = setInterval(() => void captureNow(), 60000);
    const resume = () => {
      if (!document.hidden) void captureNow();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      epoch.current++;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [enabled, userId, captureNow]);
  return {
    phase,
    error,
    captureNow,
    loading: phase === "locating" || phase === "sending",
  };
}
