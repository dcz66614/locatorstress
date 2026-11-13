// T007 — Bounded BFS search module.
export {
  BFS_MAX_DEPTH,
  BFS_MAX_EXPANDED_STATES,
  runBoundedBfs,
} from "./bfs.js";
export type {
  BfsStatus,
  BfsEvaluation,
  BfsEvaluator,
  BfsOptions,
  BfsWitness,
  BfsEvaluationRecord,
  BfsResult,
} from "./bfs.js";
export {
  SCHEMA_BFS_PLAN_STATE_KEY,
  SCHEMA_BFS_DOM_STATE_KEY,
  sequenceKey,
  planStateKey,
  domStateKey,
  compareSequences,
  isFailureVerdict,
} from "./state-key.js";
export { createBrowserEvaluator, createBrowserEvaluatorForCustom } from "./browser-evaluator.js";
export type { BrowserEvaluatorOptions, CustomEvaluatorInput } from "./browser-evaluator.js";
