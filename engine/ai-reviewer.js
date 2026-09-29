const fs = require('fs');
const path = require('path');
const https = require('https');

require('dotenv').config({
  path: path.join(
    __dirname,
    '..',
    '.env'
  )
});

const { z } = require('zod');

const ROOT = path.join(
  __dirname,
  '..'
);

const PROMPT_FILE = path.join(
  ROOT,
  'reports',
  'ai',
  'ai-prompt-latest.md'
);

const AI_INPUT_FILE = path.join(
  ROOT,
  'reports',
  'ai',
  'ai-review-input-latest.json'
);

const OUTPUT_DIRECTORY = path.join(
  ROOT,
  'reports',
  'ai'
);

const DEBUG_DIRECTORY = path.join(
  OUTPUT_DIRECTORY,
  'debug'
);

const LATEST_OUTPUT_FILE = path.join(
  OUTPUT_DIRECTORY,
  'ai-review-output-latest.json'
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


/*
 * ============================================================
 * REQUIRED OVERALL METRICS
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
 * ZOD SCHEMA
 * ============================================================
 */

const AiReviewSchema = z.object({
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
      z.object({
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
      })
    )
    .length(
      REQUIRED_METRICS.length
    ),

  findings: z
    .array(
      z.object({
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
      })
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
 * OPENAI STRUCTURED OUTPUT JSON SCHEMA
 * ============================================================
 */

const AI_REVIEW_JSON_SCHEMA = {
  type: 'object',

  additionalProperties: false,

  properties: {
    overallAssessment: {
      type: 'object',

      additionalProperties: false,

      properties: {
        classification: {
          type: 'string',
          enum: ALLOWED_CLASSIFICATIONS
        },

        confidence: {
          type: 'integer',
          minimum: 0,
          maximum: 100
        },

        severity: {
          type: 'string',
          enum: [
            'ATTENTION',
            'WARNING',
            'CRITICAL'
          ]
        },

        shouldNotify: {
          type: 'boolean'
        },

        summary: {
          type: 'string',
          minLength: 1,
          maxLength: 1000
        }
      },

      required: [
        'classification',
        'confidence',
        'severity',
        'shouldNotify',
        'summary'
      ]
    },

    metrics: {
      type: 'array',

      minItems:
        REQUIRED_METRICS.length,

      maxItems:
        REQUIRED_METRICS.length,

      items: {
        type: 'object',

        additionalProperties: false,

        properties: {
          monitor: {
            type: 'string',
            minLength: 1,
            maxLength: 100
          },

          metric: {
            type: 'string',
            minLength: 1,
            maxLength: 100
          },

          current: {
            type: [
              'number',
              'null'
            ]
          },

          previous: {
            type: [
              'number',
              'null'
            ]
          },

          yesterday: {
            type: [
              'number',
              'null'
            ]
          },

          twoDaysAgo: {
            type: [
              'number',
              'null'
            ]
          },

          assessment: {
            type: 'string',
            minLength: 1,
            maxLength: 100
          }
        },

        required: [
          'monitor',
          'metric',
          'current',
          'previous',
          'yesterday',
          'twoDaysAgo',
          'assessment'
        ]
      }
    },

    findings: {
      type: 'array',

      maxItems: 4,

      items: {
        type: 'object',

        additionalProperties: false,

        properties: {
          title: {
            type: 'string',
            minLength: 1,
            maxLength: 300
          },

          monitor: {
            type: 'string',
            minLength: 1,
            maxLength: 100
          },

          severity: {
            type: 'string',
            enum: [
              'ATTENTION',
              'WARNING',
              'CRITICAL'
            ]
          },

          confidence: {
            type: 'integer',
            minimum: 0,
            maximum: 100
          },

          classification: {
            type: 'string',
            enum: ALLOWED_CLASSIFICATIONS
          },

          evidence: {
            type: 'array',

            maxItems: 4,

            items: {
              type: 'string',
              minLength: 1,
              maxLength: 500
            }
          },

          possibleCauses: {
            type: 'array',

            maxItems: 3,

            items: {
              type: 'string',
              minLength: 1,
              maxLength: 500
            }
          },

          recommendedActions: {
            type: 'array',

            maxItems: 3,

            items: {
              type: 'string',
              minLength: 1,
              maxLength: 500
            }
          }
        },

        required: [
          'title',
          'monitor',
          'severity',
          'confidence',
          'classification',
          'evidence',
          'possibleCauses',
          'recommendedActions'
        ]
      }
    },

    globalRecommendations: {
      type: 'array',

      maxItems: 4,

      items: {
        type: 'string',
        minLength: 1,
        maxLength: 500
      }
    }
  },

  required: [
    'overallAssessment',
    'metrics',
    'findings',
    'globalRecommendations'
  ]
};
const GEMINI_AI_REVIEW_SCHEMA = {
  type: 'OBJECT',

  properties: {
    overallAssessment: {
      type: 'OBJECT',
      properties: {
        classification: {
          type: 'STRING',
          enum: ALLOWED_CLASSIFICATIONS
        },

        confidence: {
          type: 'INTEGER',
          minimum: 0,
          maximum: 100
        },

        severity: {
          type: 'STRING',
          enum: [
            'ATTENTION',
            'WARNING',
            'CRITICAL'
          ]
        },

        shouldNotify: {
          type: 'BOOLEAN'
        },

        summary: {
          type: 'STRING'
        }
      },

      required: [
        'classification',
        'confidence',
        'severity',
        'shouldNotify',
        'summary'
      ]
    },

    metrics: {
      type: 'ARRAY',

      minItems: 6,
      maxItems: 6,

      items: {
        type: 'OBJECT',

        properties: {
          monitor: {
            type: 'STRING'
          },

          metric: {
            type: 'STRING'
          },

          current: {
            type: 'NUMBER',
            nullable: true
          },

          previous: {
            type: 'NUMBER',
            nullable: true
          },

          yesterday: {
            type: 'NUMBER',
            nullable: true
          },

          twoDaysAgo: {
            type: 'NUMBER',
            nullable: true
          },

          assessment: {
            type: 'STRING'
          }
        },

        required: [
          'monitor',
          'metric',
          'current',
          'previous',
          'yesterday',
          'twoDaysAgo',
          'assessment'
        ]
      }
    },

    findings: {
      type: 'ARRAY',

      maxItems: 4,

      items: {
        type: 'OBJECT',

        properties: {
          title: {
            type: 'STRING'
          },

          monitor: {
            type: 'STRING'
          },

          severity: {
            type: 'STRING',
            enum: [
              'ATTENTION',
              'WARNING',
              'CRITICAL'
            ]
          },

          confidence: {
            type: 'INTEGER',
            minimum: 0,
            maximum: 100
          },

          classification: {
            type: 'STRING',
            enum: ALLOWED_CLASSIFICATIONS
          },

          evidence: {
            type: 'ARRAY',
            maxItems: 4,
            items: {
              type: 'STRING'
            }
          },

          possibleCauses: {
            type: 'ARRAY',
            maxItems: 3,
            items: {
              type: 'STRING'
            }
          },

          recommendedActions: {
            type: 'ARRAY',
            maxItems: 3,
            items: {
              type: 'STRING'
            }
          }
        },

        required: [
          'title',
          'monitor',
          'severity',
          'confidence',
          'classification',
          'evidence',
          'possibleCauses',
          'recommendedActions'
        ]
      }
    },

    globalRecommendations: {
      type: 'ARRAY',

      maxItems: 4,

      items: {
        type: 'STRING'
      }
    }
  },

  required: [
    'overallAssessment',
    'metrics',
    'findings',
    'globalRecommendations'
  ]
};

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


function readTextFile(
  filePath
) {
  return fs
    .readFileSync(
      filePath,
      'utf8'
    )
    .trim();
}


function readJsonFile(
  filePath
) {
  const raw =
    readTextFile(
      filePath
    );

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${filePath}: ` +
      error.message
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

  fs.mkdirSync(
    DEBUG_DIRECTORY,
    {
      recursive: true
    }
  );
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


function writeTextFile(
  filePath,
  content
) {
  fs.writeFileSync(
    filePath,
    content,
    'utf8'
  );
}


/*
 * ============================================================
 * METRIC VALIDATION
 * ============================================================
 */

function safeNumber(
  value
) {
  if (
    typeof value === 'number' &&
    Number.isFinite(value)
  ) {
    return value;
  }

  return null;
}


function normalizeReview(
  review
) {
  const normalizedMetrics =
    Array.isArray(
      review.metrics
    )
      ? review.metrics.map(
          metric => ({
            monitor:
              String(
                metric.monitor
              ).trim(),

            metric:
              String(
                metric.metric
              ).trim(),

            current:
              safeNumber(
                metric.current
              ),

            previous:
              safeNumber(
                metric.previous
              ),

            yesterday:
              safeNumber(
                metric.yesterday
              ),

            twoDaysAgo:
              safeNumber(
                metric.twoDaysAgo
              ),

            assessment:
              String(
                metric.assessment
              ).trim()
          })
        )
      : [];

  return {
    ...review,

    metrics:
      normalizedMetrics
  };
}


function validateMetricStructure(
  metrics
) {
  if (
    !Array.isArray(metrics)
  ) {
    throw new Error(
      'AI response metrics is not an array.'
    );
  }

  if (
    metrics.length !==
    REQUIRED_METRICS.length
  ) {
    throw new Error(
      `AI response must contain exactly ` +
      `${REQUIRED_METRICS.length} metrics. ` +
      `Received ${metrics.length}.`
    );
  }

  REQUIRED_METRICS.forEach(
    (
      required,
      index
    ) => {
      const metric =
        metrics[index];

      if (
        metric.monitor !==
        required.monitor
      ) {
        throw new Error(
          `Metric #${index + 1} must be ` +
          `${required.monitor}, received ` +
          `${metric.monitor}.`
        );
      }

      if (
        metric.metric !==
        required.metric
      ) {
        throw new Error(
          `Metric ${required.monitor} must use ` +
          `${required.metric}, received ` +
          `${metric.metric}.`
        );
      }
    }
  );
}


