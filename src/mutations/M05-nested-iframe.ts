// M05 NESTED_IFRAME: append a srcdoc-only iframe last in the first frame's parent, or in body when framePath is empty.
import type { MutationDefinition } from "./types.js";

export const nestedIframe: MutationDefinition = {
  id: "M05",
  name: "NESTED_IFRAME",
  apply: async (page, _target, ctx) => {
    if (ctx.framePath.length > 0) {
      const selector = ctx.framePath[0];
      await page.evaluate((sel: string) => {
        const frameEl = document.querySelector(sel);
        if (!frameEl || !frameEl.parentNode) {
          return;
        }
        const iframe = document.createElement("iframe");
        const classAttr = frameEl.getAttribute("class");
        if (classAttr !== null) {
          iframe.setAttribute("class", classAttr);
        }
        iframe.srcdoc = "<button>Decoy</button>";
        frameEl.parentNode.appendChild(iframe);
      }, selector);
      return;
    }
    await page.evaluate(() => {
      const iframe = document.createElement("iframe");
      iframe.srcdoc = "<button>Decoy</button>";
      document.body.appendChild(iframe);
    });
  },
};
