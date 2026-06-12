import { runReprocess } from "./reprocess-lib";

async function main() {
  const args = process.argv.slice(2);
  const filterArg = args.find((a) => !a.startsWith("--")) ?? "all";
  const verbose = args.includes("--verbose");
  await runReprocess(filterArg, verbose);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
