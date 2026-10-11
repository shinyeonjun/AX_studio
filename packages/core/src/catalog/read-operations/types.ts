/**
 * A safe, local mapping from a Jev choice to a host-owned read command.
 *
 * `params` never enters Jev state. It is retained only so the host can turn a
 * selected bounded key into a typed capability.invoke command.
 */
export interface JevReadOperationHint {
  key: string;
  capabilityId: string;
  connector: 'http' | 'openapi' | 'rdb' | 'gmail' | 'slack' | 'local_folder' | 'local_sheet';
  sourceLabel?: string;
  label: string;
  description: string;
  params: Record<string, unknown>;
  /** Schema-declared parameter paths; finite choices may be selected by Jev, open values stay host/user supplied. */
  parameterHints?: readonly JevReadParameterHint[];
  /** Required paths still absent from the host-resolved params. */
  missingParameterPaths?: readonly string[];
  /**
   * Input ports only another step can fill (the mail a new-mail job started with). Usable as a
   * job step bound to that output; a read on its own (chat, investigation) cannot call it.
   */
  requiresBinding?: readonly string[];
}

export interface JevReadParameterHint {
  path: string;
  type?: string;
  description?: string;
  required: boolean;
  choices?: readonly (string | number | boolean)[];
}

export interface JevReadOperationSelection {
  hints: JevReadOperationHint[];
  totalCount: number;
  catalogMayBeBounded: boolean;
  /** Catalog mode; `lexical_relevance` changes ordering without removing candidates. */
  mode: 'empty_catalog' | 'full_catalog' | 'lexical_relevance' | 'no_lexical_match';
  /** Number of indexed operations matching at least one request token. */
  lexicalMatchedOperationCount: number;
  /** Highest number of request tokens matched by a single operation. */
  lexicalTopScore: number;
}

export type HintResolution = Pick<JevReadOperationHint, 'params' | 'parameterHints' | 'missingParameterPaths' | 'requiresBinding'>;
export type HintMetadata = Pick<JevReadOperationHint, 'capabilityId' | 'connector' | 'sourceLabel' | 'label' | 'description'>;
