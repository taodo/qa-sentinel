const fs = require('fs');
const path = require('path');
const { z } = require('zod');

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

const OUTPUT_DIRECTORY = path.join(
  ROOT,
  'reports',
  'ai'
);

const VALIDATED_OUTPUT_FILE = path.join(
  OUTPUT_DIRECTORY,
  'validated-ai-review-latest.json'
);

const ALLOWED_CLASSIFICATIONS = [
  'normal_variation',
  'provider_issue',
  'payment_issue',
  'frontend_issue',
  'mobile_issue',
  'backend_issue',
  'analytics_delay',
  'splunk_delay',
  'low_traffic_noise',
  'broad_incident',
  'unknown'
];

const SEVERITY_RANK = {
  ATTENTION: 1,
  WARNING: 2,
  CRITICAL: 3
};


/*
 * ============================================================
 * REQUIRED METRICS
 * ============================================================
 */

const REQUIRED_METRICS = [
  {
    monitor: 'Spin',
    metric: 'total_spins'
  },
  {
    monitor: 'Purchase',
    metric: 'total_responses'
  },
  {
    monitor: 'Signup',
    metric: 'total_signups'
  },
  {
    monitor: 'Login',
    metric: 'total_logins'
  },
  {
    monitor: 'Redemption',
    metric: 'total_events'
  },
  {
    monitor: 'Quest',
    metric: 'completed_quests'
  }
];


/*
 * ============================================================
 * FINDING SCHEMA
 * ============================================================
 */

const FindingSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(300),

  monitor: z
    .string()
    .trim()
    .min(1)
    .max(100),

  severity: z.enum([
    'ATTENTION',
    'WARNING',
    'CRITICAL'
  ]),

  confidence: z
    .number()
    .int()
    .min(0)
    .max(100),

  classification: z.enum(
    ALLOWED_CLASSIFICATIONS
  ),

  evidence: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(500)
    )
    .max(4),

  possibleCauses: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(500)
    )
    .max(3),

  recommendedActions: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(500)
    )
    .max(3)
});


/*
 * ============================================================
 * METRIC SCHEMA
 * ============================================================
 */

const MetricSchema = z.object({
  monitor: z
    .string()
    .trim()
    .min(1)
    .max(100),

  metric: z
    .string()
    .trim()
    .min(1)
    .max(100),

  current: z
    .number()
    .nullable(),

  previous: z
    .number()
    .nullable(),

  yesterday: z
    .number()
    .nullable(),

  twoDaysAgo: z
    .number()
    .nullable(),

  assessment: z
    .string()
    .trim()
    .min(1)
    .max(100)
});


/*
 * ============================================================
 * REVIEW SCHEMA
 *
 * IMPORTANT:
 * ai-reviewer.js currently writes the review object directly.
 *
 * Therefore the validator must validate:
 *
 * {
 *   overallAssessment: {...},
 *   metrics: [...],
 *   findings: [...],
 *   globalRecommendations: [...]
 * }
 *
 * NOT:
 *
 * {
 *   metadata: {...},
 *   review: {...}
 * }
 * ============================================================
 */

const ReviewSchema = z.object({
  overallAssessment: z.object({
    classification: z.enum(
      ALLOWED_CLASSIFICATIONS
    ),

    confidence: z
      .number()
      .int()
      .min(0)
      .max(100),

    severity: z.enum([
      'ATTENTION',
      'WARNING',
      'CRITICAL'
    ]),

    shouldNotify: z.boolean(),

    summary: z
      .string()
      .trim()
      .min(1)
      .max(1000)
  }),

  metrics: z
    .array(
      MetricSchema
    )
    .length(
      REQUIRED_METRICS.length
    ),

  findings: z
    .array(
      FindingSchema
    )
    .max(4),

  globalRecommendations: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(500)
    )
    .max(4)
});


/*
 * ============================================================
 * FILE HELPERS
 * ============================================================
 */

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


function ensureOutputDirectory() {
  fs.mkdirSync(
    OUTPUT_DIRECTORY,
    {
      recursive: true
    }
  );
}


function readJsonFile(
  filePath
) {
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


function createTimestamp() {
  return new Date()
    .toISOString()
    .replace(
      /[:.]/g,
      '-'
    );
}


function normalizeComparableText(
  value
) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(
      /\s+/g,
      ' '
    );
}


