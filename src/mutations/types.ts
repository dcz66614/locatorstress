// Operator types and shared constants for the P022 mutation set (fixed semantics, no wall-clock/randomness).
import type { ElementHandle, Page } from "playwright";

export type MutationId = "M01" | "M02" | "M03" | "M04" | "M05" | "M06" | "M07" | "M08";

export interface MutationContext {
  fixtureId: string;
  seed: string;
  m03Token: string;
  framePath: string[];
  newText: string;
}

export type MutationApply = (
  page: Page,
  target: ElementHandle,
  ctx: MutationContext,
) => Promise<void>;

export interface MutationDefinition {
  id: MutationId;
  name: string;
  apply: MutationApply;
}