function validateReview(
  review
) {
  const normalized =
    normalizeReview(
      review
    );

  const validated =
    AiReviewSchema.parse(
      normalized
    );

  validateMetricStructure(
    validated.metrics
  );

  return validated;
}


/*
 * ============================================================
 * JSON EXTRACTION
 * ============================================================
 */

function extractJson(
  outputText
) {
  const text =
    String(
      outputText || ''
    ).trim();

  if (!text) {
    throw new Error(
      'AI response is empty'
    );
  }

  try {
    return JSON.parse(
      text
    );
  } catch (error) {
    // Continue below.
  }

  const firstBrace =
    text.indexOf('{');

  const lastBrace =
    text.lastIndexOf('}');

  if (
    firstBrace === -1 ||
    lastBrace === -1 ||
    lastBrace <= firstBrace
  ) {
    throw new Error(
      'AI response does not contain a JSON object'
    );
  }

  const jsonText =
    text.slice(
      firstBrace,
      lastBrace + 1
    );

  try {
    return JSON.parse(
      jsonText
    );
  } catch (error) {
    throw new Error(
      `Could not parse AI JSON response: ${error.message}`
    );
  }
}


function parseAndValidateReview(
  outputText
) {
  const parsed =
    extractJson(
      outputText
    );

  const validated =
    validateReview(
      parsed
    );

  return validated;
}


