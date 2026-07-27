require("dotenv").config();

const { getSheetsClient } = require("./src/sheets");

async function main() {
  const spreadsheetId = process.env.SPREADSHEET_ID;

  if (!spreadsheetId) {
    throw new Error("Thiếu SPREADSHEET_ID trong .env");
  }

  const sheets = await getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Trang tính2!A:F",
  });

  console.log("Đọc thành công!");
  console.table(response.data.values || []);
}

main().catch((err) => {
  console.error(err.message);
});