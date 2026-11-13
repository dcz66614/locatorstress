// M02 REORDER_SIBLINGS: swap the target with its next element sibling, else previous element sibling, via one insertBefore.
import type { MutationDefinition } from "./types.js";

export const reorderSiblings: MutationDefinition = {
  id: "M02",
  name: "REORDER_SIBLINGS",
  apply: async (_page, target, _ctx) => {
    await target.evaluate((el: Element) => {
      const parent = el.parentNode;
      if (!parent) {
        return;
      }
      if (el.nextElementSibling) {
        parent.insertBefore(el, el.nextElementSibling.nextElementSibling ?? null);
      } else if (el.previousElementSibling) {
        parent.insertBefore(el, el.previousElementSibling);
      }
    });
  },
};
