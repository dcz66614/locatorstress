// Mutation registry: fixed order and lookup for M01..M08.
import type { MutationDefinition, MutationId } from "./types.js";
import { wrapTarget } from "./M01-wrap-target.js";
import { reorderSiblings } from "./M02-reorder-siblings.js";
import { changeClass } from "./M03-change-class.js";
import { insertSameName } from "./M04-insert-same-name.js";
import { nestedIframe } from "./M05-nested-iframe.js";
import { moveToOpenShadowRoot } from "./M06-open-shadow-root.js";
import { insertHiddenDuplicate } from "./M07-hidden-duplicate.js";
import { changeText } from "./M08-change-text.js";

export const MUTATION_ORDER: MutationId[] = [
  "M01",
  "M02",
  "M03",
  "M04",
  "M05",
  "M06",
  "M07",
  "M08",
];

export const MUTATIONS: Readonly<Record<MutationId, MutationDefinition>> = {
  M01: wrapTarget,
  M02: reorderSiblings,
  M03: changeClass,
  M04: insertSameName,
  M05: nestedIframe,
  M06: moveToOpenShadowRoot,
  M07: insertHiddenDuplicate,
  M08: changeText,
};

export function getMutation(id: MutationId): MutationDefinition {
  return MUTATIONS[id];
}