function findDuplicates(
  values
) {
  const seen =
    new Set();

  const duplicates =
    new Set();

  values.forEach(
    value => {
      const normalized =
        normalizeComparableText(
          value
        );

      if (!normalized) {
        return;
      }

      if (
        seen.has(
          normalized
        )
      ) {
        duplicates.add(
          value
        );
      } else {
        seen.add(
          normalized
        );
      }
    }
  );

  return Array.from(
    duplicates
  );
}


function addIssue(
  issues,
  {
    level = 'error',
    code,
    message,
    path = null
  }
) {
  issues.push({
    level,
    code,
    message,
    path
  });
}


/*
 * ============================================================
 * METRIC BUSINESS VALIDATION
 * ============================================================
 */

function validateMetrics(
  review,
  issues
) {
  const metrics =
    review.metrics;

  if (
    !Array.isArray(metrics)
  ) {
    addIssue(
      issues,
      {
        code:
          'MISSING_METRICS',

        message:
          'AI review does not contain a metrics array.',

        path:
          'review.metrics'
      }
    );

    return;
  }

  if (
    metrics.length !==
    REQUIRED_METRICS.length
  ) {
    addIssue(
      issues,
      {
        code:
          'INVALID_METRIC_COUNT',

        message:
          `AI review must contain exactly ` +
          `${REQUIRED_METRICS.length} metrics, ` +
          `but received ${metrics.length}.`,

        path:
          'review.metrics'
      }
    );

    return;
  }

  REQUIRED_METRICS.forEach(
    (
      required,
      index
    ) => {
      const metric =
        metrics[index];

      const expectedPath =
        `review.metrics.${index}`;

      if (
        metric.monitor !==
        required.monitor
      ) {
        addIssue(
          issues,
          {
            code:
              'INVALID_METRIC_MONITOR',

            message:
              `Expected metric #${index + 1} to be ` +
              `${required.monitor}, but received ` +
              `${metric.monitor}.`,

            path:
              `${expectedPath}.monitor`
          }
        );
      }

      if (
        metric.metric !==
        required.metric
      ) {
        addIssue(
          issues,
          {
            code:
              'INVALID_METRIC_NAME',

            message:
              `${required.monitor} must use ` +
              `metric ${required.metric}, but received ` +
              `${metric.metric}.`,

            path:
              `${expectedPath}.metric`
          }
        );
      }
    }
  );
}


/*
 * ============================================================
 * BUSINESS RULE VALIDATION
 * ============================================================
 *
 * IMPORTANT:
 * data IS the review object.
 *
 * There is intentionally no:
 *   data.metadata
 *   data.review
 *
 * because ai-reviewer.js saves the review directly.
 * ============================================================
 */

