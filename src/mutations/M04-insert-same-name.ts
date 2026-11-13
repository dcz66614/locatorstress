// M04 INSERT_SAME_NAME: insert a fresh decoy before the target with same tag, class, textContent, aria-label (if any).
import type { MutationDefinition } from "./types.js";

export const insertSameName: MutationDefinition = {
  id: "M04",
  name: "INSERT_SAME_NAME",
  apply: async (_page, target, _ctx) => {
    await target.evaluate((el: Element) => {
      const parent = el.parentNode;
      if (!parent) {
        return;
      }
      const doc = el.ownerDocument;
      const decoy = doc.createElement(el.tagName);
      const classAttr = el.getAttribute("class");
      if (classAttr !== null) {
        decoy.setAttribute("class", classAttr);
      }
      decoy.textContent = el.textContent;
      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel !== null) {
        decoy.setAttribute("aria-label", ariaLabel);
      }
      parent.insertBefore(decoy, el);
    });
  },
};
