// M06 MOVE_TO_OPEN_SHADOW_ROOT: insert div.m06-shadow-host before target, attach open shadow root, move target inside.
import type { MutationDefinition } from "./types.js";

export const moveToOpenShadowRoot: MutationDefinition = {
  id: "M06",
  name: "MOVE_TO_OPEN_SHADOW_ROOT",
  apply: async (_page, target, _ctx) => {
    await target.evaluate((el: Element) => {
      const parent = el.parentNode;
      if (!parent) {
        return;
      }
      const host = el.ownerDocument.createElement("div");
      host.className = "m06-shadow-host";
      parent.insertBefore(host, el);
      const root = host.attachShadow({ mode: "open" });
      root.appendChild(el);
    });
  },
};
