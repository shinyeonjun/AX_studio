import { z } from 'zod';

/** New snapshots explicitly identify complete host-accepted intent; absence means legacy. */
export const AuthoritativeRequestAnchorSchema = z.object({
  version: z.literal(1),
  text: z.string().min(1),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  utf8Bytes: z.number().int().nonnegative(),
  serializedUtf8Bytes: z.number().int().nonnegative(),
  decisionTextComplete: z.literal(true),
  originalRequestId: z.string().optional(),
  workspaceSessionId: z.string().optional(),
  catalogRevision: z.number().int().nonnegative().optional(),
}).strict();

export type AuthoritativeRequestAnchor = Readonly<z.infer<typeof AuthoritativeRequestAnchorSchema>>;

export interface AuthoritativeRequestBudget {
  maxUtf8Bytes: number;
  /** UTF-8 bytes of JSON.stringify({ request: exactText }), including escaping. */
  maxSerializedUtf8Bytes: number;
  /** Complete host evaluation packet, before the provider's unchanged batching. */
  maxDecisionPacketUtf8Bytes: number;
}

export type AuthoritativeRequestFailureCode =
  | 'request_utf8_budget_exceeded'
  | 'request_serialized_budget_exceeded'
  | 'decision_packet_budget_exceeded'
  | 'request_anchor_mismatch'
  | 'invalid_request_budget'
  | 'invalid_request_text'
  | 'decision_packet_not_serializable';

export interface AuthoritativeRequestFailure {
  code: AuthoritativeRequestFailureCode;
  actualBytes?: number;
  maxBytes?: number;
}
