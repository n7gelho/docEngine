import { runReprocess } from "./reprocess-lib";

runReprocess("all")
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
