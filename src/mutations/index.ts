// Public barrel for the mutation module.
export * from "./types.js";
export * from "./registry.js";
export { wrapTarget } from "./M01-wrap-target.js";
export { reorderSiblings } from "./M02-reorder-siblings.js";
export { changeClass } from "./M03-change-class.js";
export { insertSameName } from "./M04-insert-same-name.js";
export { nestedIframe } from "./M05-nested-iframe.js";
export { moveToOpenShadowRoot } from "./M06-open-shadow-root.js";
export { insertHiddenDuplicate } from "./M07-hidden-duplicate.js";
export { changeText } from "./M08-change-text.js";
