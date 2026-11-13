// M01 WRAP_TARGET: insert a div.wrap before the target in its parent, then move the target inside it.
import type { MutationDefinition } from "./types.js";

export const wrapTarget: MutationDefinition = {
  id: "M01",
  name: "WRAP_TARGET",
  apply: async (_page, target, _ctx) => {
    await target.evaluate((el: Element) => {
      const parent = el.parentNode;
      if (!parent) {
        return;
      }
      const wrap = el.ownerDocument.createElement("div");
      wrap.className = "wrap";
      parent.insertBefore(wrap, el);
      wrap.appendChild(el);
    });
  },
};
