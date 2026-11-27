import type { Point, Policy } from "./geo";
export type BoundaryDraftValues = {
  name?: string;
  address?: string;
  policy?: Partial<Policy>;
  circle?: { center?: Partial<Point>; radiusMeters?: number };
};
export function boundaryDraftKey(
  mode: "circle" | "polygon",
  values: BoundaryDraftValues | undefined,
  polygon: Point[],
) {
  return JSON.stringify({
    mode,
    name: values?.name,
    address: values?.address,
    policy: {
      buffer: values?.policy?.buffer,
      maxAccuracy: values?.policy?.maxAccuracy,
      confirmSeconds: values?.policy?.confirmSeconds,
      staleMinutes: values?.policy?.staleMinutes,
    },
    circle:
      mode === "circle"
        ? {
            center: {
              lat: values?.circle?.center?.lat,
              lng: values?.circle?.center?.lng,
            },
            radiusMeters: values?.circle?.radiusMeters,
          }
        : undefined,
    polygon: mode === "polygon" ? polygon : undefined,
  });
}
