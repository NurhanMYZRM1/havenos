import type { ApiEventName, ApiEvents, ApiMethod, ApiResult } from "../../lib/api/contract";
import { asObject, readId, type FieldErrors, type Validated } from "../../lib/domain/validate";
import type { AttachmentPurpose } from "../../lib/domain/enums";
import type { Core } from "./context";
import { AppError, validationError } from "./errors";
import type { ChannelSyncControl } from "./integrations/channels";
import type { Workspaces } from "./workspace";

/** Things only the host (Electron) can do: dialogs, the OS shell, printing. */
export interface Platform {
  readonly name: string;
  readonly isPackaged: boolean;
  pickFiles(purpose: AttachmentPurpose): Promise<string[] | null>;
  /** One CSV file to import (e.g. an Airbnb earnings export). */
  pickImportFile(): Promise<string | null>;
  saveFile(defaultName: string, filter: { name: string; extensions: string[] }): Promise<string | null>;
  pickFolder(): Promise<string | null>;
  pickBackup(): Promise<string | null>;
  openPath(target: string): Promise<void>;
  showInFolder(target: string): void;
  openExternal(url: string): Promise<void>;
  receiptPdf(paymentId: string): Promise<Buffer>;
  emit<E extends ApiEventName>(event: E, payload: ApiEvents[E]): void;
}

export type Handlers = { [M in ApiMethod]: (params: unknown) => ApiResult<M> | Promise<ApiResult<M>> };

/** What a group of handlers gets to work with. */
export interface HandlerContext {
  ws: Workspaces;
  platform: Platform;
  channels: ChannelSyncControl;
  core(): Core;
}

export function ok<T>(v: Validated<T>): T {
  if (!v.ok) throw validationError(v.fields);
  return v.value;
}

export function idParam(params: unknown, key = "id"): string {
  const f: FieldErrors = {};
  const id = readId(asObject(params), key, f);
  if (!id) throw validationError(f);
  return id;
}

export function text(params: unknown, key: string, max = 500): string {
  const v = asObject(params)[key];
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** Placeholder for a handler whose work package hasn't landed yet. */
export function notImplemented(method: string): never {
  throw new AppError("UNSUPPORTED", null, { message: `${method} isn't available yet.` });
}