function validateBusinessRules(
  data
) {
  const issues = [];

  const review =
    data;

  const deterministicSummary =
    review.metadata?.deterministicSummary ||
    {};

  const overall =
    review.overallAssessment;

  /*
   * Validate overall metrics first.
   */
  validateMetrics(
    review,
    issues
  );

  const deterministicCritical =
    Number(
      deterministicSummary.critical ||
      0
    );

  const deterministicWarning =
    Number(
      deterministicSummary.warning ||
      0
    );

  const deterministicAttention =
    Number(
      deterministicSummary.attention ||
      0
    );

  const highestDeterministicSeverity =
    deterministicCritical > 0
      ? 'CRITICAL'
      : deterministicWarning > 0
        ? 'WARNING'
        : deterministicAttention > 0
          ? 'ATTENTION'
          : null;


  /*
   * Safety rule:
   * deterministic CRITICAL must never be suppressed.
   *
   * NOTE:
   * Current ai-reviewer output does not expose deterministic
   * metadata. Therefore these checks remain dormant unless
   * metadata is included in the review object in the future.
   */

  if (
    deterministicCritical > 0 &&
    overall.shouldNotify !== true
  ) {
    addIssue(
      issues,
      {
        code:
          'CRITICAL_SUPPRESSED',

        message:
          'Deterministic CRITICAL alerts exist, but shouldNotify is false.',

        path:
          'review.overallAssessment.shouldNotify'
      }
    );
  }


  if (
    deterministicCritical > 0 &&
    overall.severity !==
      'CRITICAL'
  ) {
    addIssue(
      issues,
      {
        code:
          'CRITICAL_SEVERITY_DOWNGRADED',

        message:
          'Overall severity must remain CRITICAL when deterministic CRITICAL alerts exist.',

        path:
          'review.overallAssessment.severity'
      }
    );
  }


  /*
   * AI may not lower overall severity
   * below deterministic severity.
   */

  if (
    highestDeterministicSeverity &&
    SEVERITY_RANK[
      overall.severity
    ] <
    SEVERITY_RANK[
      highestDeterministicSeverity
    ]
  ) {
    addIssue(
      issues,
      {
        code:
          'OVERALL_SEVERITY_TOO_LOW',

        message:
          `Overall severity ${overall.severity} ` +
          `is lower than deterministic severity ` +
          `${highestDeterministicSeverity}.`,

        path:
          'review.overallAssessment.severity'
      }
    );
  }


  /*
   * Review should normally contain at least
   * one finding when alerts exist.
   */

  if (
    Number(
      deterministicSummary.totalAlerts ||
      0
    ) > 0 &&
    review.findings.length === 0
  ) {
    addIssue(
      issues,
      {
        code:
          'MISSING_FINDINGS',

        message:
          'Alerts exist, but the AI review contains no findings.',

        path:
          'review.findings'
      }
    );
  }


  /*
   * Overall CRITICAL should generally have
   * at least one CRITICAL finding.
   */

  if (
    overall.severity ===
      'CRITICAL' &&
    !review.findings.some(
      finding =>
        finding.severity ===
        'CRITICAL'
    )
  ) {
    addIssue(
      issues,
      {
        code:
          'NO_CRITICAL_FINDING',

        message:
          'Overall severity is CRITICAL, but no finding has CRITICAL severity.',

        path:
          'review.findings'
      }
    );
  }


  /*
   * Summary length warning.
   */

  if (
    overall.summary.length >
    500
  ) {
    addIssue(
      issues,
      {
        level:
          'warning',

        code:
          'SUMMARY_LONG',

        message:
          `Overall summary is ${overall.summary.length} characters; keep it under 500 where possible.`,

        path:
          'review.overallAssessment.summary'
      }
    );
  }


  /*
   * Confidence and classification consistency.
   */

  if (
    overall.classification ===
      'broad_incident' &&
    overall.confidence < 60
  ) {
    addIssue(
      issues,
      {
        level:
          'warning',

        code:
          'LOW_CONFIDENCE_BROAD_INCIDENT',

        message:
          'Classification is broad_incident, but confidence is below 60.',

        path:
          'review.overallAssessment'
      }
    );
  }


  if (
    overall.classification ===
      'normal_variation' &&
    overall.confidence >= 90 &&
    deterministicCritical > 0
  ) {
    addIssue(
      issues,
      {
        level:
          'warning',

        code:
          'NORMAL_VARIATION_WITH_CRITICAL',

        message:
          'High-confidence normal_variation conflicts with deterministic CRITICAL alerts.',

        path:
          'review.overallAssessment'
      }
    );
  }


  /*
   * Duplicate finding titles.
   */

  const duplicateTitles =
    findDuplicates(
      review.findings.map(
        finding =>
          finding.title
      )
    );

  duplicateTitles.forEach(
    title => {
      addIssue(
        issues,
        {
          level:
            'warning',

          code:
            'DUPLICATE_FINDING_TITLE',

          message:
            `Duplicate finding title: ${title}`,

          path:
            'review.findings'
        }
      );
    }
  );


  /*
   * Per-finding checks.
   */

  review.findings.forEach(
    (
      finding,
      findingIndex
    ) => {
      const basePath =
        `review.findings.${findingIndex}`;

      if (
        finding.evidence.length ===
        0
      ) {
        addIssue(
          issues,
          {
            code:
              'FINDING_WITHOUT_EVIDENCE',

            message:
              `Finding "${finding.title}" has no evidence.`,

            path:
              `${basePath}.evidence`
          }
        );
      }

      if (
        finding.recommendedActions
          .length ===
        0
      ) {
        addIssue(
          issues,
          {
            level:
              'warning',

            code:
              'FINDING_WITHOUT_ACTION',

            message:
              `Finding "${finding.title}" has no recommended actions.`,

            path:
              `${basePath}.recommendedActions`
          }
        );
      }

      const duplicateEvidence =
        findDuplicates(
          finding.evidence
        );

      duplicateEvidence.forEach(
        evidence => {
          addIssue(
            issues,
            {
              level:
                'warning',

              code:
                'DUPLICATE_EVIDENCE_WITHIN_FINDING',

              message:
                `Finding "${finding.title}" repeats evidence: ${evidence}`,

              path:
                `${basePath}.evidence`
            }
          );
        }
      );

      const duplicateActions =
        findDuplicates(
          finding.recommendedActions
        );

      duplicateActions.forEach(
        action => {
          addIssue(
            issues,
            {
              level:
                'warning',

              code:
                'DUPLICATE_ACTION_WITHIN_FINDING',

              message:
                `Finding "${finding.title}" repeats an action: ${action}`,

              path:
                `${basePath}.recommendedActions`
            }
          );
        }
      );
    }
  );


  /*
   * Repeated evidence across findings.
   */

  const evidenceOwners =
    new Map();

  review.findings.forEach(
    (
      finding,
      findingIndex
    ) => {
      finding.evidence.forEach(
        evidence => {
          const normalized =
            normalizeComparableText(
              evidence
            );

          if (!normalized) {
            return;
          }

          if (
            !evidenceOwners.has(
              normalized
            )
          ) {
            evidenceOwners.set(
              normalized,
              []
            );
          }

          evidenceOwners
            .get(normalized)
            .push({
              findingIndex,
              title:
                finding.title,
              evidence
            });
        }
      );
    }
  );

  evidenceOwners.forEach(
    owners => {
      if (
        owners.length <= 1
      ) {
        return;
      }

      addIssue(
        issues,
        {
          level:
            'warning',

          code:
            'EVIDENCE_REPEATED_ACROSS_FINDINGS',

          message:
            `The same evidence appears in multiple findings: ${
              owners
                .map(
                  owner =>
                    owner.title
                )
                .join(', ')
            }`,

          path:
            'review.findings'
        }
      );
    }
  );


  /*
   * Duplicate global recommendations.
   */

  const duplicateGlobalRecommendations =
    findDuplicates(
      review.globalRecommendations
    );

  duplicateGlobalRecommendations.forEach(
    recommendation => {
      addIssue(
        issues,
        {
          level:
            'warning',

          code:
            'DUPLICATE_GLOBAL_RECOMMENDATION',

          message:
            `Duplicate global recommendation: ${recommendation}`,

          path:
            'review.globalRecommendations'
        }
      );
    }
  );


  /*
   * IMPORTANT:
   *
   * Token metadata validation was removed.
   *
   * Current ai-reviewer.js output does not contain:
   *
   * metadata.usage.inputTokens
   * metadata.usage.outputTokens
   * metadata.usage.totalTokens
   *
   * Keeping that check would cause the validator to fail with:
   *
   * data.metadata is undefined
   * ============================================================
   */

  return issues;
}


