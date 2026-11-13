export type ExecutionStatus = "COMPLETED" | "ERROR" | "TIMEOUT" | "INVALID_FIXTURE";

export interface FrameScopeFailure {
  layer: number;
  selector: string;
  matchCount: number;
  kind: "FRAME_MISSING" | "FRAME_AMBIGUOUS";
}

export interface ResolverResult {
  executionStatus: ExecutionStatus;
  rawMatchCount: number;
  finalMatchCount: number;
  frameFailure: FrameScopeFailure | null;
  errorMessage: string | null;
}
