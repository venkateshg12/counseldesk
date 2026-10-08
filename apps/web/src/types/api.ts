import type { InternalAxiosRequestConfig } from "axios";

export interface ApiErrorDetail {
  path?: string;
  message: string;
  code?: string;
}

export interface ApiError {
  status: number;
  message: string;
  code?: string;
  errors?: ApiErrorDetail[];
  data?: null;
  [key: string]: unknown;
}

export interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
  _wakeTimer?: ReturnType<typeof setTimeout>;
}

export interface QueueItem {
  resolve: () => void;
  reject: (reason: unknown) => void;
}

export type ApiEnvelope<T> =
  | {
      status: "success";
      data: T;
      meta?: Record<string, unknown>;
      errors?: never;
    }
  | {
      status: "error";
      data: null;
      meta?: Record<string, unknown>;
      errors: ApiErrorDetail[];
    };