/*
 * ============================================================
 * DETERMINISTIC DECISION
 * ============================================================
 */

function getDeterministicReviewDecision(
  aiInput
) {
  const alerts =
    Array.isArray(
      aiInput?.alerts
    )
      ? aiInput.alerts
      : [];

  const criticalCount =
    alerts.filter(
      alert =>
        String(
          alert.severity || ''
        ).toUpperCase() ===
        'CRITICAL'
    ).length;

  const warningCount =
    alerts.filter(
      alert =>
        String(
          alert.severity || ''
        ).toUpperCase() ===
        'WARNING'
    ).length;

  const attentionCount =
    alerts.filter(
      alert =>
        String(
          alert.severity || ''
        ).toUpperCase() ===
        'ATTENTION'
    ).length;

  if (
    criticalCount > 0
  ) {
    return {
      severity: 'CRITICAL',
      shouldNotify: true,
      reason:
        'At least one CRITICAL alert exists.'
    };
  }

  if (
    warningCount > 0
  ) {
    return {
      severity: 'WARNING',
      shouldNotify: true,
      reason:
        'At least one WARNING alert exists.'
    };
  }

  if (
    attentionCount > 0
  ) {
    return {
      severity: 'ATTENTION',
      shouldNotify: true,
      reason:
        'At least one ATTENTION alert exists.'
    };
  }

  return {
    severity: 'ATTENTION',
    shouldNotify: false,
    reason:
      'No actionable alerts exist.'
  };
}