/*
 * ============================================================
 * VALIDATION SCORE
 * ============================================================
 */

function calculateValidationScore(
  issues
) {
  let score = 100;

  issues.forEach(
    issue => {
      if (
        issue.level ===
        'error'
      ) {
        score -= 15;
      } else {
        score -= 4;
      }
    }
  );

  return Math.max(
    0,
    score
  );
}


/*
 * ============================================================
 * VALIDATION RESULT
 * ============================================================
 */

function buildValidationResult(
  data,
  issues
) {
  const errors =
    issues.filter(
      issue =>
        issue.level ===
        'error'
    );

  const warnings =
    issues.filter(
      issue =>
        issue.level ===
        'warning'
    );

  const score =
    calculateValidationScore(
      issues
    );

  return {
    validation: {
      valid:
        errors.length === 0,

      score,

      checkedAtUtc:
        new Date().toISOString(),

      sourceFile:
        path.relative(
          ROOT,
          AI_REVIEW_OUTPUT_FILE
        ),

      summary: {
        errors:
          errors.length,

        warnings:
          warnings.length,

        totalIssues:
          issues.length
      },

      issues
    },

    /*
     * Preserve the complete AI review.
     *
     * This includes:
     * - overallAssessment
     * - metrics
     * - findings
     * - globalRecommendations
     */
    review:
      data
  };
}


