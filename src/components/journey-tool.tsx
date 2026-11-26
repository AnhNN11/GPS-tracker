"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  Alert,
  Button,
  Empty,
  Modal,
  Select,
  Slider,
  Space,
  Spin,
  Table,
  Tag,
} from "antd";
import type { JourneyResult } from "@/lib/journey";
const Map = dynamic(() => import("./journey-map"), {
  ssr: false,
  loading: () => (
    <div className="map-loading">
      <Spin />
    </div>
  ),
});
const stamp = (time: number | null) =>
  time === null
    ? "—"
    : new Date(time).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
const labels = {
  inside: "Trong vùng",
  outside: "Ngoài vùng",
  uncertain: "GPS chưa rõ",
  unconfigured: "Chưa có ranh giới",
};
export default function JourneyTool({
  open,
  onClose,
  userId,
  name,
  from,
  to,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  name: string;
  from: string;
  to: string;
}) {
  const [deviceId, setDeviceId] = useState(""),
    [data, setData] = useState<JourneyResult | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<number | null>(null),
    [run, setRun] = useState(0);
  useEffect(() => {
    setDeviceId("");
  }, [userId, from, to]);
  useEffect(() => {
    if (!open || !userId) return;
    let active = true,
      timedOut = false;
    const controller = new AbortController(),
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 30000);
    setLoading(true);
    setError("");
    setData(null);
    setSelected(null);
    const query = new URLSearchParams({
      from,
      to,
      userId,
      ...(deviceId ? { deviceId } : {}),
    });
    fetch("/api/history/journey?" + query, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (active && !controller.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (active)
          setError(
            timedOut
              ? "Phân tích quá lâu. Hãy thu hẹp khoảng ngày."
              : e.message,
          );
      })
      .finally(() => {
        clearTimeout(timer);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, userId, from, to, deviceId, run]);
  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={`Phân tích hành trình · ${name}`}
      width={1180}
      footer={null}
    >
      <Alert
        type="info"
        showIcon
        title={`${from} → ${to} · Giờ Việt Nam`}
        description="Đường nối các mẫu GPS đã nhận, không xác nhận đường đi thực tế. Không nối qua đoạn mất dữ liệu trên 130 giây, đổi phiên/ranh giới, sai số lớn hoặc bước nhảy quá 60 m/s. Độ dài nối mẫu chỉ là ước tính."
      />
      <Space wrap style={{ margin: "16px 0" }}>
        <Select
          aria-label="Thiết bị phân tích"
          value={deviceId}
          onChange={setDeviceId}
          style={{ minWidth: 280 }}
          options={[
            { value: "", label: "Tất cả thiết bị (tách đường riêng)" },
            ...(data?.devices ?? []).map((device) => ({
              value: device.id,
              label:
                device.label +
                (device.id === "legacy" ? "" : " · " + device.id.slice(0, 8)),
            })),
          ]}
        />
        <Button loading={loading} onClick={() => setRun((n) => n + 1)}>
          Chạy lại phân tích
        </Button>
      </Space>
      {error && <Alert type="error" title={error} showIcon />}
      {loading ? (
        <div className="loading-panel">
          <Spin />
        </div>
      ) : (
        data && (
          <>
            <div className="history-summary journey-summary">
              {[
                ["Mẫu GPS", data.summary.samples],
                ["Mẫu ở ngoài", data.summary.outsideSamples],
                ["Độ dài nối mẫu", `${data.summary.lineDistanceMeters} m`],
                ["Đoạn ngắt", data.breaks.length],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <strong>{value}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            {!!data.legacySamples && (
              <Alert
                type="warning"
                showIcon
                title={`${data.legacySamples} mẫu cũ chưa có mã thiết bị; không thể khẳng định các mẫu đó cùng một điện thoại.`}
                style={{ margin: "12px 0" }}
              />
            )}
            {data.points.length ? (
              <>
                <Map data={data} selected={selected} />
                <div className="map-legend">
                  <span>
                    <i className="dot green" />
                    Trong vùng
                  </span>
                  <span>
                    <i className="dot red" />
                    Ngoài vùng
                  </span>
                  <span>
                    <i className="dot amber" />
                    Chưa rõ
                  </span>
                  <span>
                    Điểm vàng = mốc đang chọn · Đường xanh dương = các mẫu nối
                    liên tục
                  </span>
                </div>
                <p>
                  Đầu: <strong>{stamp(data.summary.firstAt)}</strong> · Cuối:{" "}
                  <strong>{stamp(data.summary.lastAt)}</strong>
                </p>
                <label>
                  Chọn mốc thời gian{" "}
                  <Slider
                    aria-label="Mốc hành trình"
                    min={0}
                    max={Math.max(0, data.points.length - 1)}
                    value={selected ?? 0}
                    onChange={setSelected}
                    tooltip={{
                      formatter: (index) =>
                        stamp(data.points[index ?? 0]?.capturedAt ?? null),
                    }}
                  />
                </label>
                {selected !== null && data.points[selected] && (
                  <Alert
                    type="info"
                    title={`Mẫu ${selected + 1}: ${stamp(data.points[selected].capturedAt)} · ${data.points[selected].lat.toFixed(6)}, ${data.points[selected].lng.toFixed(6)} · ±${Math.round(data.points[selected].accuracy)} m`}
                  />
                )}
                <Table
                  size="small"
                  rowKey="id"
                  dataSource={data.points}
                  pagination={{ pageSize: 20, showSizeChanger: false }}
                  scroll={{ x: 800 }}
                  columns={[
                    {
                      title: "THỜI ĐIỂM",
                      dataIndex: "capturedAt",
                      render: stamp,
                    },
                    {
                      title: "THIẾT BỊ",
                      render: (_, p) => p.deviceLabel ?? "Chưa có mã thiết bị",
                    },
                    {
                      title: "TỌA ĐỘ",
                      render: (_, p) =>
                        `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`,
                    },
                    {
                      title: "TRẠNG THÁI",
                      render: (_, p) => (
                        <Tag
                          color={
                            p.classification === "outside"
                              ? "red"
                              : p.classification === "inside"
                                ? "green"
                                : "gold"
                          }
                        >
                          {labels[p.classification]}
                        </Tag>
                      ),
                    },
                    {
                      title: "",
                      render: (_, p) => (
                        <Button
                          size="small"
                          onClick={() =>
                            setSelected(
                              data.points.findIndex(
                                (point) => point.id === p.id,
                              ),
                            )
                          }
                        >
                          Xem điểm
                        </Button>
                      ),
                    },
                  ]}
                />
                {!!data.breaks.length && (
                  <details>
                    <summary>{data.breaks.length} đoạn không nối đường</summary>
                    <ul>
                      {data.breaks.slice(0, 50).map((gap, index) => (
                        <li key={index}>
                          {stamp(data.points[gap.from].capturedAt)} →{" "}
                          {stamp(data.points[gap.to].capturedAt)}: {gap.reason}
                        </li>
                      ))}
                    </ul>
                    {data.breaks.length > 50 && (
                      <p>Hiển thị 50 đoạn đầu; thu hẹp ngày để xem chi tiết.</p>
                    )}
                  </details>
                )}
                <p className="muted">
                  Mã thiết bị là mã trình duyệt tự tạo, không phải IMEI hay bằng
                  chứng nhận dạng phần cứng. Đổi trình duyệt hoặc xóa dữ liệu
                  website có thể tạo mã mới. Kết quả không suy ra nơi đã đi qua
                  trong khoảng mất GPS.
                </p>
              </>
            ) : (
              <Empty description="Chưa có mẫu GPS trong khoảng đã chọn" />
            )}
          </>
        )
      )}
    </Modal>
  );
}
