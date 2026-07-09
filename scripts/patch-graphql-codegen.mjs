// Post-codegen patch (#15). The @graphql-codegen/typescript-react-query plugin emits
//   import { RequestInit } from 'graphql-request/dist/types.dom';
// a subpath that no maintained graphql-request version ships (v5+ moved to build/, and RequestInit is a
// global DOM type anyway — tsconfig `lib` includes "dom"). We strip the import so `RequestInit` resolves
// to the global type; the generated hooks otherwise use graphql-request's GraphQLClient normally. Run
// automatically by `npm run graphql:codegen`.
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "src/generated/graphql.ts";
const BAD_IMPORT =
  /^import\s+\{\s*RequestInit\s*\}\s+from\s+['"]graphql-request\/dist\/types\.dom['"];?\s*$/m;

const src = readFileSync(FILE, "utf8");
if (!BAD_IMPORT.test(src)) {
  console.log(`patch-graphql-codegen: nothing to patch in ${FILE}`);
  process.exit(0);
}
writeFileSync(
  FILE,
  src.replace(BAD_IMPORT, "// RequestInit is a global DOM type (tsconfig lib: dom)."),
  "utf8",
);
console.log(`patch-graphql-codegen: stripped broken graphql-request import from ${FILE}`);
