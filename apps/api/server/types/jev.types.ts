/**
 * TypeSafe's System One API (model Jev), as reached through the LiteLLM
 * proxy's `/typesafe` pass-through. Jev never writes text: each question gets
 * a typed answer — a yes/no probability (noul), a pick from fixed options
 * (choice) or a level on a rubric (score).
 * https://docs.typesafe.ai/api
 */

type JevText = string | Record<string, unknown> | unknown[];

export interface JevNoulQuestion {
  type: 'noul';
  instructions: JevText;
  criteria?: { true?: JevText; false?: JevText };
}

export interface JevChoiceQuestion {
  type: 'choice';
  instructions: JevText;
  /** Option → description (null for none), at most 255 options. */
  criteria: Record<string, JevText | null>;
}

export interface JevScoreQuestion {
  type: 'score';
  instructions: JevText;
  /** Ordered level descriptions, 2-10. */
  criteria: JevText[];
}

export type JevQuestion = JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion;

/** A picture Jev reads wherever its key is written in `state`, `instructions` or `criteria`. https://docs.typesafe.ai/images */
export interface JevAsset {
  type: 'image';
  format: 'jpg';
  data_base64: string;
}

/** Prepared pictures: the request's `assets`, and the keys to write into the state. */
export interface JevImages {
  assets: Record<string, JevAsset>;
  refs: string[];
}

export interface JevRequest {
  /** Defaults to the configured model (LITELLM_JEV_MODEL) when omitted. */
  model?: string;
  state: JevText;
  /** Answers come back under the same keys. */
  questions: Record<string, JevQuestion>;
  /** Pictures, sent with the `TypeSafe-Danger-Zone-Images` header (askJev adds it). */
  assets?: Record<string, JevAsset>;
}

export type JevAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'score'; score: number; legend: Record<string, string>; probabilities: Record<string, number>; confidence: number };

export interface JevResponse {
  /** The versioned model that answered, e.g. `jev-1.13.0`, even when an alias was sent. */
  model: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}
