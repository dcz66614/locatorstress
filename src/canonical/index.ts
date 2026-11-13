// T006 — Canonical JSON + four SHA-256 hashes (PROJECT_BOOK §6).
export {
  compareCodePoints,
  canonicalize,
  canonicalJson,
  canonicalBytes,
  sha256Hex,
  sha256Bytes,
  hashCanonical,
} from "./canonical-json.js";
export {
  SEED,
  MUTATION_SUITE,
  BFS_LIMITS,
  S0_THRESHOLDS,
  S0_GATE_NOTES,
  SCHEMA_SCENARIO,
  SCHEMA_ORACLE,
  SCHEMA_ANALYSIS,
  SCHEMA_GATE,
  buildScenarioCanonical,
  buildOracleCanonical,
  buildAnalysisCanonical,
  buildGateCounts,
  buildGateCanonical,
  scenarioSha256,
  oracleResultSha256,
  analysisSha256,
  gateSha256,
  computeFourHashes,
} from "./hashes.js";
export type {
  CanonicalVerdict,
  AnalysisStatus,
  VerdictCounts,
  Coverage,
  ScenarioFixtureInput,
  OracleCaseInput,
  StabilityScoreInput,
  ControlsInput,
  OracleParityInput,
  AnalysisInput,
  GateCountsInput,
  ThreeHashes,
  GateInput,
} from "./hashes.js";
export {
  defaultForbiddenScanContext,
  buildForbiddenScanRules,
  scanForbiddenFields,
} from "./forbidden-scan.js";
export type {
  ForbiddenScanContext,
  ForbiddenScanRule,
  ForbiddenScanHit,
  ForbiddenScanResult,
} from "./forbidden-scan.js";
