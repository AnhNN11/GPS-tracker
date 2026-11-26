"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Alert,
  App,
  Button,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  DownloadOutlined,
  ReloadOutlined,
  EnvironmentOutlined,
} from "@ant-design/icons";
import type { Person } from "@/lib/types";
import type { LocationSample, Excursion, Campus } from "@/lib/models";
const HistoryMap = dynamic(() => import("./history-map"), {
  ssr: false,
  loading: () => (
    <div className="map-loading">
      <Spin />
    </div>
  ),
});
type EventRow = Excursion & { user_name: string };
type SampleRow = LocationSample & { user_name: string };
type Result = {
  rows: (EventRow | SampleRow)[];
  total: number;
  summary: {
    samples: number;
    outsideSamples: number;
    uncertainSamples: number;
    people: number;
    events: number;
  };
};
type Detail = {
  event: EventRow;
  points: LocationSample[];
  boundary: Campus | null;
  truncated: boolean;
};
const localDay = (time = Date.now()) =>
  new Date(time + 7 * 3600000).toISOString().slice(0, 10);
const timestamp = (time: number | null) =>
  time
    ? new Date(time).toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";
const endLabels = {
  returned: "Có mẫu xác nhận quay lại",
  data_gap: "Mất dữ liệu / chưa xác nhận quay lại",
  sharing_stopped: "Đã dừng chia sẻ",
  account_disabled: "Tài khoản đã khóa",
  boundary_changed: "Đã đổi ranh giới",
};
const sampleLabels = {
  inside: "Trong khuôn viên",
  outside: "Ngoài khuôn viên",
  uncertain: "GPS chưa rõ",
  unconfigured: "Chưa có ranh giới",
};
function EndTag({ event }: { event: EventRow }) {
  return (
    <Tag
      color={
        event.endReason === "returned" ? "green" : event.active ? "red" : "gold"
      }
      bordered={false}
    >
      {event.active
        ? "Chưa có mẫu quay lại"
        : event.endReason
          ? endLabels[event.endReason]
          : "Chưa xác định"}
    </Tag>
  );
}
function span(event: EventRow) {
  const seconds = Math.max(
    0,
    Math.round((event.lastOutsideAt - event.startedAt) / 1000),
  );
  return seconds < 60
    ? seconds + " giây"
    : Math.floor(seconds / 60) + " phút " + (seconds % 60) + " giây";
}
export default function HistoryPanel({
  me,
  people,
  revision = 0,
}: {
  me: Person;
  people: Person[];
  revision?: number;
}) {
  const { message } = App.useApp();
  const [from, setFrom] = useState(() => localDay(Date.now() - 6 * 86400000)),
    [to, setTo] = useState(() => localDay()),
    [userId, setUserId] = useState(""),
    [view, setView] = useState<"events" | "samples">("samples"),
    [classification, setClassification] = useState(""),
    [page, setPage] = useState(1),
    [reload, setReload] = useState(0),
    [data, setData] = useState<Result | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [exporting, setExporting] = useState(false),
    [detail, setDetail] = useState<Detail | null>(null),
    [detailOpen, setDetailOpen] = useState(false),
    [detailLoading, setDetailLoading] = useState(false);
  const detailRequest = useRef(0);
  const params = new URLSearchParams({
    from,
    to,
    view,
    page: String(page),
    pageSize: "50",
    ...(userId ? { userId } : {}),
    ...(view === "samples" && classification ? { classification } : {}),
  }).toString();
  useEffect(() => {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 30000);
    setLoading(true);
    setData(null);
    setError("");
    fetch("/api/history?" + params, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (!controller.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (timedOut) setError("Tải lịch sử quá lâu. Hãy thử lại.");
        else if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        clearTimeout(timer);
        if (!controller.signal.aborted || timedOut) setLoading(false);
      });
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [params, reload, revision]);
  async function exportCsv() {
    setExporting(true);
    try {
      const response = await fetch("/api/history?" + params + "&format=csv", {
        signal: AbortSignal.timeout(30000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error((await response.json()).error);
      const url = URL.createObjectURL(await response.blob()),
        link = document.createElement("a");
      link.href = url;
      link.download = "gps-" + view + "-" + from + "-" + to + ".csv";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  async function showEvent(id: string) {
    const sequence = ++detailRequest.current;
    setDetail(null);
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const response = await fetch(
          "/api/history/events/" + encodeURIComponent(id),
          { cache: "no-store", signal: AbortSignal.timeout(30000) },
        ),
        result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (sequence === detailRequest.current) setDetail(result);
    } catch (e) {
      if (sequence === detailRequest.current) {
        setDetailOpen(false);
        message.error((e as Error).message);
      }
    } finally {
      if (sequence === detailRequest.current) setDetailLoading(false);
    }
  }
  const events: ColumnsType<EventRow> = [
    { title: "NGƯỜI DÙNG", dataIndex: "user_name", width: 160 },
    {
      title: "MẪU NGOÀI ĐẦU TIÊN",
      dataIndex: "startedAt",
      render: timestamp,
      width: 180,
    },
    {
      title: "MẪU NGOÀI CUỐI",
      dataIndex: "lastOutsideAt",
      render: timestamp,
      width: 180,
    },
    {
      title: "MẪU QUAY LẠI",
      dataIndex: "returnedAt",
      render: timestamp,
      width: 180,
    },
    {
      title: "KHOẢNG QUAN SÁT",
      render: (_, event) => (
        <span title="Khoảng giữa các mẫu ở ngoài đã nhận; không phải thời gian vượt hàng rào chính xác.">
          {span(event)}
        </span>
      ),
      width: 150,
    },
    {
      title: "TRẠNG THÁI",
      render: (_, event) => <EndTag event={event} />,
      width: 260,
    },
    {
      title: "",
      render: (_, event) => (
        <Button
          size="small"
          icon={<EnvironmentOutlined />}
          onClick={() => showEvent(event.id)}
        >
          Xem hành trình
        </Button>
      ),
      width: 150,
    },
  ];
  const samples: ColumnsType<SampleRow> = [
    { title: "NGƯỜI DÙNG", dataIndex: "user_name", width: 160 },
    {
      title: "THỜI ĐIỂM GPS",
      dataIndex: "capturedAt",
      render: timestamp,
      width: 180,
    },
    {
      title: "TỌA ĐỘ",
      render: (_, p) => (
        <span>
          {p.lat.toFixed(6)}, {p.lng.toFixed(6)}
        </span>
      ),
      width: 190,
    },
    {
      title: "SAI SỐ",
      dataIndex: "accuracy",
      render: (n) => "±" + Math.round(n) + " m",
      width: 90,
    },
    {
      title: "PHÂN LOẠI",
      dataIndex: "classification",
      render: (value: LocationSample["classification"]) => (
        <Tag
          bordered={false}
          color={
            value === "outside" ? "red" : value === "inside" ? "green" : "gold"
          }
        >
          {sampleLabels[value]}
        </Tag>
      ),
      width: 150,
    },
    {
      title: "XÁC NHẬN",
      dataIndex: "status",
      render: (status) =>
        status === "pending"
          ? "Đang chờ thêm mẫu"
          : status === "outside"
            ? "Đã đủ mẫu ngoài"
            : "—",
      width: 160,
    },
    {
      title: "CÁCH RANH GIỚI",
      dataIndex: "edgeDistanceMeters",
      render: (n) => (n === null ? "—" : Math.round(n) + " m"),
      width: 140,
    },
  ];
  return (
    <>
      <Alert
        showIcon
        type="info"
        title="Lưu để phân tích sau"
        description="Dữ liệu là các mẫu GPS đã nhận. Điểm gần hàng rào có thể chưa rõ do sai số; mất dữ liệu hoặc dừng chia sẻ không được tính là đã quay lại trường. Lịch sử bắt đầu được lưu từ bản cập nhật này."
        style={{ marginBottom: 20 }}
      />
      <section className="panel">
        <div className="history-filters">
          <label>
            Từ ngày
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            Đến ngày
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </label>
          {me.role === "admin" && (
            <label>
              Người dùng
              <Select
                aria-label="Lọc người dùng"
                value={userId}
                onChange={(value) => {
                  setUserId(value);
                  setPage(1);
                }}
                options={[
                  { value: "", label: "Tất cả người dùng" },
                  ...people.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            </label>
          )}
          <label>
            Loại dữ liệu
            <Select
              aria-label="Loại lịch sử"
              value={view}
              onChange={(value) => {
                setView(value);
                setPage(1);
              }}
              options={[
                { value: "events", label: "Lượt ngoài khuôn viên" },
                { value: "samples", label: "Tất cả mẫu vị trí" },
              ]}
            />
          </label>
          {view === "samples" && (
            <label>
              Phân loại
              <Select
                aria-label="Lọc phân loại GPS"
                value={classification}
                onChange={(value) => {
                  setClassification(value);
                  setPage(1);
                }}
                options={[
                  { value: "", label: "Tất cả mẫu" },
                  { value: "outside", label: "Ngoài khuôn viên" },
                  { value: "inside", label: "Trong khuôn viên" },
                  { value: "uncertain", label: "GPS chưa rõ" },
                  { value: "unconfigured", label: "Chưa có ranh giới" },
                ]}
              />
            </label>
          )}
          <Space wrap>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => setReload((n) => n + 1)}
              loading={loading}
            >
              Tải lại
            </Button>
            <Button
              icon={<DownloadOutlined />}
              onClick={exportCsv}
              loading={exporting}
            >
              Xuất CSV
            </Button>
          </Space>
        </div>
        {error && (
          <Alert
            type="error"
            title={error}
            showIcon
            style={{ margin: "0 20px 20px" }}
          />
        )}
        <div className="history-summary">
          {[
            { label: "Mẫu đã lưu", value: data?.summary.samples },
            { label: "Mẫu ở ngoài", value: data?.summary.outsideSamples },
            { label: "GPS chưa rõ", value: data?.summary.uncertainSamples },
            { label: "Lượt ngoài đã xác nhận", value: data?.summary.events },
          ].map((s) => (
            <div key={s.label}>
              <strong>{s.value ?? "—"}</strong>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
        <div className="panel-heading">
          <div>
            <h2>
              {view === "events"
                ? "Các lượt ghi nhận ngoài khuôn viên"
                : "Nhật ký vị trí"}
            </h2>
            <p>
              Ngày và giờ theo Việt Nam (UTC+7) · Lọc tối đa 31 ngày · CSV tối
              đa 10.000 dòng.
            </p>
          </div>
          <Tag>{data?.total ?? 0} dòng</Tag>
        </div>
        {view === "events" ? (
          <Table
            rowKey="id"
            loading={loading}
            columns={events}
            dataSource={error ? [] : (data?.rows as EventRow[])}
            pagination={{
              current: page,
              pageSize: 50,
              total: data?.total ?? 0,
              showSizeChanger: false,
              onChange: setPage,
            }}
            scroll={{ x: 1260 }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="Chưa có lượt ngoài khuôn viên trong khoảng đã chọn"
                />
              ),
            }}
          />
        ) : (
          <Table
            rowKey="id"
            loading={loading}
            columns={samples}
            dataSource={error ? [] : (data?.rows as SampleRow[])}
            pagination={{
              current: page,
              pageSize: 50,
              total: data?.total ?? 0,
              showSizeChanger: false,
              onChange: setPage,
            }}
            scroll={{ x: 1100 }}
          />
        )}
      </section>
      <Modal
        open={detailOpen}
        title={
          detail
            ? "Hành trình · " + detail.event.user_name
            : "Đang tải hành trình"
        }
        width={1000}
        footer={null}
        onCancel={() => {
          detailRequest.current++;
          setDetailOpen(false);
        }}
      >
        {detailLoading ? (
          <div className="loading-panel">
            <Spin />
          </div>
        ) : (
          detail && (
            <>
              <div className="history-detail-meta">
                <EndTag event={detail.event} />
                <span>Mẫu đầu: {timestamp(detail.event.startedAt)}</span>
                <span>Mẫu cuối: {timestamp(detail.event.lastOutsideAt)}</span>
                <span>Quay lại: {timestamp(detail.event.returnedAt)}</span>
                <span>
                  Ranh giới:{" "}
                  {detail.boundary?.address ?? "Không có bản ranh giới"}
                </span>
              </div>
              {detail.truncated && (
                <Alert
                  type="warning"
                  title="Bản đồ hiển thị tối đa 2.000 mẫu. Dùng CSV với khoảng ngày nhỏ hơn để xem dữ liệu đầy đủ."
                />
              )}
              <HistoryMap points={detail.points} boundary={detail.boundary} />
              {detail.boundary?.boundaryNote && (
                <Alert
                  type="info"
                  showIcon
                  title={detail.boundary.boundaryNote}
                  style={{ marginTop: 12 }}
                />
              )}
              <p className="muted history-note">
                Đường nối chỉ liên kết các mẫu đã nhận, không xác nhận người
                dùng đi theo đúng đường đó. Bản đồ dùng phiên bản ranh giới tại
                thời điểm ghi nhận.
              </p>
            </>
          )
        )}
      </Modal>
    </>
  );
}
