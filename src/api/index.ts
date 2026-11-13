// T008 — Local analysis API barrel.
export { ApiError, createBrowserAnalysisService, loadGoldenExpected } from "./service.js";
export type {
  AnalysisService,
  FixtureSummary,
  MutationSummary,
  AnalyzedCase,
  FixtureAnalysis,
  AnalyzeRequest,
  SearchRequest,
  ValidateRequest,
  HealthInfo,
} from "./service.js";
// FIX-R1-01 — custom scenario contract (user-supplied HTML + locator
// + private target descriptor).
export {
  MAX_CUSTOM_HTML_BYTES,
  MAX_CUSTOM_DOM_NODES,
  validateCustomScenarioShape,
  validateCustomScenarioForRun,
  validateCustomTarget,
  normalizeCustomScenario,
} from "../contracts/custom-scenario.js";
export type {
  CustomScenarioV1,
  CustomTargetDescriptor,
} from "../contracts/custom-scenario.js";
export { handleApiRequest } from "./routes.js";
export type { RouteResult } from "./routes.js";
export {
  LOOPBACK_HOSTS,
  DEFAULT_API_HOST,
  assertLoopbackHost,
  startAnalysisServer,
} from "./server.js";
export type { RunningApiServer, StartApiServerOptions } from "./server.js";
