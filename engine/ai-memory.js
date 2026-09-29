const fs = require('fs');
const path = require('path');

const ROOT = path.join(
  __dirname,
  '..'
);

const VALIDATED_REVIEW_FILE = path.join(
  ROOT,
  'reports',
  'ai',
  'validated-ai-review-latest.json'
);

const HISTORY_DIRECTORY = path.join(
  ROOT,
  'reports',
  'ai',
  'history'
);

const HISTORY_FILE = path.join(
  HISTORY_DIRECTORY,
  'ai-review-history.jsonl'
);

const LATEST_MEMORY_FILE = path.join(
  HISTORY_DIRECTORY,
  'ai-memory-latest.json'
);

function ensureHistoryDirectory() {
  fs.mkdirSync(
    HISTORY_DIRECTORY,
    {
      recursive: true
    }
  );
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `File not found: ${filePath}`
    );
  }

  const raw = fs
    .readFileSync(
      filePath,
      'utf8'
    )
    .trim();

  if (!raw) {
    throw new Error(
      `File is empty: ${filePath}`
    );
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${filePath}: ${error.message}`
    );
  }
}

function normalizeArray(value) {
  return Array.isArray(value)
    ? value
    : [];
}

function compactFinding(finding) {
  return {
    monitor:
      finding.monitor || null,

    classification:
      finding.classification || null,

    severity:
      finding.severity || null,

    confidence:
      Number(
        finding.confidence || 0
      ),

    title:
      finding.title || null,

    evidence:
      normalizeArray(
        finding.evidence
      ).slice(0, 4),

    possibleCauses:
      normalizeArray(
        finding.possibleCauses
      ).slice(0, 3),

    recommendedActions:
      normalizeArray(
        finding.recommendedActions
      ).slice(0, 3)
  };
}

function buildMemoryEntry(data) {
  const review =
    data.review || {};

  const overall =
    review.overallAssessment || {};

  const metadata =
    data.metadata || {};

  const deterministic =
    metadata.deterministicSummary || {};

  return {
    memoryVersion: 1,

    createdAtUtc:
      new Date().toISOString(),

    reviewGeneratedAtUtc:
      metadata.generatedAtUtc ||
      null,

    responseId:
      metadata.responseId ||
      null,

    model:
      metadata.model ||
      null,

    validation: {
      valid:
        data.validation?.valid === true,

      score:
        data.validation?.score ?? null
    },

    monitoringContext: {
      totalAlerts:
        Number(
          deterministic.totalAlerts || 0
        ),

      critical:
        Number(
          deterministic.critical || 0
        ),

      warning:
        Number(
          deterministic.warning || 0
        ),

      attention:
        Number(
          deterministic.attention || 0
        ),

      affectedMonitors:
        normalizeArray(
          deterministic.affectedMonitors
        ),

      affectedProviders:
        normalizeArray(
          deterministic.affectedProviders
        ),

      affectedPlatforms:
        normalizeArray(
          deterministic.affectedPlatforms
        )
    },

    overallAssessment: {
      classification:
        overall.classification ||
        null,

      severity:
        overall.severity ||
        null,

      confidence:
        Number(
          overall.confidence || 0
        ),

      shouldNotify:
        overall.shouldNotify === true,

      summary:
        overall.summary ||
        null
    },

    findings:
      normalizeArray(
        review.findings
      ).map(
        compactFinding
      ),

    globalRecommendations:
      normalizeArray(
        review.globalRecommendations
      ),

    /*
     * Human feedback fields.
     *
     * These are intentionally empty for now.
     * Later QA can enrich historical memory
     * with the actual outcome.
     */
    feedback: {
      outcome:
        null,

      confirmedClassification:
        null,

      resolution:
        null,

      notes:
        null
    }
  };
}

function alreadyExists(
  historyContent,
  responseId
) {
  if (!responseId) {
    return false;
  }

  const lines =
    historyContent
      .split('\n')
      .filter(Boolean);

  for (const line of lines) {
    try {
      const entry =
        JSON.parse(line);

      if (
        entry.responseId ===
        responseId
      ) {
        return true;
      }
    } catch (error) {
      /*
       * Ignore malformed historical lines.
       * Do not block new memory writes.
       */
    }
  }

  return false;
}

function appendHistory(entry) {
  ensureHistoryDirectory();

  const existing =
    fs.existsSync(HISTORY_FILE)
      ? fs.readFileSync(
          HISTORY_FILE,
          'utf8'
        )
      : '';

  if (
    alreadyExists(
      existing,
      entry.responseId
    )
  ) {
    return {
      appended: false,
      reason:
        'Review already exists in history.'
    };
  }

  fs.appendFileSync(
    HISTORY_FILE,
    JSON.stringify(entry) + '\n',
    'utf8'
  );

  fs.writeFileSync(
    LATEST_MEMORY_FILE,
    JSON.stringify(
      entry,
      null,
      2
    ),
    'utf8'
  );

  return {
    appended: true
  };
}

function validateSource(data) {
  if (
    data.validation?.valid !== true
  ) {
    throw new Error(
      'Validated AI review is not valid.'
    );
  }

  if (!data.review) {
    throw new Error(
      'Validated AI review has no review object.'
    );
  }

  if (
    !data.review.overallAssessment
  ) {
    throw new Error(
      'Validated AI review has no overallAssessment.'
    );
  }
}

function main() {
  console.log(
    '\n🧠 QA Sentinel AI Memory'
  );

  const data =
    readJsonFile(
      VALIDATED_REVIEW_FILE
    );

  validateSource(data);

  const entry =
    buildMemoryEntry(data);

  const result =
    appendHistory(entry);

  if (!result.appended) {
    console.log(
      '⏭ Review already stored in history.'
    );

    console.log(
      `Reason: ${result.reason}`
    );

    return;
  }

  console.log(
    '✅ AI review stored in history.'
  );

  console.log(
    `📄 History: ${HISTORY_FILE}`
  );

  console.log(
    `📌 Latest memory: ${LATEST_MEMORY_FILE}`
  );

  console.log(
    `🔎 Findings stored: ${entry.findings.length}`
  );

  console.log(
    `📌 Classification: ` +
    `${entry.overallAssessment.classification}`
  );

  console.log(
    `🎯 Confidence: ` +
    `${entry.overallAssessment.confidence}%`
  );
}

try {
  main();
} catch (error) {
  console.error(
    '\n❌ AI Memory failed.'
  );

  console.error(
    `Message: ${error.message}`
  );

  process.exit(1);
}