function enforceDeterministicRules(
  review,
  aiInput
) {
  const decision =
    getDeterministicReviewDecision(
      aiInput
    );

  const nextReview = {
    ...review,

    overallAssessment: {
      ...review.overallAssessment
    },

    metrics:
      review.metrics
  };

  /*
   * The deterministic monitor pipeline owns
   * severity / notification behavior.
   *
   * AI may classify and explain the situation,
   * but it must not override these values.
   */

  if (
    decision.severity ===
    'CRITICAL'
  ) {
    nextReview
      .overallAssessment
      .severity =
      'CRITICAL';

    nextReview
      .overallAssessment
      .shouldNotify =
      true;
  } else if (
    decision.severity ===
    'WARNING'
  ) {
    nextReview
      .overallAssessment
      .severity =
      'WARNING';

    nextReview
      .overallAssessment
      .shouldNotify =
      true;
  } else if (
    decision.severity ===
    'ATTENTION'
  ) {
    nextReview
      .overallAssessment
      .severity =
      'ATTENTION';

    nextReview
      .overallAssessment
      .shouldNotify =
      decision.shouldNotify;
  }

  return nextReview;
}


/*
 * ============================================================
 * SAVE OUTPUT
 * ============================================================
 */

function saveReviewOutput(
  review
) {
  ensureOutputDirectory();

  writeJsonFile(
    LATEST_OUTPUT_FILE,
    review
  );

  console.log(
    `✅ AI Review output saved: ${LATEST_OUTPUT_FILE}`
  );
}


function saveInvalidAiResponse(
  outputText,
  attempt,
  error
) {
  try {
    ensureOutputDirectory();

    const timestamp =
      new Date()
        .toISOString()
        .replace(
          /[:.]/g,
          '-'
        );

    const filePath =
      path.join(
        DEBUG_DIRECTORY,
        `invalid-ai-response-${timestamp}-attempt-${attempt}.txt`
      );

    const content = [
      'Invalid AI response',
      '',
      `CapturedAtUtc: ${new Date().toISOString()}`,
      `Attempt: ${attempt}`,
      `ParseError: ${error.message}`,
      '',
      '----- RAW RESPONSE -----',
      '',
      String(
        outputText || ''
      ),
      '',
      '----- END RAW RESPONSE -----'
    ].join('\n');

    fs.writeFileSync(
      filePath,
      content,
      'utf8'
    );

    console.log(
      `🧪 Invalid AI response saved: ${filePath}`
    );

    return filePath;
  } catch (saveError) {
    console.warn(
      `⚠️ Could not save invalid AI response: ${saveError.message}`
    );

    return null;
  }
}


