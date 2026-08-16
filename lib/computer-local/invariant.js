// src/computer-local/invariant.ts
var PACKAGE_NAME = "@zibokapi/dsh-codex-computer-use/computer-local";
var name = "computer-local-invariant";
var inject = ["invariants"];
var install = () => {
};
var apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
export {
  apply,
  inject,
  name
};
