const fs = require('fs');
const path = require('path');

const ROOT = path.join(
  __dirname,
  '..'
);

const AI_REVIEW_OUTPUT_FILE = path.join(
  ROOT,
  'reports',
  'ai',
  'ai-review-output-latest.json'
);

const USAGE_DIRECTORY = path.join(
  ROOT,
  'reports',
  'ai',
  'usage'
);

const LATEST_SUMMARY_FILE = path.join(
  USAGE_DIRECTORY,
  'usage-summary-latest.json'
);

function assertFileExists(
  filePath,
  label
) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `${label} not found: ${filePath}`
    );
  }
}

function ensureUsageDirectory() {
  fs.mkdirSync(
    USAGE_DIRECTORY,
    {
      recursive: true
    }
  );
}

function readJsonFile(
  filePath,
  fallbackValue = null
) {
  if (!fs.existsSync(filePath)) {
    return fallbackValue;
  }

  const raw = fs
    .readFileSync(
      filePath,
      'utf8'
    )
    .trim();

  if (!raw) {
    return fallbackValue;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${filePath}: ` +
      error.message
    );
  }
}

function writeJsonFile(
  filePath,
  data
) {
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      data,
      null,
      2
    ),
    'utf8'
  );
}

function toNumber(value) {
  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}

function getMonthKey(date) {
  const year =
    date.getUTCFullYear();

  const month =
    String(
      date.getUTCMonth() + 1
    ).padStart(
      2,
      '0'
    );

  return `${year}-${month}`;
}

function getDayKey(date) {
  const year =
    date.getUTCFullYear();

  const month =
    String(
      date.getUTCMonth() + 1
    ).padStart(
      2,
      '0'
    );

  const day =
    String(
      date.getUTCDate()
    ).padStart(
      2,
      '0'
    );

  return `${year}-${month}-${day}`;
}

function parseGeneratedDate(metadata) {
  const rawDate =
    metadata?.generatedAtUtc;

  const parsedDate =
    rawDate
      ? new Date(rawDate)
      : new Date();

  if (
    Number.isNaN(
      parsedDate.getTime()
    )
  ) {
    return new Date();
  }

  return parsedDate;
}

function buildUsageRecord(
  aiReviewOutput
) {
  const metadata =
    aiReviewOutput.metadata || {};

  const review =
    aiReviewOutput.review || {};

  const overall =
    review.overallAssessment || {};

  const usage =
    metadata.usage || {};

  const generatedDate =
    parseGeneratedDate(
      metadata
    );

  return {
    responseId:
      metadata.responseId || null,

    generatedAtUtc:
      generatedDate.toISOString(),

    day:
      getDayKey(
        generatedDate
      ),

    month:
      getMonthKey(
        generatedDate
      ),

    model:
      metadata.model || 'unknown',

    durationMs:
      toNumber(
        metadata.durationMs
      ),

    usage: {
      inputTokens:
        toNumber(
          usage.inputTokens
        ),

      outputTokens:
        toNumber(
          usage.outputTokens
        ),

      totalTokens:
        toNumber(
          usage.totalTokens
        )
    },

    result: {
      classification:
        overall.classification ||
        'unknown',

      severity:
        overall.severity ||
        'unknown',

      confidence:
        toNumber(
          overall.confidence
        ),

      shouldNotify:
        overall.shouldNotify === true,

      findings:
        Array.isArray(
          review.findings
        )
          ? review.findings.length
          : 0
    },

    deterministicAlerts: {
      critical:
        toNumber(
          metadata
            .deterministicSummary
            ?.critical
        ),

      warning:
        toNumber(
          metadata
            .deterministicSummary
            ?.warning
        ),

      attention:
        toNumber(
          metadata
            .deterministicSummary
            ?.attention
        ),

      total:
        toNumber(
          metadata
            .deterministicSummary
            ?.totalAlerts
        )
    }
  };
}

function getMonthlyUsageFile(
  monthKey
) {
  return path.join(
    USAGE_DIRECTORY,
    `${monthKey}.json`
  );
}

function normalizeMonthlyData(
  existingData,
  monthKey
) {
  if (
    !existingData ||
    typeof existingData !== 'object'
  ) {
    return {
      metadata: {
        month:
          monthKey,

        createdAtUtc:
          new Date().toISOString(),

        updatedAtUtc:
          new Date().toISOString()
      },

      records: []
    };
  }

  return {
    metadata: {
      month:
        monthKey,

      createdAtUtc:
        existingData.metadata
          ?.createdAtUtc ||
        new Date().toISOString(),

      updatedAtUtc:
        new Date().toISOString()
    },

    records:
      Array.isArray(
        existingData.records
      )
        ? existingData.records
        : []
  };
}

function isDuplicateRecord(
  records,
  newRecord
) {
  if (newRecord.responseId) {
    return records.some(
      record =>
        record.responseId ===
        newRecord.responseId
    );
  }

  return records.some(
    record =>
      record.generatedAtUtc ===
        newRecord.generatedAtUtc &&
      record.model ===
        newRecord.model &&
      record.usage?.totalTokens ===
        newRecord.usage.totalTokens
  );
}

function appendUsageRecord(
  monthlyData,
  usageRecord
) {
  if (
    isDuplicateRecord(
      monthlyData.records,
      usageRecord
    )
  ) {
    return {
      added: false,
      reason:
        'This OpenAI response is already recorded.'
    };
  }

  monthlyData.records.push(
    usageRecord
  );

  monthlyData.records.sort(
    (first, second) =>
      new Date(
        first.generatedAtUtc
      ) -
      new Date(
        second.generatedAtUtc
      )
  );

  monthlyData.metadata.updatedAtUtc =
    new Date().toISOString();

  return {
    added: true,
    reason:
      'Usage record added.'
  };
}

function calculateTotals(records) {
  return records.reduce(
    (totals, record) => {
      totals.requests += 1;

      totals.inputTokens +=
        toNumber(
          record.usage
            ?.inputTokens
        );

      totals.outputTokens +=
        toNumber(
          record.usage
            ?.outputTokens
        );

      totals.totalTokens +=
        toNumber(
          record.usage
            ?.totalTokens
        );

      totals.durationMs +=
        toNumber(
          record.durationMs
        );

      return totals;
    },
    {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      durationMs: 0
    }
  );
}

function buildDailyBreakdown(records) {
  const days = {};

  records.forEach(record => {
    const day =
      record.day ||
      getDayKey(
        new Date(
          record.generatedAtUtc
        )
      );

    if (!days[day]) {
      days[day] = {
        date:
          day,

        requests: 0,

        inputTokens: 0,

        outputTokens: 0,

        totalTokens: 0,

        durationMs: 0
      };
    }

    days[day].requests += 1;

    days[day].inputTokens +=
      toNumber(
        record.usage
          ?.inputTokens
      );

    days[day].outputTokens +=
      toNumber(
        record.usage
          ?.outputTokens
      );

    days[day].totalTokens +=
      toNumber(
        record.usage
          ?.totalTokens
      );

    days[day].durationMs +=
      toNumber(
        record.durationMs
      );
  });

  return Object.values(days)
    .sort(
      (first, second) =>
        first.date.localeCompare(
          second.date
        )
    )
    .map(day => ({
      ...day,

      averageTokensPerRequest:
        day.requests > 0
          ? Math.round(
              day.totalTokens /
              day.requests
            )
          : 0,

      averageDurationMs:
        day.requests > 0
          ? Math.round(
              day.durationMs /
              day.requests
            )
          : 0
    }));
}

function buildModelBreakdown(records) {
  const models = {};

  records.forEach(record => {
    const model =
      record.model || 'unknown';

    if (!models[model]) {
      models[model] = {
        model,

        requests: 0,

        inputTokens: 0,

        outputTokens: 0,

        totalTokens: 0
      };
    }

    models[model].requests += 1;

    models[model].inputTokens +=
      toNumber(
        record.usage
          ?.inputTokens
      );

    models[model].outputTokens +=
      toNumber(
        record.usage
          ?.outputTokens
      );

    models[model].totalTokens +=
      toNumber(
        record.usage
          ?.totalTokens
      );
  });

  return Object.values(models)
    .sort(
      (first, second) =>
        second.totalTokens -
        first.totalTokens
    );
}

function buildClassificationBreakdown(
  records
) {
  const classifications = {};

  records.forEach(record => {
    const classification =
      record.result
        ?.classification ||
      'unknown';

    classifications[
      classification
    ] =
      (
        classifications[
          classification
        ] || 0
      ) + 1;
  });

  return Object.entries(
    classifications
  )
    .map(
      ([
        classification,
        count
      ]) => ({
        classification,
        count
      })
    )
    .sort(
      (first, second) =>
        second.count -
        first.count
    );
}

function buildUsageSummary(
  monthlyData
) {
  const records =
    monthlyData.records;

  const totals =
    calculateTotals(
      records
    );

  return {
    generatedAtUtc:
      new Date().toISOString(),

    month:
      monthlyData.metadata.month,

    totals: {
      ...totals,

      averageTokensPerRequest:
        totals.requests > 0
          ? Math.round(
              totals.totalTokens /
              totals.requests
            )
          : 0,

      averageDurationMs:
        totals.requests > 0
          ? Math.round(
              totals.durationMs /
              totals.requests
            )
          : 0
    },

    daily:
      buildDailyBreakdown(
        records
      ),

    models:
      buildModelBreakdown(
        records
      ),

    classifications:
      buildClassificationBreakdown(
        records
      )
  };
}

function printSummary({
  usageRecord,
  monthlyData,
  summary,
  appendResult,
  monthlyFile
}) {
  console.log(
    '\n📊 QA Sentinel AI Usage Tracker'
  );

  console.log(
    appendResult.added
      ? '✅ Usage record added'
      : '⏭ Usage record already exists'
  );

  console.log(
    `🧠 Model: ${usageRecord.model}`
  );

  console.log(
    `📥 Input tokens: ` +
    `${usageRecord.usage.inputTokens}`
  );

  console.log(
    `📤 Output tokens: ` +
    `${usageRecord.usage.outputTokens}`
  );

  console.log(
    `🔢 Total tokens: ` +
    `${usageRecord.usage.totalTokens}`
  );

  console.log(
    `📅 Monthly requests: ` +
    `${summary.totals.requests}`
  );

  console.log(
    `📈 Monthly tokens: ` +
    `${summary.totals.totalTokens}`
  );

  console.log(
    `📊 Average tokens/request: ` +
    `${summary.totals.averageTokensPerRequest}`
  );

  console.log(
    `📄 Monthly usage: ${monthlyFile}`
  );

  console.log(
    `📋 Summary: ${LATEST_SUMMARY_FILE}`
  );

  console.log(
    `🗂 Stored records: ` +
    `${monthlyData.records.length}`
  );
}

function main() {
  assertFileExists(
    AI_REVIEW_OUTPUT_FILE,
    'AI review output'
  );

  ensureUsageDirectory();

  const aiReviewOutput =
    readJsonFile(
      AI_REVIEW_OUTPUT_FILE
    );

  const usageRecord =
    buildUsageRecord(
      aiReviewOutput
    );

  const monthlyFile =
    getMonthlyUsageFile(
      usageRecord.month
    );

  const existingMonthlyData =
    readJsonFile(
      monthlyFile,
      null
    );

  const monthlyData =
    normalizeMonthlyData(
      existingMonthlyData,
      usageRecord.month
    );

  const appendResult =
    appendUsageRecord(
      monthlyData,
      usageRecord
    );

  writeJsonFile(
    monthlyFile,
    monthlyData
  );

  const summary =
    buildUsageSummary(
      monthlyData
    );

  writeJsonFile(
    LATEST_SUMMARY_FILE,
    summary
  );

  printSummary({
    usageRecord,
    monthlyData,
    summary,
    appendResult,
    monthlyFile
  });
}

try {
  main();
} catch (error) {
  console.error(
    '\n❌ AI Usage Tracker failed.'
  );

  console.error(
    `Message: ${error.message}`
  );

  process.exit(1);
}