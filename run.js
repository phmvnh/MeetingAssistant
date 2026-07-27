require("dotenv").config();

const {
  syncAll,
} = require("./src/sync/syncAll");

async function main() {
  const result =
    await syncAll();

  console.log(
    "\nKết quả toàn bộ pipeline:"
  );

  console.dir(result, {
    depth: null,
  });

  if (
    result.calendar.failed > 0
  ) {
    throw new Error(
      `${result.calendar.failed} meeting đồng bộ Calendar thất bại.`
    );
  }

  console.log(
    "\nPipeline hoàn thành: PASS"
  );
}

main().catch((error) => {
  console.error(
    "\nPipeline thất bại:",
    error.message
  );

  process.exitCode = 1;
});