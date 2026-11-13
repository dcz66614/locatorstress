// M08 CHANGE_TEXT: set the target's textContent to ctx.newText (attributes untouched).
import type { MutationDefinition } from "./types.js";

export const changeText: MutationDefinition = {
  id: "M08",
  name: "CHANGE_TEXT",
  apply: async (_page, target, ctx) => {
    await target.evaluate((el: Element, text: string) => {
      el.textContent = text;
    }, ctx.newText);
  },
};
