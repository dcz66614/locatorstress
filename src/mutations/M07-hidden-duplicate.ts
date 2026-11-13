// M07 INSERT_HIDDEN_DUPLICATE: like M04 but decoy is display:none and aria-hidden="true".
import type { MutationDefinition } from "./types.js";

export const insertHiddenDuplicate: MutationDefinition = {
  id: "M07",
  name: "INSERT_HIDDEN_DUPLICATE",
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
      (decoy as HTMLElement).style.display = "none";
      decoy.setAttribute("aria-hidden", "true");
      parent.insertBefore(decoy, el);
    });
  },
};
