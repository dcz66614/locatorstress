// M03 CHANGE_CLASS: if the target's class list contains ctx.m03Token, replace it with token + "-changed".
import type { MutationDefinition } from "./types.js";

export const changeClass: MutationDefinition = {
  id: "M03",
  name: "CHANGE_CLASS",
  apply: async (_page, target, ctx) => {
    await target.evaluate((el: Element, token: string) => {
      if (el.classList.contains(token)) {
        el.classList.replace(token, token + "-changed");
      }
    }, ctx.m03Token);
  },
};
