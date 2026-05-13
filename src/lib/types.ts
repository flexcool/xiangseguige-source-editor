export interface BookSource {
  _key: string;
  sourceName: string;
  sourceUrl: string;
  enable: boolean;
  weight: number;
  lastModifyTime: string | number;
  _raw: Record<string, unknown>;
}

export type ToastType = "ok" | "err" | "info" | "warn";

export interface ToastItem {
  id: number;
  msg: string;
  type: ToastType;
}
