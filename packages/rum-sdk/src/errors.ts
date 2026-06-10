import { scrubUrl } from "./context";

export type Emit = (name: string, attrs: Record<string, string | number>) => void;

export function initErrors(emit: Emit): void {
  addEventListener("error", (e: ErrorEvent) => {
    emit("exception", {
      "mip.error_kind": "error",
      "exception.message": String(e.message ?? "").slice(0, 1000),
      "exception.type": e.error?.name ?? "Error",
      "exception.stacktrace": String(e.error?.stack ?? "").slice(0, 4000),
      "mip.error_source": scrubUrl(String(e.filename ?? "")),
      "mip.error_lineno": e.lineno ?? 0,
      "mip.error_colno": e.colno ?? 0,
    });
  });
  addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason = e.reason as Error | unknown;
    const isErr = reason instanceof Error;
    emit("exception", {
      "mip.error_kind": "unhandledrejection",
      "exception.message": String(isErr ? reason.message : (reason ?? "")).slice(0, 1000),
      "exception.type": isErr ? reason.name : "UnhandledRejection",
      "exception.stacktrace": String(isErr ? (reason.stack ?? "") : "").slice(0, 4000),
    });
  });
}