/*
 * ============================================================
 * REVIEW INSTRUCTIONS
 * ============================================================
 */

function buildReviewInstructions() {
  return [
    '',
    '',
    '# REQUIRED RESPONSE STRUCTURE',
    '',
    'Return one valid JSON object using exactly this structure:',
    '',
    '{',
    '  "overallAssessment": {',
    '    "classification": "one supported classification",',
    '    "confidence": 0,',
    '    "severity": "ATTENTION | WARNING | CRITICAL",',
    '    "shouldNotify": true,',
    '    "summary": "concise assessment"',
    '  },',
    '  "metrics": [',
    '    {',
    '      "monitor": "Spin",',
    '      "metric": "total_spins",',
    '      "current": 47943,',
    '      "previous": 48743,',
    '      "yesterday": 44122,',
    '      "twoDaysAgo": 57798,',
    '      "assessment": "Stable"',
    '    }',
    '  ],',
    '  "findings": [',
    '    {',
    '      "title": "finding title",',
    '      "monitor": "monitor name or correlated monitor group",',
    '      "severity": "ATTENTION | WARNING | CRITICAL",',
    '      "confidence": 0,',
    '      "classification": "one supported classification",',
    '      "evidence": ["maximum 4 evidence items"],',
    '      "possibleCauses": ["maximum 3 possible causes"],',
    '      "recommendedActions": ["maximum 3 actions"]',
    '    }',
    '  ],',
    '  "globalRecommendations": ["maximum 4 recommendations"]',
    '}',
    '',
    '============================================================',
    'METRICS RULES',
    '============================================================',
    '',
    'The "overallMetrics" array in the AI Review Input is the authoritative source for the metrics output.',
    '',
    'Return exactly six metric entries.',
    '',
    'Required order:',
    '1. Spin',
    '2. Purchase',
    '3. Signup',
    '4. Login',
    '5. Redemption',
    '6. Quest',
    '',
    'Use these exact metric names:',
    '- Spin: total_spins',
    '- Purchase: total_responses',
    '- Signup: total_signups',
    '- Login: total_logins',
    '- Redemption: total_events',
    '- Quest: completed_quests',
    '',
    'Copy current exactly from overallMetrics.',
    'Copy previous exactly from overallMetrics.',
    'Copy yesterday exactly from overallMetrics.',
    'Copy twoDaysAgo exactly from overallMetrics.',
    '',
    'Do NOT calculate totals yourself.',
    'Do NOT sum raw records.',
    'Do NOT average values.',
    'Do NOT select an alert row as the overall monitor metric.',
    'Do NOT replace totals with completed, failed, unique users, percentages, or another sub-metric.',
    'Do NOT invent missing values.',
    'If the authoritative value is null, return null.',
    '',
    'The "assessment" field is the only metric field that should be interpreted by the AI.',
    'Keep the assessment concise, for example: Stable, Healthy, Watch, Declining, Low volume.',
    '',
    '============================================================',
    'FINDING RULES',
    '============================================================',
    '',
    'Metrics are a compact status snapshot.',
    'Detailed interpretation belongs in findings.',
    '',
    'Do not create a finding solely because a metric changed.',
    'Create findings only for meaningful signals that require attention, investigation, or action.',
    '',
    'Do not repeat the complete metrics table inside findings.',
    'Do not dump raw metric data into findings.',
    '',
    'Strict limits:',
    '- Exactly 6 metrics.',
    '- Maximum 4 findings.',
    '- Maximum 4 evidence items per finding.',
    '- Maximum 3 possible causes per finding.',
    '- Maximum 3 recommended actions per finding.',
    '- Maximum 4 global recommendations.',
    '- Group related alerts into one finding.',
    '- Do not repeat evidence across findings.',
    '',
    'Allowed classifications:',
    ALLOWED_CLASSIFICATIONS.join(', '),
    '',
    'Return JSON only.',
    'Do not use Markdown code fences.',
    'Do not add text before or after the JSON.'
  ].join('\n');
}