function saveValidationResult(
  result
) {
  ensureOutputDirectory();

  const archivedFile =
    path.join(
      OUTPUT_DIRECTORY,
      `validated-ai-review-${createTimestamp()}.json`
    );

  const serialized =
    JSON.stringify(
      result,
      null,
      2
    );

  fs.writeFileSync(
    VALIDATED_OUTPUT_FILE,
    serialized,
    'utf8'
  );

  fs.writeFileSync(
    archivedFile,
    serialized,
    'utf8'
  );

  return {
    latest:
      VALIDATED_OUTPUT_FILE,

    archived:
      archivedFile
  };
}


/*
 * ============================================================
 * CONSOLE SUMMARY
 * ============================================================
 */

function printValidationSummary(
  result,
  outputPaths
) {
  const validation =
    result.validation;

  console.log(
    '\n🛡 QA Sentinel AI Validator'
  );

  console.log(
    `Status: ${
      validation.valid
        ? '✅ VALID'
        : '❌ INVALID'
    }`
  );

  console.log(
    `Score: ${validation.score}/100`
  );

  console.log(
    `Errors: ${validation.summary.errors}`
  );

  console.log(
    `Warnings: ${validation.summary.warnings}`
  );

  console.log(
    `Metrics: ${
      result.review?.metrics?.length ??
      0
    }`
  );

  if (
    validation.issues.length > 0
  ) {
    console.log(
      '\nValidation issues:'
    );

    validation.issues.forEach(
      issue => {
        const icon =
          issue.level ===
          'error'
            ? '❌'
            : '⚠️';

        console.log(
          `${icon} [${issue.code}] ${issue.message}`
        );
      }
    );
  }

  console.log(
    `\n📄 Latest: ${outputPaths.latest}`
  );

  console.log(
    `📦 Archive: ${outputPaths.archived}`
  );
}


/*
 * ============================================================
 * MAIN
 * ============================================================
 */

function main() {
  assertFileExists(
    AI_REVIEW_OUTPUT_FILE,
    'AI review output'
  );

  const rawData =
    readJsonFile(
      AI_REVIEW_OUTPUT_FILE
    );

  /*
   * IMPORTANT:
   *
   * Validate rawData directly.
   *
   * ai-reviewer.js saves the Review object directly,
   * not a { metadata, review } wrapper.
   */
  const schemaResult =
    ReviewSchema.safeParse(
      rawData
    );

  if (
    !schemaResult.success
  ) {
    const issues =
      schemaResult.error.issues.map(
        issue => ({
          level:
            'error',

          code:
            'SCHEMA_VALIDATION_FAILED',

          path:
            issue.path.join('.'),

          message:
            `${
              issue.path.join('.') ||
              'root'
            }: ${issue.message}`
        })
      );

    const fallbackResult = {
      validation: {
        valid:
          false,

        score:
          calculateValidationScore(
            issues
          ),

        checkedAtUtc:
          new Date().toISOString(),

        sourceFile:
          path.relative(
            ROOT,
            AI_REVIEW_OUTPUT_FILE
          ),

        summary: {
          errors:
            issues.length,

          warnings:
            0,

          totalIssues:
            issues.length
        },

        issues
      },

      rawOutput:
        rawData
    };

    const outputPaths =
      saveValidationResult(
        fallbackResult
      );

    printValidationSummary(
      fallbackResult,
      outputPaths
    );

    process.exit(1);
  }

  const validatedData =
    schemaResult.data;

  const businessRuleIssues =
    validateBusinessRules(
      validatedData
    );

  const result =
    buildValidationResult(
      validatedData,
      businessRuleIssues
    );

  const outputPaths =
    saveValidationResult(
      result
    );

  printValidationSummary(
    result,
    outputPaths
  );

  if (
    !result.validation.valid
  ) {
    process.exit(1);
  }
}


try {
  main();
} catch (error) {
  console.error(
    '\n❌ AI Validator failed.'
  );

  console.error(
    `Message: ${error.message}`
  );

  process.exit(1);
}