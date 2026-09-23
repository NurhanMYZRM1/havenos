import type { ApiErrorShape, ErrorCode } from "../../lib/api/contract";
import { t, type MessageKey, type MessageParams } from "../../lib/i18n";
import type { FieldErrors } from "../../lib/domain/validate";

/** An expected failure the UI can explain to the landlord. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly messageKey?: MessageKey;
  readonly params?: MessageParams;
  readonly fields?: FieldErrors;

  constructor(code: ErrorCode, messageKey: MessageKey | null, opts: { params?: MessageParams; fields?: FieldErrors; message?: string } = {}) {
    super(opts.message ?? (messageKey ? t(messageKey, opts.params) : code));
    this.code = code;
    this.messageKey = messageKey ?? undefined;
    this.params = opts.params;
    this.fields = opts.fields;
  }

  toShape(): ApiErrorShape {
    return {
      code: this.code,
      message: this.message,
      messageKey: this.messageKey,
      params: this.params,
      fields: this.fields,
    };
  }
}

export function validationError(fields: FieldErrors): AppError {
  const first = Object.values(fields)[0];
  return new AppError("VALIDATION", first ?? "validation.required", { fields });
}

export function notFound(): AppError {
  return new AppError("NOT_FOUND", "errors.notFound");
}

/** Map SQLite constraint failures raised by our triggers to friendly errors. */
export function fromDatabaseError(err: unknown): AppError | null {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("HAVENOS:OVERLAP")) return new AppError("CONFLICT", "errors.overlap", { params: { space: "", tenant: "", start: "", end: "" }, message: "This overlaps an existing tenancy or reservation." });
  if (message.includes("HAVENOS:WRONG_PARENT")) return new AppError("VALIDATION", "errors.wrongParent");
  if (message.includes("UNIQUE constraint failed: index 'spaces_unique_label'") || message.includes("spaces_unique_label")) {
    return new AppError("CONFLICT", "errors.labelTaken", { params: { label: "" } });
  }
  if (message.includes("FOREIGN KEY constraint failed")) return new AppError("CONFLICT", "errors.hasTenancies");
  return null;
}

export function toErrorShape(err: unknown): ApiErrorShape {
  if (err instanceof AppError) return err.toShape();
  const mapped = fromDatabaseError(err);
  if (mapped) return mapped.toShape();
  const message = err instanceof Error ? err.message : String(err);
  return { code: "INTERNAL", message: t("errors.unexpected", { message }), messageKey: "errors.unexpected", params: { message } };
}