/*
 * ============================================================
 * OPENAI CALL
 * ============================================================
 */

// async function callOpenAi(
//   prompt,
//   attempt = 1
// ) {
//   const apiKey =
//     process.env.OPENAI_API_KEY;

//   const model =
//     process.env.OPENAI_MODEL ||
//     'gpt-5.6';

//   if (!apiKey) {
//     throw new Error(
//       'OPENAI_API_KEY is missing from .env'
//     );
//   }

//   const requestBody = {
//     model,

//     input: [
//       {
//         role: 'system',

//         content: [
//           {
//             type: 'input_text',

//             text:
//               'You are the QA Sentinel AI Reviewer. Follow the supplied QA Sentinel context and return only the required structured JSON.'
//           }
//         ]
//       },

//       {
//         role: 'user',

//         content: [
//           {
//             type: 'input_text',

//             text:
//               prompt
//           }
//         ]
//       }
//     ],

//     text: {
//       format: {
//         type: 'json_schema',

//         name:
//           'qa_sentinel_ai_review',

//         strict: true,

//         schema:
//           AI_REVIEW_JSON_SCHEMA
//       }
//     }
//   };

//   const result =
//     spawnSync(
//       process.execPath,
//       [
//         '-e',
//         `
// const https = require('https');

// const body = ${JSON.stringify(
//           JSON.stringify(
//             requestBody
//           )
//         )};

// const req = https.request(
//   {
//     hostname: 'api.openai.com',
//     path: '/v1/responses',
//     method: 'POST',

//     headers: {
//       'Authorization':
//         'Bearer ${apiKey}',

//       'Content-Type':
//         'application/json',

//       'Content-Length':
//         Buffer.byteLength(body)
//     }
//   },

//   res => {
//     let data = '';

//     res.on(
//       'data',
//       chunk => {
//         data += chunk;
//       }
//     );

//     res.on(
//       'end',
//       () => {
//         process.stdout.write(
//           JSON.stringify({
//             statusCode: res.statusCode,
//             body: data
//           })
//         );
//       }
//     );
//   }
// );

// req.on(
//   'error',
//   error => {
//     process.stdout.write(
//       JSON.stringify({
//         statusCode: 0,
//         error: error.message
//       })
//     );
//   }
// );

// req.write(body);
// req.end();
//         `
//       ],
//       {
//         encoding: 'utf8',

//         maxBuffer:
//           20 * 1024 * 1024
//       }
//     );

//   if (
//     result.error
//   ) {
//     throw result.error;
//   }

//   if (
//     result.status !== 0
//   ) {
//     throw new Error(
//       `OpenAI request process exited with code ${result.status}`
//     );
//   }

//   let response;

//   try {
//     response =
//       JSON.parse(
//         result.stdout
//       );
//   } catch (error) {
//     throw new Error(
//       `Could not parse OpenAI process response: ${error.message}`
//     );
//   }

//   if (
//     response.statusCode < 200 ||
//     response.statusCode >= 300
//   ) {
//     let message =
//       response.body ||
//       response.error ||
//       `HTTP ${response.statusCode}`;

//     try {
//       const parsed =
//         JSON.parse(
//           response.body
//         );

//       message =
//         parsed?.error?.message ||
//         message;
//     } catch (error) {
//       // Keep raw message.
//     }

//     throw new Error(
//       `OpenAI API error: ${message}`
//     );
//   }

//   let parsedBody;

//   try {
//     parsedBody =
//       JSON.parse(
//         response.body
//       );
//   } catch (error) {
//     throw new Error(
//       `Could not parse OpenAI API response body: ${error.message}`
//     );
//   }

