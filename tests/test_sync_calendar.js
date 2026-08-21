require("dotenv").config();

const {
  syncToCalendar,
} = require("../src/sync/syncToCalendar");

async function main() {
  const result =
    await syncToCalendar();

  console.log(
    "\nKết quả sync Calendar:"
  );

  console.dir(result, {
    depth: null,
  });

  if (result.failed > 0) {
    throw new Error(
      `${result.failed} meeting sync thất bại.`
    );
  }

  console.log(
    "\nSync Calendar: PASS"
  );
}

main().catch((error) => {
  console.error(
    "\nSync Calendar thất bại:",
    error.message
  );

  process.exitCode = 1;
});
