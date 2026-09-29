const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const ROOT = path.join(
  __dirname,
  '..'
);

const EXCEL_FILE = path.join(
  ROOT,
  'knowledge',
  'QA_Sentinel_Knowledge_Base_MultiSheet.xlsx'
);

const OUTPUT_FILE = path.join(
  ROOT,
  'knowledge',
  'qa-sentinel-knowledge.json'
);

/*
 * Sheet order used later by prompt-builder.js.
 */
const PREFERRED_SHEET_ORDER = [
  'Overview',
  'Providers',
  'Monitor Rules',
  'Interpretation Rules',
  'Low Traffic',
  'False Positives',
  'Classifications',
  'Output Rules',
  'QA Philosophy',
  'Examples'
];

function assertFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Knowledge workbook not found: ${filePath}`
    );
  }
}

function normalizeCellValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  /*
   * ExcelJS may return rich-text or formula objects.
   */
  if (
    typeof value === 'object'
  ) {
    if (
      Array.isArray(value.richText)
    ) {
      return value.richText
        .map(item => item.text || '')
        .join('')
        .trim();
    }

    if (
      Object.prototype.hasOwnProperty.call(
        value,
        'result'
      )
    ) {
      return normalizeCellValue(
        value.result
      );
    }

    if (
      Object.prototype.hasOwnProperty.call(
        value,
        'text'
      )
    ) {
      return String(value.text).trim();
    }
  }

  return String(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

function getWorksheetRows(worksheet) {
  const rows = [];

  worksheet.eachRow(
    {
      includeEmpty: true
    },
    row => {
      const values = [];

      /*
       * row.values starts at index 1.
       */
      for (
        let columnIndex = 1;
        columnIndex <= worksheet.columnCount;
        columnIndex += 1
      ) {
        values.push(
          normalizeCellValue(
            row.getCell(columnIndex).value
          )
        );
      }

      rows.push(values);
    }
  );

  return rows;
}

/*
 * Expected workbook structure:
 *
 * Row 1: Sheet title
 * Row 2: Sheet description
 * Row 3: Blank
 * Row 4: Table headers
 * Row 5+: Records
 */
function parseWorksheet(worksheet) {
  const rows =
    getWorksheetRows(worksheet);

  if (rows.length === 0) {
    return null;
  }

  const title =
    rows[0]?.[0] ||
    worksheet.name;

  const description =
    rows[1]?.[0] || '';

  const headerRowIndex =
    rows.findIndex(
      (row, index) => {
        if (index < 2) {
          return false;
        }

        const populatedCellCount =
          row.filter(
            value => value !== ''
          ).length;

        return populatedCellCount >= 2;
      }
    );

  if (headerRowIndex === -1) {
    return {
      sheetName:
        worksheet.name,

      title,

      description,

      headers: [],

      records: []
    };
  }

  const headers =
    rows[headerRowIndex]
      .map(normalizeCellValue);

  const records =
    rows
      .slice(headerRowIndex + 1)
      .filter(row =>
        row.some(
          value =>
            normalizeCellValue(value) !== ''
        )
      )
      .map(row => {
        const record = {};

        headers.forEach(
          (header, columnIndex) => {
            if (!header) {
              return;
            }

            record[header] =
              normalizeCellValue(
                row[columnIndex]
              );
          }
        );

        return record;
      });

  return {
    sheetName:
      worksheet.name,

    title,

    description,

    headers:
      headers.filter(Boolean),

    records
  };
}

function sortSheets(sheets) {
  return [...sheets].sort(
    (first, second) => {
      const firstIndex =
        PREFERRED_SHEET_ORDER.indexOf(
          first.sheetName
        );

      const secondIndex =
        PREFERRED_SHEET_ORDER.indexOf(
          second.sheetName
        );

      const safeFirstIndex =
        firstIndex === -1
          ? Number.MAX_SAFE_INTEGER
          : firstIndex;

      const safeSecondIndex =
        secondIndex === -1
          ? Number.MAX_SAFE_INTEGER
          : secondIndex;

      if (
        safeFirstIndex !== safeSecondIndex
      ) {
        return (
          safeFirstIndex -
          safeSecondIndex
        );
      }

      return first.sheetName.localeCompare(
        second.sheetName
      );
    }
  );
}

async function buildKnowledge() {
  assertFileExists(EXCEL_FILE);

  const workbook =
    new ExcelJS.Workbook();

  await workbook.xlsx.readFile(
    EXCEL_FILE
  );

  const sheets = [];

  workbook.eachSheet(
    worksheet => {
      const parsed =
        parseWorksheet(worksheet);

      if (parsed) {
        sheets.push(parsed);
      }
    }
  );

  if (sheets.length === 0) {
    throw new Error(
      'No valid knowledge sheets found.'
    );
  }

  const orderedSheets =
    sortSheets(sheets);

  const totalRecords =
    orderedSheets.reduce(
      (sum, sheet) =>
        sum + sheet.records.length,
      0
    );

  return {
    metadata: {
      generatedAtUtc:
        new Date().toISOString(),

      sourceWorkbook:
        path.basename(EXCEL_FILE),

      sheetCount:
        orderedSheets.length,

      totalRecords
    },

    sheets:
      orderedSheets
  };
}

function saveKnowledge(data) {
  fs.mkdirSync(
    path.dirname(OUTPUT_FILE),
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      data,
      null,
      2
    ),
    'utf8'
  );
}

async function main() {
  console.log(
    '\n📚 Building QA Sentinel Knowledge...'
  );

  const knowledge =
    await buildKnowledge();

  saveKnowledge(knowledge);

  console.log(
    `✅ Knowledge JSON created`
  );

  console.log(
    `📄 ${OUTPUT_FILE}`
  );

  console.log(
    `📑 Sheets: ` +
    `${knowledge.metadata.sheetCount}`
  );

  console.log(
    `📝 Records: ` +
    `${knowledge.metadata.totalRecords}`
  );

  console.log('\nLoaded sheets:');

  knowledge.sheets.forEach(
    sheet => {
      console.log(
        `- ${sheet.sheetName}: ` +
        `${sheet.records.length} records`
      );
    }
  );
}

main().catch(error => {
  console.error(
    `\n❌ Knowledge Builder failed: ` +
    `${error.message}`
  );

  process.exit(1);
});