//   return extractResponseText(
//     parsedBody
//   );
// }
async function callGemini(
  prompt,
  attempt = 1
) {
  const apiKey =
    process.env.GEMINI_API_KEY;

  const model =
    process.env.GEMINI_MODEL ||
    'gemini-3.8-flash';

  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is missing from .env'
    );
  }

  const requestBody = {
    systemInstruction: {
      parts: [
        {
          text:
            'You are the QA Sentinel AI Reviewer. Follow the supplied QA Sentinel context and return only the required structured JSON.'
        }
      ]
    },

    contents: [
      {
        role: 'user',
        parts: [
          {
            text: prompt
          }
        ]
      }
    ],

    // generationConfig: {
    //   responseMimeType: 'application/json',
    //   responseSchema:
    //     AI_REVIEW_JSON_SCHEMA
    // }
    generationConfig: {
  responseMimeType: 'application/json',
  responseSchema:
    GEMINI_AI_REVIEW_SCHEMA
}
  };

  return new Promise(
    (resolve, reject) => {
      const body =
        JSON.stringify(
          requestBody
        );

      const req =
        https.request(
          {
            hostname:
              'generativelanguage.googleapis.com',

            path:
              `/v1beta/models/${encodeURIComponent(model)}:generateContent`,

            method: 'POST',

            headers: {
              'x-goog-api-key':
                apiKey,

              'Content-Type':
                'application/json',

              'Content-Length':
                Buffer.byteLength(body)
            }
          },

          res => {
            let data = '';

            res.on(
              'data',
              chunk => {
                data += chunk;
              }
            );

            res.on(
              'end',
              () => {
                if (
                  res.statusCode < 200 ||
                  res.statusCode >= 300
                ) {
                  let message =
                    data ||
                    `HTTP ${res.statusCode}`;

                  try {
                    const parsed =
                      JSON.parse(data);

                    message =
                      parsed?.error?.message ||
                      message;
                  } catch (error) {
                    // Keep raw message.
                  }

                  reject(
                    new Error(
                      `Gemini API error: ${message}`
                    )
                  );

                  return;
                }

                let parsedBody;

                try {
                  parsedBody =
                    JSON.parse(data);
                } catch (error) {
                  reject(
                    new Error(
                      `Could not parse Gemini API response: ${error.message}`
                    )
                  );

                  return;
                }

                try {
                  resolve(
                    extractGeminiResponseText(
                      parsedBody
                    )
                  );
                } catch (error) {
                  reject(error);
                }
              }
            );
          }
        );

      req.on(
        'error',
        error => {
          reject(error);
        }
      );

      req.write(body);
      req.end();
    }
  );
}


function extractGeminiResponseText(
  response
) {
  const candidates =
    Array.isArray(
      response?.candidates
    )
      ? response.candidates
      : [];

  const textParts = [];

  for (
    const candidate of candidates
  ) {
    const parts =
      Array.isArray(
        candidate?.content?.parts
      )
        ? candidate.content.parts
        : [];

    for (
      const part of parts
    ) {
      if (
        typeof part?.text ===
        'string'
      ) {
        textParts.push(
          part.text
        );
      }
    }
  }

  if (
    textParts.length === 0
  ) {
    throw new Error(
      'Gemini response did not contain output text'
    );
  }

  return textParts.join(
    '\n'
  );
}

function extractResponseText(
  response
) {
  if (
    typeof response?.output_text ===
    'string'
  ) {
    return response.output_text;
  }

  const output =
    Array.isArray(
      response?.output
    )
      ? response.output
      : [];

  const textParts = [];

  for (
    const item of output
  ) {
    const content =
      Array.isArray(
        item?.content
      )
        ? item.content
        : [];

    for (
      const part of content
    ) {
      if (
        typeof part?.text ===
        'string'
      ) {
        textParts.push(
          part.text
        );
      }
    }
  }

  if (
    textParts.length === 0
  ) {
    throw new Error(
      'OpenAI response did not contain output text'
    );
  }

  return textParts.join(
    '\n'
  );
}


/*
 * ============================================================
 * PROMPT / INPUT
 * ============================================================
 */

