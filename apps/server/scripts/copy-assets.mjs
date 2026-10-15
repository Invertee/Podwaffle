import { cp, mkdir } from "node:fs/promises";
import { URL } from "node:url";

await mkdir(new URL("../dist/db/migrations/", import.meta.url), {
  recursive: true,
});
await cp(
  new URL("../src/db/migrations/", import.meta.url),
  new URL("../dist/db/migrations/", import.meta.url),
  { recursive: true },
);

for (const name of ["src", "public", "package.json"]) {
  await cp(
    new URL(`../src/analysis/engine/${name}`, import.meta.url),
    new URL(`../dist/analysis/engine/${name}`, import.meta.url),
    { recursive: true },
  );
}