function buildPrompt() {
  assertFileExists(
    PROMPT_FILE,
    'AI prompt'
  );

  return readTextFile(
    PROMPT_FILE
  );
}


function loadAiInput() {
  assertFileExists(
    AI_INPUT_FILE,
    'AI Review Input'
  );

  return readJsonFile(
    AI_INPUT_FILE
  );
}


/*
 * ============================================================
 * RETRY
 * ============================================================
 */

async function reviewWithRetry(
  prompt,
  aiInput
) {
  const maxAttempts = 2;

  let lastError = null;
  let lastRawOutput = '';

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
    try {
      console.log(
        `🤖 AI Reviewer attempt ${attempt}/${maxAttempts}`
      );

      // const output =
      //   await callOpenAi(
      //     prompt,
      //     attempt
      //   );
const output =
  await callGemini(
    prompt,
    attempt
  );
      lastRawOutput =
        output;

      const parsedReview =
        parseAndValidateReview(
          output
        );

      const finalReview =
        enforceDeterministicRules(
          parsedReview,
          aiInput
        );

      return {
        review:
          finalReview,

        attempts:
          attempt
      };
    } catch (error) {
      lastError =
        error;

      console.warn(
        `⚠️ AI Reviewer attempt ${attempt} failed: ${error.message}`
      );

      saveInvalidAiResponse(
        lastRawOutput,
        attempt,
        error
      );
    }
  }

  throw new Error(
    `AI Reviewer failed after ${maxAttempts} attempts: ${lastError?.message || 'Unknown error'}`
  );
}


/*
 * ============================================================
 * SUMMARY
 * ============================================================
 */

function printReviewSummary(
  review,
  attempts
) {
  console.log(
    `Review decision: ${
      review.overallAssessment.shouldNotify
        ? review.overallAssessment.severity ===
          'CRITICAL'
          ? 'At least one CRITICAL alert exists.'
          : review.overallAssessment.severity ===
            'WARNING'
          ? 'At least one WARNING alert exists.'
          : 'At least one ATTENTION alert exists.'
        : 'No actionable alerts exist.'
    }`
  );

  console.log(
    'AI Review completed'
  );

  console.log(
    `Classification: ${review.overallAssessment.classification}`
  );

  console.log(
    `Severity: ${review.overallAssessment.severity}`
  );

  console.log(
    `Confidence: ${review.overallAssessment.confidence}%`
  );

  console.log(
    `Should notify: ${review.overallAssessment.shouldNotify}`
  );

  console.log(
    `Findings: ${review.findings.length}`
  );

  console.log(
    `Metrics: ${review.metrics.length}`
  );

  console.log(
    `Attempts: ${attempts}`
  );
}


/*
 * ============================================================
 * MAIN
 * ============================================================
 */

async function main() {
  const startedAt =
    Date.now();

  console.log(
    '============================================================'
  );

  console.log(
    'AI Reviewer'
  );

  console.log(
    '============================================================'
  );

  ensureOutputDirectory();

  const aiInput =
    loadAiInput();

  const prompt =
    buildPrompt();

  console.log(
    `AI Input loaded: ${AI_INPUT_FILE}`
  );

  console.log(
    `Prompt loaded: ${PROMPT_FILE}`
  );

  console.log(
    `Prompt characters: ${prompt.length}`
  );

  const {
    review,
    attempts
  } =
    await reviewWithRetry(
      prompt,
      aiInput
    );

  saveReviewOutput(
    review
  );

  printReviewSummary(
    review,
    attempts
  );

  const duration =
    Date.now() -
    startedAt;

  console.log(
    `Duration: ${duration} ms`
  );

  console.log(
    `AI Review output: ${LATEST_OUTPUT_FILE}`
  );
}


main()
  .catch(
    error => {
      console.error(
        `❌ AI Reviewer failed: ${error.message}`
      );

      process.exit(
        1
      );
    }
  );