const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

require('dotenv').config();

const ROOT =
  path.join(__dirname, '..');

const config =
  require('../monitor-config.json');

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY;

const GEMINI_COMMAND_ROUTER_ENABLED =
  String(
    process.env.GEMINI_COMMAND_ROUTER_ENABLED ||
    'false'
  ).trim().toLowerCase() === 'true';

const {
  interpretCommand
} = require('./gemini-command-interpreter');

const {
  loadContext,
  saveContext,
  mergeConversationContext,
  buildParserContext
} = require('./conversation-context');

const {
  resolveNaturalQuery
} = require('./query-resolver');

const ALLOWED_MONITORS =
  config.monitors
    .filter(
      monitor =>
        monitor.enabled === true
    )
    .map(
      monitor =>
        monitor.name
    );

const MONITOR_ALIASES = {

  spin_event: [
    'spin event',
    'spin'
  ],

  purchase_response: [
    'purchase response',
    'purchase'
  ],

  login: [
    'login',
    'signin',
    'sign in'
  ],

  signup: [
    'signup',
    'sign up'
  ],

  redemption: [
    'redemption',
    'redeem'
  ],

  client_error: [
    'client error',
    'client errors',
    'error',
    'errors'
  ],

  quest: [
    'quest'
  ]

};

function resolveMonitorName(
  command
) {

  const normalized =
    normalizeCommand(
      command
    )
      .toLowerCase();

  /*
   * Try longer aliases first.
   *
   * This is important because some aliases
   * are very short, such as:
   *
   *   spin
   *   purchase
   *   error
   */
  const candidates =
    Object.entries(
      MONITOR_ALIASES
    )
      .flatMap(
        ([
          monitor,
          aliases
        ]) =>
          aliases.map(
            alias => ({
              monitor,
              alias:
                normalizeCommand(
                  alias
                )
                  .toLowerCase()
            })
          )
      )
      .sort(
        (
          a,
          b
        ) =>
          b.alias.length -
          a.alias.length
      );

  for (
    const candidate
    of candidates
  ) {

    /*
     * Match the alias as a command token,
     * not as an arbitrary substring.
     *
     * This prevents:
     *
     *   login
     * from matching something like:
     *   mylogin
     */
    const escapedAlias =
      candidate.alias.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      );

    const regex =
      new RegExp(
        `(?:^|\\s)${escapedAlias}(?:\\s|$)`
      );

    if (
      regex.test(
        normalized
      )
    ) {

      return candidate.monitor;

    }
  }

  return null;
}

const SUPPORTED_NAMED_WINDOWS = [
  'current',
  'previous',
  'yesterday',
  'two_days_ago'
];

/*
 * ----------------------------------------------------------
 * MONITOR
 * ----------------------------------------------------------
 */

function getMonitor(
  monitorName
) {

  return config.monitors.find(
    monitor =>
      monitor.name === monitorName &&
      monitor.enabled === true
  );

}

/*
 * ----------------------------------------------------------
 * COMMAND
 * ----------------------------------------------------------
 */

function normalizeCommand(
  command
) {

  return String(
    command || ''
  )
    .trim()
    .replace(
      /\s+/g,
      ' '
    );

}
function normalizeMonitorAliases(
  command
) {

  let normalized =
    normalizeCommand(
      command
    )
      .toLowerCase();

  /*
   * Normalize monitor aliases to
   * canonical monitor names.
   *
   * IMPORTANT:
   * Longer / multi-word aliases
   * must be processed before shorter
   * aliases.
   */

  const aliases = [
    {
      monitor: 'spin_event',
      patterns: [
        /\bspin\s+event\b/g,
        /\bspin\b/g
      ]
    },

    {
      monitor: 'purchase_response',
      patterns: [
        /\bpurchase\s+response\b/g,
        /\bpurchase\b/g
      ]
    },

    {
      monitor: 'login',
      patterns: [
        /\bsign\s+in\b/g,
        /\bsignin\b/g,
        /\blogin\b/g
      ]
    },

    {
      monitor: 'signup',
      patterns: [
        /\bsign\s+up\b/g,
        /\bsignup\b/g
      ]
    },

    {
      monitor: 'redemption',
      patterns: [
        /\bredemption\b/g,
        /\bredeem\b/g
      ]
    },

    {
      monitor: 'client_error',
      patterns: [
        /\bclient\s+errors\b/g,
        /\bclient\s+error\b/g,
        /\berrors\b/g,
        /\berror\b/g
      ]
    },

    {
      monitor: 'quest',
      patterns: [
        /\bquest\b/g
      ]
    }
  ];

  for (
    const entry of aliases
  ) {

    for (
      const pattern of entry.patterns
    ) {

      normalized =
        normalized.replace(
          pattern,
          entry.monitor
        );

    }

  }

  return normalized;
}
/*
 * ----------------------------------------------------------
 * SPIN FILTERS
 * ----------------------------------------------------------
 *
 * Supported filters:
 *
 *   provider
 *   client_type
 *   spin_type
 *   unit_name
 *   outcome
 *
 * Examples:
 *
 *   check spin of Booming
 *   check spin on app
 *   check spin free spin
 *   check spin buy bonus
 *   check spin sweep
 *   check spin win
 *   check spin of Booming on app
 *   check spin of Booming free spin sweep
 */

const SPIN_FILTER_ALIASES = {

  provider: {
    booming_games: [
      'booming games',
      'booming_games',
      'booming'
    ],

    rgs: [
      'relax gaming',
      'relax_gaming',
      'relax',
      'rgs'
    ],
    ps: [
      'ps',
      'Slot',
      'Slot studio',
      'Slot game',
      'Slot games'
    ],
    ruby_play:[
      'Ruby game',
      'Ruby',
      'ruby_play',
      'Ruby games'

    ],
    evolution:[
      'Evo',
      'Evolution',
      'Evolution games'
    ]
  },

  client_type: {
    app: [
      'app',
      'mobile app',
      'mobileapp'
    ],

    web: [
      'web',
      'browser'
    ]
  },

  spin_type: {
    regular: [
      'regular'
    ],

    free_spin: [
      'free spin',
      'free_spin',
      'freespin'
    ],

    buy_bonus: [
      'buy bonus',
      'buy_bonus',
      'buybonus'
    ]
  },

  unit_name: {
    sweep: [
      'sweep',
      'sweeps',
      'sweep coin',
      'sweeps coin',
      'sc'
    ],

    gold: [
      'gold',
      'gold coin',
      'gc'
    ]
  },

  outcome: {
    win: [
      'win',
      'wins',
      'winning'
    ],

    lose: [
      'lose',
      'loss',
      'losses',
      'losing'
    ]
  }

};

function containsSpinFilterAlias(
  text,
  alias
) {

  const normalizedAlias =
    normalizeCommand(
      alias
    )
      .toLowerCase();

  const escapedAlias =
    normalizedAlias.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    );

  return new RegExp(
    `(?:^|\\s)${escapedAlias}(?:\\s|$)`
  ).test(
    text
  );

}

function findSpinFilterValue(
  text,
  filterGroup
) {

  const entries =
    Object.entries(
      SPIN_FILTER_ALIASES[
        filterGroup
      ] || {}
    );

  /*
   * Try longer aliases first.
   *
   * Example:
   *
   *   "free spin"
   * should be checked before
   *   "spin"
   */
  entries.sort(
    (
      a,
      b
    ) => {

      const aLength =
        Math.max(
          ...a[1].map(
            alias =>
              alias.length
          )
        );

      const bLength =
        Math.max(
          ...b[1].map(
            alias =>
              alias.length
          )
        );

      return (
        bLength -
        aLength
      );

    }
  );

  for (
    const [
      canonicalValue,
      aliases
    ]
    of entries
  ) {

    for (
      const alias
      of aliases
    ) {

      if (
        containsSpinFilterAlias(
          text,
          alias
        )
      ) {

        return canonicalValue;

      }

    }

  }

  return null;

}

function parseSpinFilters(
  command
) {

  const normalized =
    normalizeCommand(
      command
    )
      .toLowerCase();

  const filters = {};

  const provider =
    findSpinFilterValue(
      normalized,
      'provider'
    );

  if (
    provider
  ) {

    filters.provider =
      provider;

  }

  const clientType =
    findSpinFilterValue(
      normalized,
      'client_type'
    );

  if (
    clientType
  ) {

    filters.client_type =
      clientType;

  }

  const spinType =
    findSpinFilterValue(
      normalized,
      'spin_type'
    );

  if (
    spinType
  ) {

    filters.spin_type =
      spinType;

  }

  const unitName =
    findSpinFilterValue(
      normalized,
      'unit_name'
    );

  if (
    unitName
  ) {

    filters.unit_name =
      unitName;

  }

  const outcome =
    findSpinFilterValue(
      normalized,
      'outcome'
    );

  if (
    outcome
  ) {

    filters.outcome =
      outcome;

  }

  return filters;

}
/*
 * ----------------------------------------------------------
 * REDEMPTION OUTPUT FILTER
 * ----------------------------------------------------------
 *
 * Supported filters:
 *
 *   type
 *   client_type
 *   status
 *
 * Examples:
 *
 *   check redemption ach
 *   check redeem debit card
 *   check redeem gift card
 *   check redeem ach completed
 *   check redemption pending
 *   check redeem ach on web
 */

const REDEMPTION_FILTER_ALIASES = {

  type: {

    ach: [
      'ach',
      'pay by bank',
      'pay with bank'
    ],

    debit_card: [
      'debit card',
      'debit_card'
    ],

    gift_card: [
      'gift card',
      'gift_card'
    ]

  },

  client_type: {

    app: [
      'app',
      'mobile app',
      'mobileapp',
      'mobile'
    ],

    web: [
      'web',
      'browser',
      'website'
    ]

  },

  status: {

    approved: [
      'approved'
    ],

    pending: [
      'pending'
    ],

    completed: [
      'completed',
      'complete'
    ],

    manual_review: [
      'manual review',
      'manual_review'
    ],

    cancel: [
      'cancel',
      'cancelled',
      'canceled'
    ],

    unknown: [
      'unknown'
    ]

  }

};


function containsRedemptionFilterAlias(
  text,
  alias
) {

  const normalizedAlias =
    normalizeCommand(
      alias
    )
      .toLowerCase();

  const escapedAlias =
    normalizedAlias.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    );

  return new RegExp(
    `(?:^|\\s)${escapedAlias}(?:\\s|$)`
  ).test(
    text
  );

}


function findRedemptionFilterValue(
  text,
  filterGroup
) {

  const entries =
    Object.entries(
      REDEMPTION_FILTER_ALIASES[
        filterGroup
      ] || {}
    );

  /*
   * Longer aliases first.
   *
   * Example:
   *
   *   "manual review"
   *
   * must be checked before
   * shorter aliases.
   */
  entries.sort(
    (
      a,
      b
    ) => {

      const aLength =
        Math.max(
          ...a[1].map(
            alias =>
              alias.length
          )
        );

      const bLength =
        Math.max(
          ...b[1].map(
            alias =>
              alias.length
          )
        );

      return (
        bLength -
        aLength
      );

    }
  );

  for (
    const [
      canonicalValue,
      aliases
    ]
    of entries
  ) {

    for (
      const alias
      of aliases
    ) {

      if (
        containsRedemptionFilterAlias(
          text,
          alias
        )
      ) {

        return canonicalValue;

      }

    }

  }

  return null;

}


function parseRedemptionFilters(
  command
) {

  const normalized =
    normalizeCommand(
      command
    )
      .toLowerCase();

  const filters = {};

  const type =
    findRedemptionFilterValue(
      normalized,
      'type'
    );

  if (
    type
  ) {

    filters.type =
      type;

  }

  const clientType =
    findRedemptionFilterValue(
      normalized,
      'client_type'
    );

  if (
    clientType
  ) {

    filters.client_type =
      clientType;

  }

  const status =
    findRedemptionFilterValue(
      normalized,
      'status'
    );

  if (
    status
  ) {

    filters.status =
      status;

  }

  return filters;

}


function filterRedemptionRecords(
  records,
  filters
) {

  if (
    !filters ||
    Object.keys(filters).length === 0
  ) {

    return records;

  }

  return records.filter(
    row => {

      if (
        filters.type &&
        String(
          row.type || ''
        )
          .toLowerCase() !==
        filters.type
      ) {

        return false;

      }

      if (
        filters.client_type &&
        String(
          row.client_type || ''
        )
          .toLowerCase() !==
        filters.client_type
      ) {

        return false;

      }

      if (
        filters.status &&
        String(
          row.status || ''
        )
          .toLowerCase() !==
        filters.status
      ) {

        return false;

      }

      return true;

    }
  );

}


function formatRedemptionFilterLabel(
  filters
) {

  const labels = [];

  if (
    filters.type
  ) {

    labels.push(
      `Type: ${filters.type}`
    );

  }

  if (
    filters.client_type
  ) {

    labels.push(
      `Client: ${filters.client_type}`
    );

  }

  if (
    filters.status
  ) {

    labels.push(
      `Status: ${filters.status}`
    );

  }

  return labels.join(
    ' | '
  );

}
/*
 * ----------------------------------------------------------
 * JSON
 * ----------------------------------------------------------
 */

function extractJson(
  text
) {

  const cleaned =
    String(text || '')
      .trim()
      .replace(
        /^```(?:json)?\s*/i,
        ''
      )
      .replace(
        /\s*```$/i,
        ''
      );

  const firstBrace =
    cleaned.indexOf('{');

  const lastBrace =
    cleaned.lastIndexOf('}');

  if (
    firstBrace === -1 ||
    lastBrace === -1 ||
    lastBrace < firstBrace
  ) {

    throw new Error(
      'AI did not return a valid intent object.'
    );

  }

  return JSON.parse(
    cleaned.slice(
      firstBrace,
      lastBrace + 1
    )
  );

}

/*
 * ----------------------------------------------------------
 * TIME RANGE
 * ----------------------------------------------------------
 */

function normalizeTimeUnit(
  unit
) {

  if (
    !unit
  ) {
    return null;
  }

  const normalized =
    String(unit)
      .trim()
      .toLowerCase();

  if (
    [
      'minute',
      'minutes',
      'min',
      'mins'
    ].includes(
      normalized
    )
  ) {
    return 'minutes';
  }

  if (
    [
      'hour',
      'hours',
      'hr',
      'hrs'
    ].includes(
      normalized
    )
  ) {
    return 'hours';
  }

  if (
    [
      'day',
      'days'
    ].includes(
      normalized
    )
  ) {
    return 'days';
  }

  if (
    [
      'week',
      'weeks'
    ].includes(
      normalized
    )
  ) {
    return 'weeks';
  }
    if (
    [
      'month',
      'months',
      'mon',
      'mons'
    ].includes(
      normalized
    )
  ) {
    return 'months';
  }

  return null;

}

function normalizeTimeRange(
  timeRange
) {

  if (
    !timeRange
  ) {
    return null;
  }

  /*
   * String input.
   */
  if (
    typeof timeRange === 'string'
  ) {

    const normalized =
      timeRange
        .trim()
        .toLowerCase()
        .replace(
          /\s+/g,
          '_'
        );

    /*
     * Named windows.
     *
     * These are semantic calendar/relative
     * periods handled by the runner.
     */
    if (
      SUPPORTED_NAMED_WINDOWS.includes(
        normalized
      )
    ) {

      return {
        type: 'named',
        value: normalized
      };

    }

    /*
     * Natural language aliases.
     */
    if (
      normalized === 'today'
    ) {

      return {
        type: 'named',
        value: 'current'
      };

    }

    if (
      [
        'previous_day',
        'prior_day'
      ].includes(
        normalized
      )
    ) {

      return {
        type: 'named',
        value: 'yesterday'
      };

    }

    if (
      [
        'two_days_ago',
        '2_days_ago',
        'two_days_before'
      ].includes(
        normalized
      )
    ) {

      return {
        type: 'named',
        value: 'two_days_ago'
      };

    }

    /*
     * Dynamic relative duration.
     *
     * Examples:
     *
     *   last 5 hours
     *   last 50 hrs
     *   past 40 days
     *   last 3 weeks
     *   last 90 minutes
     *
     * Also supports anchored periods:
     *
     *   4 hrs today
     *   4 hrs yesterday
     *   last 2 days two days ago
     *   last 3 weeks previous
     */
    const match =
  normalized.match(
    /(?:last|past|previous|over_the_last|in_the_last)?_*(\d+(?:\.\d+)?)_*(minute|minutes|min|mins|hour|hours|hr|hrs|day|days|week|weeks|month|months|mon|mons)(?:_+(today|yesterday|previous|two_days_ago))?\b/
  );

    if (
      match
    ) {

      const amount =
        Number(
          match[1]
        );

      const unit =
        normalizeTimeUnit(
          match[2]
        );

      const rawAnchor =
        match[3] || '';

      const allowedAnchors = [
        'today',
        'yesterday',
        'previous',
        'two_days_ago'
      ];

      const value =
        allowedAnchors.includes(
          rawAnchor
        )
          ? (
              rawAnchor === 'today'
                ? 'current'
                : rawAnchor
            )
          : null;

      if (
        Number.isFinite(amount) &&
        amount > 0 &&
        unit
      ) {

        return {
          type: 'relative',
          amount,
          unit,
          value
        };

      }

    }

    return null;

  }

  /*
   * Object input from AI.
   */
  if (
    typeof timeRange === 'object'
  ) {

    const type =
      timeRange.type;

    if (
      type === 'relative'
    ) {

      const amount =
        Number(
          timeRange.amount
        );

      const unit =
        normalizeTimeUnit(
          timeRange.unit
        );

      const rawValue =
        String(
          timeRange.value || ''
        )
          .trim()
          .toLowerCase();

      const allowedAnchors = [
        'current',
        'previous',
        'yesterday',
        'two_days_ago'
      ];

      const value =
        allowedAnchors.includes(
          rawValue
        )
          ? rawValue
          : null;

      if (
        Number.isFinite(amount) &&
        amount > 0 &&
        unit
      ) {

        return {
          type: 'relative',
          amount,
          unit,
          value
        };

      }

    }

    if (
      type === 'named'
    ) {

      const value =
        String(
          timeRange.value || ''
        )
          .trim()
          .toLowerCase();

      if (
        SUPPORTED_NAMED_WINDOWS.includes(
          value
        )
      ) {

        return {
          type: 'named',
          value
        };

      }

    }

  }

  return null;

}

function timeRangeToMinutes(
  timeRange
) {

  const normalized =
    normalizeTimeRange(
      timeRange
    );

  if (
    !normalized ||
    normalized.type !== 'relative'
  ) {
    return null;
  }

  const multipliers = {
  minutes: 1,
  hours: 60,
  days: 24 * 60,
  weeks: 7 * 24 * 60,
  months: 30 * 24 * 60
};

  return (
    normalized.amount *
    multipliers[
      normalized.unit
    ]
  );

}

function formatTimeRange(
  timeRange
) {

  const normalized =
    normalizeTimeRange(
      timeRange
    );

  if (
    !normalized
  ) {
    return 'current';
  }

  if (
    normalized.type === 'relative'
  ) {

    return (
      `last ${normalized.amount} ${normalized.unit}`
    );

  }

  const labels = {
    current:
      'today',

    previous:
      'previous hour',

    yesterday:
      'yesterday',

    two_days_ago:
      'two days ago'
  };

  return (
    labels[
      normalized.value
    ] ||
    normalized.value
  );

}

/*
 * Convert a normalized time range to the
 * argument expected by run-and-extract.js.
 *
 * Named:
 *   yesterday -> yesterday
 *
 * Relative:
 *   last 5 hours -> last_5_hours
 *   last 40 days -> last_40_days
 */

function timeRangeToWindowName(
  timeRange
) {

  const normalized =
    normalizeTimeRange(
      timeRange
    );

  if (
    !normalized
  ) {
    return 'current';
  }

  if (
    normalized.type === 'named'
  ) {

    return normalized.value;

  }

  return (
    `last_${normalized.amount}_${normalized.unit}`
  );

}

/*
 * ----------------------------------------------------------
 * COMPARISON
 * ----------------------------------------------------------
 */

function normalizeComparisonPeriod(
  period
) {

  if (
    !period
  ) {
    return null;
  }

  return normalizeTimeRange(
    period
  );

}

function normalizeComparison(
  comparison
) {

  if (
    !comparison
  ) {
    return null;
  }

  let left =
    comparison.left;

  let right =
    comparison.right;

  /*
   * Support:
   *
   * {
   *   left: "yesterday",
   *   right: "two_days_ago"
   * }
   *
   * and:
   *
   * {
   *   left: {
   *     type: "named",
   *     value: "yesterday"
   *   },
   *   right: {
   *     type: "named",
   *     value: "two_days_ago"
   *   }
   * }
   */

  left =
    normalizeComparisonPeriod(
      left
    );

  right =
    normalizeComparisonPeriod(
      right
    );

  if (
    !left ||
    !right
  ) {
    return null;
  }

  return {
    left,
    right
  };

}

function comparisonPeriodToWindowName(
  period
) {

  const normalized =
    normalizeComparisonPeriod(
      period
    );

  if (
    !normalized
  ) {
    return null;
  }

  /*
   * Named windows.
   *
   * Examples:
   *   yesterday
   *   two_days_ago
   */
  if (
    normalized.type === 'named'
  ) {

    return normalized.value;
  }

  /*
   * Relative windows.
   *
   * Examples:
   *
   *   last 5 hours
   *     -> last_5_hours
   *
   *   last 5 hours today
   *     -> last_5_hours_today
   *
   *   last 5 hours yesterday
   *     -> last_5_hours_yesterday
   *
   *   last 3 weeks previous
   *     -> last_3_weeks_previous
   *
   *   last 2 days two days ago
   *     -> last_2_days_two_days_ago
   */
  if (
    normalized.type === 'relative'
  ) {

    const amount =
      normalized.amount;

    const unit =
      normalized.unit;

    const anchor =
      normalized.value;

    /*
     * No anchor means a normal
     * rolling window.
     *
     * Example:
     *   last 3 weeks
     *   -> last_3_weeks
     */
    if (
      !anchor ||
      anchor === 'current'
    ) {

      return (
        `last_${amount}_${unit}`
      );

    }

    return (
      `last_${amount}_${unit}_${anchor}`
    );

  }

  return null;

}

function comparisonPeriodRangeMode(
  period
) {

  const normalized =
    normalizeComparisonPeriod(
      period
    );

  if (
    !normalized
  ) {
    return 'default';
  }

  /*
   * In comparison:
   *
   * yesterday
   * two_days_ago
   *
   * should use the full calendar day,
   * not the default "same hour" window.
   */
  if (
    normalized.type === 'named' &&
    (
      normalized.value === 'yesterday' ||
      normalized.value === 'two_days_ago'
    )
  ) {

    return 'full_day';

  }

  return 'default';

}

function comparisonPeriodLabel(
  period
) {

  const normalized =
    normalizeComparisonPeriod(
      period
    );

  if (
    !normalized
  ) {
    return 'Unknown';
  }

  if (
    normalized.type === 'relative'
  ) {

    const anchorLabels = {
      current:
        'today',

      previous:
        'previous period',

      yesterday:
        'yesterday',

      two_days_ago:
        'two days ago'
    };

    const anchor =
      normalized.value
        ? anchorLabels[
            normalized.value
          ]
        : null;

    if (
      anchor
    ) {

      return (
        `last ${normalized.amount} ${normalized.unit} ${anchor}`
      );

    }

    return (
      `last ${normalized.amount} ${normalized.unit}`
    );

  }

  const labels = {
    current:
      'Today',

    previous:
      'Previous period',

    yesterday:
      'Yesterday',

    two_days_ago:
      'Two days ago'
  };

  return (
    labels[
      normalized.value
    ] ||
    normalized.value
  );

}

function parseAnchoredComparisonCommand(
  command
) {

  const normalized =
    normalizeCommand(
      command
    )
      .toLowerCase();

  if (
    !normalized.startsWith(
      'compare '
    )
  ) {
    return null;
  }

  const monitor =
    resolveMonitorName(
      command
    );

  if (
    !monitor
  ) {
    return null;
  }

  const match =
    normalized.match(
      /\b(?:last|past)?_*(\d+(?:\.\d+)?)_*(minute|minutes|min|mins|hour|hours|hr|hrs)_+(today|yesterday|two_days_ago|previous)\s+(?:and|vs|versus|against)\s+(?:last|past|previous)?_*(\d+(?:\.\d+)?)_*(minute|minutes|min|mins|hour|hours|hr|hrs)_+(today|yesterday|two_days_ago|previous)\b/
    );

  if (
    !match
  ) {
    return null;
  }

  const leftAmount =
    Number(
      match[1]
    );

  const leftUnit =
    normalizeTimeUnit(
      match[2]
    );

  const leftAnchor =
    match[3];

  const rightAmount =
    Number(
      match[4]
    );

  const rightUnit =
    normalizeTimeUnit(
      match[5]
    );

  const rightAnchor =
    match[6];

  if (
    !Number.isFinite(leftAmount) ||
    !Number.isFinite(rightAmount) ||
    !leftUnit ||
    !rightUnit
  ) {
    return null;
  }

  return {
    understood: true,
    action: 'compare',
    monitor,
    time_range: null,

    comparison: {
      left: {
        type: 'relative',
        amount: leftAmount,
        unit: leftUnit,
        value:
          leftAnchor === 'today'
            ? 'current'
            : leftAnchor
      },

      right: {
        type: 'relative',
        amount: rightAmount,
        unit: rightUnit,
        value:
          rightAnchor === 'today'
            ? 'current'
            : rightAnchor
      }
    }
  };

}

function parseArbitraryComparisonCommand(
  command
) {

  const normalized =
    normalizeCommand(
      command
    )
      .toLowerCase();

  if (
    !normalized.startsWith(
      'compare '
    )
  ) {
    return null;
  }

  const monitor =
    resolveMonitorName(
      command
    );

  if (
    !monitor
  ) {
    return null;
  }

  /*
   * Supported comparison separators:
   *
   *   vs
   *   versus
   *   against
   *   and
   */
  const separatorMatch =
    normalized.match(
      /\s+(vs|versus|against|and)\s+/
    );

  if (
    !separatorMatch
  ) {
    return null;
  }

  const separatorIndex =
    separatorMatch.index;

  if (
    separatorIndex === undefined
  ) {
    return null;
  }

  const leftText =
    normalized
      .slice(
        8,
        separatorIndex
      )
      .trim();

  const rightText =
    normalized
      .slice(
        separatorIndex +
        separatorMatch[0].length
      )
      .trim();

  /*
   * Remove monitor name from the beginning
   * of the left side.
   *
   * Example:
   *
   * compare spin event last 3 weeks
   *
   * leftText:
   *   "spin event last 3 weeks"
   *
   * becomes:
   *   "last 3 weeks"
   */
  let leftPeriodText =
    leftText;

  if (
    leftPeriodText.startsWith(
      monitor
    )
  ) {

    leftPeriodText =
      leftPeriodText
        .slice(
          monitor.length
        )
        .trim();

  }

  /*
   * Sometimes the monitor contains
   * multiple words, e.g. "spin event".
   */
  if (
    monitor === 'spin_event' &&
    leftPeriodText.startsWith(
      'spin event'
    )
  ) {

    leftPeriodText =
      leftPeriodText
        .slice(
          'spin event'.length
        )
        .trim();

  }

  function parsePeriodText(
    text
  ) {

    /*
     * Named calendar periods.
     */
    if (
      [
        'today'
      ].includes(
        text
      )
    ) {

      return {
        type: 'named',
        value: 'current'
      };

    }

    if (
      [
        'yesterday',
        'previous day',
        'prior day'
      ].includes(
        text
      )
    ) {

      return {
        type: 'named',
        value: 'yesterday'
      };

    }

    if (
      [
        'two days ago',
        '2 days ago',
        'two days before'
      ].includes(
        text
      )
    ) {

      return {
        type: 'named',
        value: 'two_days_ago'
      };

    }

    /*
     * Relative duration + optional anchor.
     *
     * Examples:
     *
     *   last 3 weeks
     *   last 3 weeks today
     *   last 3 weeks yesterday
     *   last 3 weeks previous
     *   last 2 days two days ago
     *   4 hrs today
     *   4hrs yesterday
     */
    const match =
      text.match(
        /^(?:last|past|previous|over the last|in the last)?\s*(\d+(?:\.\d+)?)\s*(minute|minutes|min|mins|hour|hours|hr|hrs|day|days|week|weeks)(?:\s+(today|yesterday|previous|two days ago))?$/
      );

    if (
      !match
    ) {
      return null;
    }

    const amount =
      Number(
        match[1]
      );

    const unit =
      normalizeTimeUnit(
        match[2]
      );

    const rawAnchor =
      match[3] || '';

    const anchorMap = {
      today:
        'current',

      yesterday:
        'yesterday',

      previous:
        'previous',

      'two days ago':
        'two_days_ago'
    };

    const value =
      anchorMap[
        rawAnchor
      ] || null;

    if (
      !Number.isFinite(
        amount
      ) ||
      amount <= 0 ||
      !unit
    ) {
      return null;
    }

    return {
      type: 'relative',
      amount,
      unit,
      value
    };

  }

  const left =
    parsePeriodText(
      leftPeriodText
    );

  const right =
    parsePeriodText(
      rightText
    );

  if (
    !left ||
    !right
  ) {
    return null;
  }

  return {
    understood: true,
    action: 'compare',
    monitor,
    time_range: null,
    comparison: {
      left,
      right
    }
  };

}

/*
 * ----------------------------------------------------------
 * AI INTENT PARSER
 * ----------------------------------------------------------
 */

async function parseIntent(
  command
) {

  const normalizedCommand =
    normalizeMonitorAliases(
      command
    );

  const arbitraryComparison =
    parseArbitraryComparisonCommand(
      normalizedCommand
    );

  if (
    arbitraryComparison
  ) {
    return arbitraryComparison;
  }

  const anchoredComparison =
    parseAnchoredComparisonCommand(
      normalizedCommand
    );

  if (
    anchoredComparison
  ) {
    return anchoredComparison;
  }

  /*
   * Try deterministic parsing first.
   *
   * This allows monitor aliases such as:
   *
   *   spin
   *   purchase
   *   signin
   *   sign in
   *   sign up
   *   redeem
   *   error
   *
   * to be resolved before sending
   * the command to the AI parser.
   */
  const deterministic =
    parseSimpleCommand(
      command
    );

  if (
    deterministic &&
    deterministic.understood
  ) {

    return deterministic;

  }

  /*
   * No AI key:
   * use deterministic fallback.
   */
  if (
    !OPENAI_API_KEY
  ) {

    return parseSimpleCommand(
      command
    );

  }

  const systemPrompt = `
You are the command parser for QA Sentinel.

QA Sentinel monitors:
${ALLOWED_MONITORS.join(', ')}

Supported actions:
- run
- check
- analyze
- compare
- help

Return ONLY JSON.

Schema:
{
  "understood": true,
  "action": "run|check|analyze|compare|help",
  "monitor": "monitor_name|null",
  "time_range": {
    "type": "relative|named",
    "amount": "number|null",
    "unit": "minutes|hours|days|weeks|months|null",
    "value": "current|previous|yesterday|two_days_ago|null"
  },
  "comparison": {
    "left": {
      "type": "relative|named",
      "amount": "number|null",
      "unit": "minutes|hours|days|weeks|months|null",
      "value": "current|previous|yesterday|two_days_ago|null"
    },
    "right": {
      "type": "relative|named",
      "amount": "number|null",
      "unit": "minutes|hours|days|weeks|months|null",
      "value": "current|previous|yesterday|two_days_ago|null"
    }
  }
}

Rules:

- Do not invent monitor names.
- Natural language requests are allowed.
- Identify the user's intended monitor from meaning, not only exact monitor names.
- "top errors", "top error", "client errors", "client error" should map to client_error.
- "purchase errors", "purchase failures" may map to purchase_response when appropriate.
- If the request cannot be mapped confidently to a supported action and monitor, set understood=false.
- If the user asks for something QA Sentinel cannot currently perform, set understood=false.

Time range rules:

- Extract relative time ranges dynamically.
- Never assume that only a fixed set of numbers is supported.
- "last 5 hours" means amount=5, unit=hours.
- "last 50 hrs" means amount=50, unit=hours.
- "past 40 days" means amount=40, unit=days.
- "last 3 weeks" means amount=3, unit=weeks.
- "last 90 minutes" means amount=90, unit=minutes.
- Singular and abbreviated units are allowed.
- "today" means type=named, value=current.
- "yesterday" means type=named, value=yesterday.
- "previous day" means type=named, value=yesterday.
- "two days ago" means type=named, value=two_days_ago.
- "previous" without a more specific duration means type=named, value=previous.
- If no time range is specified, use type=named, value=current.

IMPORTANT calendar-day rule:

- "yesterday" means the FULL calendar day yesterday.
- "two days ago" means the FULL calendar day two days ago.
- Do NOT interpret yesterday or two days ago as "the same hour yesterday".
- Numeric durations such as "last 5 hours" remain rolling durations.

Comparison rules:

- For a compare request, identify exactly two periods.
- Put the first period in comparison.left.
- Put the second period in comparison.right.
- "vs", "versus", and "against" mean comparison.
- Named calendar periods remain named periods.
- Numeric durations remain relative periods.
- Never replace a numeric duration with a named period.

Examples:

"run quest"
=> {
  "understood": true,
  "action": "run",
  "monitor": "quest",
  "time_range": {
    "type": "named",
    "amount": null,
    "unit": null,
    "value": "current"
  },
  "comparison": null
}

"check login failures"
=> {
  "understood": true,
  "action": "check",
  "monitor": "login",
  "time_range": {
    "type": "named",
    "amount": null,
    "unit": null,
    "value": "current"
  },
  "comparison": null
}

"check top errors in the last 5 hours"
=> {
  "understood": true,
  "action": "check",
  "monitor": "client_error",
  "time_range": {
    "type": "relative",
    "amount": 5,
    "unit": "hours",
    "value": null
  },
  "comparison": null
}

"check top errors in the last 50 hrs"
=> {
  "understood": true,
  "action": "check",
  "monitor": "client_error",
  "time_range": {
    "type": "relative",
    "amount": 50,
    "unit": "hours",
    "value": null
  },
  "comparison": null
}

"check quest over the past 40 days"
=> {
  "understood": true,
  "action": "check",
  "monitor": "quest",
  "time_range": {
    "type": "relative",
    "amount": 40,
    "unit": "days",
    "value": null
  },
  "comparison": null
}

"check login yesterday"
=> {
  "understood": true,
  "action": "check",
  "monitor": "login",
  "time_range": {
    "type": "named",
    "amount": null,
    "unit": null,
    "value": "yesterday"
  },
  "comparison": null
}

"check purchase two days ago"
=> {
  "understood": true,
  "action": "check",
  "monitor": "purchase_response",
  "time_range": {
    "type": "named",
    "amount": null,
    "unit": null,
    "value": "two_days_ago"
  },
  "comparison": null
}

"compare purchase yesterday vs two days ago"
=> {
  "understood": true,
  "action": "compare",
  "monitor": "purchase_response",
  "time_range": null,
  "comparison": {
    "left": {
      "type": "named",
      "amount": null,
      "unit": null,
      "value": "yesterday"
    },
    "right": {
      "type": "named",
      "amount": null,
      "unit": null,
      "value": "two_days_ago"
    }
  }
}

"compare login last 5 hours vs previous 5 hours"
=> {
  "understood": true,
  "action": "compare",
  "monitor": "login",
  "time_range": null,
  "comparison": {
    "left": {
      "type": "relative",
      "amount": 5,
      "unit": "hours",
      "value": null
    },
    "right": {
      "type": "relative",
      "amount": 5,
      "unit": "hours",
      "value": "previous"
    }
  }
}
`;

  const response =
    await fetch(
      'https://api.openai.com/v1/responses',
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json',

          Authorization:
            `Bearer ${OPENAI_API_KEY}`
        },

        body:
          JSON.stringify({

            model:
              process.env.QA_SENTINEL_BOT_MODEL ||
              'gpt-4o-mini',

            temperature:
              0,

            instructions:
              systemPrompt,

            input:
              normalizedCommand

          })
      }
    );

  if (
    !response.ok
  ) {

    const body =
      await response.text();

    throw new Error(
      `Intent parser failed: HTTP ${response.status} ${body}`
    );

  }

  const data =
    await response.json();

  const content =
    data.output
      ?.flatMap(
        item =>
          item.content || []
      )
      .find(
        item =>
          item.type ===
          'output_text'
      )
      ?.text;

  const parsedIntent =
    extractJson(
      content
    );

  /*
   * Deterministic fallback for simple
   * monitor commands.
   *
   * Example:
   *   check purchase
   *   check spin
   *   check signup
   *   check redeem
   *   check error
   *
   * If AI cannot confidently understand
   * a short command, let the deterministic
   * monitor resolver handle it.
   */
  if (
    !parsedIntent ||
    parsedIntent.understood !== true
  ) {

    const fallbackIntent =
      parseSimpleCommand(
        normalizedCommand
      );

    if (
      fallbackIntent &&
      fallbackIntent.understood === true
    ) {

      return fallbackIntent;

    }

  }

  return parsedIntent;

}

/*
 * ----------------------------------------------------------
 * SIMPLE COMMAND FALLBACK
 * ----------------------------------------------------------
 */

function parseSimpleCommand(
  command
) {

  const normalized =
    normalizeCommand(
      command
    )
      .toLowerCase();

  if (
    normalized === 'help'
  ) {

    return {
      understood: true,
      action: 'help',
      monitor: null,
      time_range: null,
      comparison: null
    };

  }

  const parts =
    normalized.split(' ');

  const action =
    parts[0];

  if (
    ![
      'run',
      'check',
      'analyze',
      'compare'
    ].includes(
      action
    )
  ) {

    return {
      understood: false
    };

  }

  const monitor =
    resolveMonitorName(
      command
    );

  if (
    !monitor
  ) {

    return {
      understood: false
    };

  }

  /*
   * Basic deterministic comparison fallback.
   */
  if (
    action === 'compare'
  ) {

    const comparisonMatch =
      normalized.match(
        /\b(current|previous|yesterday|two_days_ago|today|two days ago)\s+(?:vs|versus|against)\s+(current|previous|yesterday|two_days_ago|today|two days ago)\b/
      );

    if (
      !comparisonMatch
    ) {

      return {
        understood: false
      };

    }

    return {
      understood: true,
      action: 'compare',
      monitor,
      time_range: null,
      comparison: {
        left:
          comparisonMatch[1],
        right:
          comparisonMatch[2]
      }
    };

  }

  /*
   * Extract dynamic time range when
   * AI parsing is unavailable.
   */
  const timeRange =
    normalizeTimeRange(
      normalized
    );

  return {
    understood: true,
    action,
    monitor,
    time_range:
      timeRange || null,
    comparison: null
  };

}

/*
 * ----------------------------------------------------------
 * HELP
 * ----------------------------------------------------------
 */

function helpMessage() {

  return {
    text: [
      '🤖 *QA Sentinel*',
      '',
      '*Examples:*',
      '• `@QA Sentinel run quest`',
      '• `@QA Sentinel check login`',
      '• `@QA Sentinel analyze purchase_response`',
      '• `@QA Sentinel check top client errors`',
      '• `@QA Sentinel compare login yesterday vs two days ago`',
      '',
      'You can also ask in natural language.'
    ].join('\n')
  };

}

function cannotUnderstandMessage() {

  return {
    text:
      'Sorry, I cannot proceed with this request because I could not determine what you would like me to check. Please specify your request, including the monitor or data you want to investigate.'
  };

}

/*
 * ----------------------------------------------------------
 * RUN SCRIPT
 * ----------------------------------------------------------
 */

function runScript(
  scriptName,
  args
) {

  return new Promise(
    (
      resolve,
      reject
    ) => {

      const scriptPath =
        path.join(
          ROOT,
          scriptName
        );

      if (
        !fs.existsSync(
          scriptPath
        )
      ) {

        reject(
          new Error(
            `Script not found: ${scriptName}`
          )
        );

        return;
      }

      const child =
        spawn(
          process.execPath,
          [
            scriptPath,
            ...args
          ],
          {
            cwd:
              ROOT,

            env:
              process.env,

            stdio:
              'inherit'
          }
        );

      child.on(
        'error',
        reject
      );

      child.on(
        'close',
        exitCode => {

          if (
            exitCode === 0
          ) {

            resolve();

            return;

          }

          reject(
            new Error(
              `${scriptName} failed with exit code ${exitCode}`
            )
          );

        }
      );

    }
  );

}

/*
 * ----------------------------------------------------------
 * READ JSON
 * ----------------------------------------------------------
 */

function readJsonFile(
  filePath
) {

  if (
    !fs.existsSync(
      filePath
    )
  ) {

    throw new Error(
      `Result file not found: ${filePath}`
    );

  }

  return JSON.parse(
    fs.readFileSync(
      filePath,
      'utf8'
    )
  );

}

function getRecords(
  raw
) {

  return Array.isArray(raw)
    ? raw
    : raw.records || [];

}

/*
 * ----------------------------------------------------------
 * GENERIC NUMERIC HELPERS
 * ----------------------------------------------------------
 */

function getNumericValue(
  row,
  field
) {

  if (
    row === null ||
    row === undefined
  ) {
    return null;
  }

  const raw =
    row[field];

  if (
    raw === null ||
    raw === undefined ||
    raw === ''
  ) {
    return null;
  }

  const value =
    Number(
      String(raw)
        .replace(
          /,/g,
          ''
        )
    );

  return Number.isFinite(
    value
  )
    ? value
    : null;

}

function sumMetric(
  records,
  field
) {

  let total = 0;
  let found = false;

  for (
    const row of records
  ) {

    const value =
      getNumericValue(
        row,
        field
      );

    if (
      value !== null
    ) {

      total += value;
      found = true;

    }

  }

  return found
    ? total
    : null;

}

function formatNumber(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {
    return '—';
  }

  return Number(
    value
  ).toLocaleString(
    'en-US'
  );

}

function formatFieldName(
  field
) {

  return String(
    field
  )
    .replace(
      /_/g,
      ' '
    )
    .replace(
      /\b\w/g,
      char =>
        char.toUpperCase()
    );

}

function formatMetricValue(
  value
) {

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return '—';
  }

  if (
    typeof value === 'number'
  ) {

    return Number.isFinite(value)
      ? value.toLocaleString('en-US')
      : '—';

  }

  if (
    typeof value === 'boolean'
  ) {

    return value
      ? 'Yes'
      : 'No';

  }

  if (
    typeof value === 'object'
  ) {

    return JSON.stringify(value);

  }

  const raw =
    String(value).trim();

  const numericValue =
    Number(
      raw.replace(
        /,/g,
        ''
      ).replace(
        /%$/,
        ''
      )
    );

  if (
    Number.isFinite(numericValue) &&
    /^-?[\d,]+(?:\.\d+)?%?$/.test(raw)
  ) {

    return raw.endsWith('%')
      ? `${numericValue.toLocaleString('en-US')}%`
      : numericValue.toLocaleString('en-US');

  }

  return raw;

}

function isIgnoredField(
  field
) {

  return [
    '_time',
    'time',
    'timestamp',
    'date',
    'earliest',
    'latest'
  ].includes(
    field
  );

}

function isMetricField(
  field,
  value
) {

  if (
    isIgnoredField(
      field
    )
  ) {
    return false;
  }

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return false;
  }

  if (
    typeof value === 'number'
  ) {

    return Number.isFinite(value);

  }

  if (
    typeof value !== 'string'
  ) {

    return false;

  }

  const raw =
    value.trim();

  return /^-?[\d,]+(?:\.\d+)?%?$/.test(
    raw
  );

}

function buildMetricRow(
  row,
  index
) {

  const entries =
    Object.entries(
      row || {}
    );

  const displayEntries =
    entries.filter(
      ([field]) =>
        !isIgnoredField(
          field
        )
    );

  const dimensionEntries =
    displayEntries.filter(
      ([field, value]) =>
        !isMetricField(
          field,
          value
        )
    );

  const metricEntries =
    displayEntries.filter(
      ([field, value]) =>
        isMetricField(
          field,
          value
        )
    );

  const lines = [
    `${index + 1}.`
  ];

  if (
    dimensionEntries.length > 0
  ) {

    for (
      const [field, value]
      of dimensionEntries
    ) {

      lines.push(
        `*${formatFieldName(field)}:* ${formatMetricValue(value)}`
      );

    }

  }

  if (
    metricEntries.length > 0
  ) {

    for (
      const [field, value]
      of metricEntries
    ) {

      lines.push(
        `*${formatFieldName(field)}:* ${formatMetricValue(value)}`
      );

    }

  }

  if (
    lines.length === 1
  ) {

    lines.push(
      'No displayable data.'
    );

  }

  return lines.join(
    '\n'
  );

}

/*
 * ----------------------------------------------------------
 * SPIN OUTPUT FILTER
 * ----------------------------------------------------------
 */

function filterSpinRecords(
  records,
  filters
) {

  if (
    !filters ||
    Object.keys(filters).length === 0
  ) {

    return records;

  }

  return records.filter(
    row => {

      if (
        filters.provider &&
        String(
          row.provider || ''
        ).toLowerCase() !==
        filters.provider
      ) {

        return false;

      }

      if (
        filters.client_type &&
        String(
          row.client_type || ''
        ).toLowerCase() !==
        filters.client_type
      ) {

        return false;

      }

      if (
        filters.spin_type &&
        String(
          row.spin_type || ''
        ).toLowerCase() !==
        filters.spin_type
      ) {

        return false;

      }

      if (
        filters.unit_name &&
        String(
          row.unit_name || ''
        ).toLowerCase() !==
        filters.unit_name
      ) {

        return false;

      }

      /*
       * Win / lose is NOT a row dimension.
       *
       * It controls which metric is displayed.
       *
       * Therefore it must NOT filter rows here.
       */

      return true;

    }
  );

}

function formatSpinFilterLabel(
  filters
) {

  const labels = [];

  if (
    filters.provider
  ) {

    labels.push(
      `Provider: ${filters.provider}`
    );

  }

  if (
    filters.client_type
  ) {

    labels.push(
      `Client: ${filters.client_type}`
    );

  }

  if (
    filters.spin_type
  ) {

    labels.push(
      `Spin type: ${filters.spin_type}`
    );

  }

  if (
    filters.unit_name
  ) {

    labels.push(
      `Unit: ${filters.unit_name}`
    );

  }

  if (
    filters.outcome
  ) {

    labels.push(
      `Outcome: ${filters.outcome}`
    );

  }

  return labels.join(
    ' | '
  );

}
function buildGenericSpinTableMessage(
  monitor,
  rangeText,
  records
) {

  if (
    records.length === 0
  ) {

    return {
      text:
        `📊 *${monitor.displayName || monitor.name}*\n\n` +
        `*Time range:* ${rangeText}\n\n` +
        'No events recorded within the time range, please try a different time range.'
    };

  }

  const header =
    'Provider        Client  Spin Type    Unit   Spins   Users   Win    Lose   Win Rate';

  const separator =
    '-----------------------------------------------------------------------------------';

  const rows =
    records.map(
      row => {

        const provider =
          String(
            row.provider || 'Unknown'
          );

        const clientType =
          String(
            row.client_type || 'Unknown'
          );

        const spinType =
          String(
            row.spin_type || 'Unknown'
          );

        const unit =
          String(
            row.unit_name || 'Unknown'
          );

        const totalSpins =
          formatMetricValue(
            row.total_spins
          );

        const uniqueUsers =
          formatMetricValue(
            row.unique_users
          );

        const totalWin =
          formatMetricValue(
            row.total_win
          );

        const totalLose =
          formatMetricValue(
            row.total_lose
          );

        const winRate =
          formatMetricValue(
            row.win_rate
          );

        return (
          `${provider.padEnd(15)}` +
          `${clientType.padEnd(8)}` +
          `${spinType.padEnd(13)}` +
          `${unit.padEnd(7)}` +
          `${totalSpins.padStart(6)}  ` +
          `${uniqueUsers.padStart(5)}  ` +
          `${totalWin.padStart(5)}  ` +
          `${totalLose.padStart(6)}  ` +
          `${winRate.padStart(8)}`
        );

      }
    );

  return {
    text:
      `📊 *${monitor.displayName || monitor.name}*\n\n` +
      `*Time range:* ${rangeText}\n` +
      `*Results:* ${records.length} row(s)\n\n` +
      '```' +
      `\n${header}\n${separator}\n` +
      rows.join('\n') +
      '\n```'
  };

}


// function buildGenericPurchaseTableMessage(
//   monitor,
//   rangeText,
//   records
// ) {

//   if (
//     records.length === 0
//   ) {

//     return {
//       text:
//         `📊 *${monitor.displayName || monitor.name}*\n\n` +
//         `*Time range:* ${rangeText}\n\n` +
//         'No purchase events recorded within the time range, please try a different time range.'
//     };

//   }

//   const header =
//     'Client  Payment Type   Responses   Completed   Failed   Cancelled   Users   Amount   Avg Amount';

//   const separator =
//     '------------------------------------------------------------------------------------------------';

//   const rows =
//     records.map(
//       row => {

//         const clientType =
//           String(
//             row.client_type || 'Unknown'
//           );

//         const paymentType =
//           String(
//             row.payment_type || 'Unknown'
//           );

//         const totalResponses =
//           formatMetricValue(
//             row.total_responses
//           );

//         const completed =
//           `${formatMetricValue(row.completed)} (${formatMetricValue(row.completed_rate)})`;

//         const failed =
//           `${formatMetricValue(row.failed)} (${formatMetricValue(row.failed_rate)})`;

//         const cancelled =
//           `${formatMetricValue(row.cancelled)} (${formatMetricValue(row.cancelled_rate)})`;

//         const purchasingUsers =
//           formatMetricValue(
//             row.purchasing_users
//           );

//         const purchaseAmount =
//           formatMetricValue(
//             row.purchase_amount
//           );

//         const avgPurchaseAmount =
//           formatMetricValue(
//             row.avg_purchase_amount
//           );

//         return (
//           `${clientType.padEnd(8)}` +
//           `${paymentType.padEnd(15)}` +
//           `${totalResponses.padStart(9)}   ` +
//           `${completed.padStart(15)}   ` +
//           `${failed.padStart(13)}   ` +
//           `${cancelled.padStart(15)}   ` +
//           `${purchasingUsers.padStart(5)}   ` +
//           `${purchaseAmount.padStart(8)}   ` +
//           `${avgPurchaseAmount.padStart(10)}`
//         );

//       }
//     );

//   return {
//     text:
//       `📊 *${monitor.displayName || monitor.name}*\n\n` +
//       `*Time range:* ${rangeText}\n` +
//       `*Results:* ${records.length} row(s)\n\n` +
//       '```' +
//       `\n${header}\n${separator}\n` +
//       rows.join('\n') +
//       '\n```'
//   };

// }
function buildSpinMonitorMessage(
  monitor,
  rangeText,
  records,
  filters
) {

  const filteredRecords =
    filterSpinRecords(
      records,
      filters
    );

  /*
   * No filter:
   * keep the existing generic output.
   */
  if (
    Object.keys(
      filters || {}
    ).length === 0
  ) {

    return buildGenericSpinTableMessage(
      monitor,
      rangeText,
      records
    );

  }

  /*
   * Filter returned no rows.
   */
  if (
    filteredRecords.length === 0
  ) {

    const filterText =
      formatSpinFilterLabel(
        filters
      );

    return {
      text:
        `📊 *${monitor.displayName || monitor.name}*\n\n` +
        `*Time range:* ${rangeText}\n` +
        `*Filter:* ${filterText}\n\n` +
        'No events recorded within the time range, please try a different time range.'
    };

  }

  const lines = [
    `📊 *${monitor.displayName || monitor.name}*`,
    '',
    `*Time range:* ${rangeText}`,
    `*Filter:* ${formatSpinFilterLabel(filters)}`,
    `*Results:* ${filteredRecords.length} row(s)`,
    ''
  ];

  /*
   * Group records:
   *
   * provider
   *   -> client_type
   *      -> spin_type
   *         -> unit_name
   */
  const grouped = {};

  for (
    const row of filteredRecords
  ) {

    const provider =
      row.provider ||
      'Unknown';

    const clientType =
      row.client_type ||
      'Unknown';

    const spinType =
      row.spin_type ||
      'Unknown';

    const unit =
      row.unit_name ||
      'Unknown';

    if (
      !grouped[provider]
    ) {

      grouped[provider] = {};

    }

    if (
      !grouped[provider][
        clientType
      ]
    ) {

      grouped[provider][
        clientType
      ] = {};

    }

    if (
      !grouped[provider][
        clientType
      ][spinType]
    ) {

      grouped[provider][
        clientType
      ][spinType] = [];

    }

    grouped[provider][
      clientType
    ][spinType].push(
      {
        ...row,
        unit_name: unit
      }
    );

  }

  /*
   * Render grouped hierarchy.
   */
  Object.entries(
    grouped
  ).forEach(
    (
      [
        provider,
        clientGroups
      ]
    ) => {

      lines.push(
        `*${formatMetricValue(provider)}*`
      );

      Object.entries(
        clientGroups
      ).forEach(
        (
          [
            clientType,
            spinGroups
          ]
        ) => {

          lines.push(
            `  • *Client Type:* ${formatMetricValue(clientType)}`
          );

          Object.entries(
            spinGroups
          ).forEach(
            (
              [
                spinType,
                unitRows
              ]
            ) => {

              lines.push(
                `    • *Spin Type:* ${formatMetricValue(spinType)}`
              );

              unitRows.forEach(
                row => {

                  const unit =
                    row.unit_name ||
                    'Unknown';

                  const totalSpins =
                    row.total_spins;

                  const uniqueUsers =
                    row.unique_users;

                  const totalWin =
                    row.total_win;

                  const totalLose =
                    row.total_lose;

                  const winRate =
                    row.win_rate;

                  lines.push(
                    `      • *Unit:* ${formatMetricValue(unit)}`,
                    `        Total Spins: ${formatMetricValue(totalSpins)} | Users: ${formatMetricValue(uniqueUsers)}`
                  );

                  /*
                   * Outcome filter controls
                   * which metrics are shown.
                   */
                  if (
                    filters.outcome ===
                    'win'
                  ) {

                    lines.push(
                      `        Win: ${formatMetricValue(totalWin)} | Win Rate: ${formatMetricValue(winRate)}`
                    );

                  } else if (
                    filters.outcome ===
                    'lose'
                  ) {

                    lines.push(
                      `        Lose: ${formatMetricValue(totalLose)}`
                    );

                  } else {

                    lines.push(
                      `        Win: ${formatMetricValue(totalWin)} | Lose: ${formatMetricValue(totalLose)} | Win Rate: ${formatMetricValue(winRate)}`
                    );

                  }

                  lines.push('');

                }
              );

            }
          );

        }
      );

    }
  );

  return {
    text:
      lines.join(
        '\n'
      ).trim()
  };

}

function buildGenericMonitorMessage(
  monitor,
  rangeText,
  records
) {

  const lines = [
    `📊 *${monitor.displayName || monitor.name}*`,
    '',
    `*Time range:* ${rangeText}`,
    `*Results:* ${records.length} row(s)`,
    ''
  ];

  records
    .slice(
      0,
      10
    )
    .forEach(
      (
        row,
        index
      ) => {

        lines.push(
          buildMetricRow(
            row,
            index
          ),
          ''
        );

      }
    );

  if (
    records.length > 10
  ) {

    lines.push(
      `_Showing first 10 of ${records.length} results._`
    );

  }

  return {
    text:
      lines.join(
        '\n'
      ).trim()
  };

}

/*
 * ----------------------------------------------------------
 * COMPARISON METRICS
 * ----------------------------------------------------------
 */

function calculateComparisonMetrics(
  records
) {

  const totals = {};

  for (
    const row of records
  ) {

    for (
      const [
        field,
        rawValue
      ] of Object.entries(
        row || {}
      )
    ) {

      const value =
        Number(
          String(
            rawValue ?? ''
          )
            .replace(
              /,/g,
              ''
            )
        );

      if (
        !Number.isFinite(
          value
        )
      ) {
        continue;
      }

      /*
       * Ignore common non-metric fields.
       */
      if (
        [
          '_time',
          'time',
          'timestamp',
          'date',
          'earliest',
          'latest'
        ].includes(
          field
        )
      ) {
        continue;
      }

      if (
        !Object.prototype.hasOwnProperty.call(
          totals,
          field
        )
      ) {

        totals[field] = 0;

      }

      totals[field] +=
        value;

    }

  }

  return totals;

}

function formatDelta(
  current,
  previous
) {

  if (
    current === null ||
    previous === null ||
    previous === 0
  ) {

    return '—';

  }

  const delta =
    (
      (
        current -
        previous
      ) /
      Math.abs(
        previous
      )
    ) *
    100;

  const sign =
    delta > 0
      ? '+'
      : '';

  return (
    `${sign}${delta.toFixed(1)}%`
  );

}

function buildComparisonMessage(
  monitor,
  comparison,
  leftRecords,
  rightRecords
) {

  const leftMetrics =
    calculateComparisonMetrics(
      leftRecords
    );

  const rightMetrics =
    calculateComparisonMetrics(
      rightRecords
    );

  const metricNames =
    Array.from(
      new Set([
        ...Object.keys(
          leftMetrics
        ),
        ...Object.keys(
          rightMetrics
        )
      ])
    );

  const lines = [
    `📊 *${monitor.displayName || monitor.name}*`,
    '',
    `*${comparisonPeriodLabel(comparison.left)}* vs *${comparisonPeriodLabel(comparison.right)}*`,
    ''
  ];

  if (
    metricNames.length === 0
  ) {

    lines.push(
      'No numeric metrics found in the results.'
    );

    return {
      text:
        lines.join('\n')
    };

  }

  for (
    const metric of metricNames
  ) {

    const left =
      leftMetrics[
        metric
      ] ?? null;

    const right =
      rightMetrics[
        metric
      ] ?? null;

    lines.push(
      `*${formatFieldName(metric)}*`,
      `${comparisonPeriodLabel(comparison.left)}: *${formatNumber(left)}*`,
      `${comparisonPeriodLabel(comparison.right)}: *${formatNumber(right)}*`,
      `Change: *${formatDelta(left, right)}*`,
      ''
    );

  }

  lines.push(
    `Rows: ${leftRecords.length} vs ${rightRecords.length}`
  );

  return {
    text:
      lines.join('\n')
  };

}
/*
 * ----------------------------------------------------------
 * PURCHASE OUTPUT FILTER
 * ----------------------------------------------------------
 */

const PURCHASE_FILTER_ALIASES = {

  payment_type: {
    apple_pay: [
      'apple pay',
      'apple_pay',
      'applepay'
    ],

    credit_card: [
      'credit card',
      'credit_card',
      'card',
      'apt pay'
    ],

    debit_card: [
      'debit card',
      'debit_card'
    ],

    pay_by_bank: [
      'ach',
      'pay by bank',
      'pay with bank',
      'bank'
    ],

    skrill: [
      'skrill'
    ],

    gift_card: [
      'gift card',
      'gift_card'
    ]
  },

  client_type: {

    app: [
      'app',
      'mobile app',
      'mobileapp',
      'mobile'
    ],

    web: [
      'web',
      'browser',
      'website'
    ]

  },

  response: {

    complete: [
      'completed',
      'complete',
      'success',
      'successful'
    ],

    failed: [
      'failed',
      'fail',
      'failure',
      'failures'
    ],

    cancelled: [
      'cancelled',
      'canceled',
      'cancel'
    ]

  }

};
function containsPurchaseFilterAlias(
  text,
  alias
) {

  const normalizedAlias =
    normalizeCommand(
      alias
    )
      .toLowerCase();

  const escapedAlias =
    normalizedAlias.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    );

  return new RegExp(
    `(?:^|\\s)${escapedAlias}(?:\\s|$)`
  ).test(
    text
  );

}

function findPurchaseFilterValue(
  text,
  filterGroup
) {

  const entries =
    Object.entries(
      PURCHASE_FILTER_ALIASES[
        filterGroup
      ] || {}
    );

  entries.sort(
    (
      a,
      b
    ) => {

      const aLength =
        Math.max(
          ...a[1].map(
            alias =>
              alias.length
          )
        );

      const bLength =
        Math.max(
          ...b[1].map(
            alias =>
              alias.length
          )
        );

      return (
        bLength -
        aLength
      );

    }
  );

  for (
    const [
      canonicalValue,
      aliases
    ] of entries
  ) {

    for (
      const alias
      of aliases
    ) {

      if (
        containsPurchaseFilterAlias(
          text,
          alias
        )
      ) {

        return canonicalValue;

      }

    }

  }

  return null;

}


function parsePurchaseFilters(
  command
) {

  const normalized =
    normalizeCommand(
      command
    )
      .toLowerCase();

  const filters = {};

  const clientType =
    findPurchaseFilterValue(
      normalized,
      'client_type'
    );

  if (
    clientType
  ) {

    filters.client_type =
      clientType;

  }

  const paymentType =
    findPurchaseFilterValue(
      normalized,
      'payment_type'
    );

  if (
    paymentType
  ) {

    filters.payment_type =
      paymentType;

  }

  const response =
    findPurchaseFilterValue(
      normalized,
      'response'
    );

  if (
    response
  ) {

    filters.response =
      response;

  }

  return filters;

}


function filterPurchaseRecords(
  records,
  filters
) {

  if (
    !filters ||
    Object.keys(filters).length === 0
  ) {

    return records;

  }

  return records.filter(
    row => {

      if (
        filters.client_type &&
        String(
          row.client_type || ''
        )
          .toLowerCase() !==
        filters.client_type
      ) {

        return false;

      }

      if (
        filters.payment_type &&
        String(
          row.payment_type || ''
        )
          .toLowerCase() !==
        filters.payment_type
      ) {

        return false;

      }

      /*
       * Response is NOT a row dimension.
       *
       * The query groups by client_type
       * and payment_type, and returns
       * completed, failed, cancelled
       * and their rates in the same row.
       *
       * Therefore response only controls
       * which metrics are displayed.
       */
      return true;

    }
  );

}


function formatPurchaseFilterLabel(
  filters
) {

  const labels = [];

  if (
    filters.client_type
  ) {

    labels.push(
      `Client: ${filters.client_type}`
    );

  }

  if (
    filters.payment_type
  ) {

    labels.push(
      `Payment: ${filters.payment_type}`
    );

  }

  if (
    filters.response
  ) {

    labels.push(
      `Response: ${filters.response}`
    );

  }

  return labels.join(
    ' | '
  );

}

function buildGenericPurchaseTableMessage(
  monitor,
  rangeText,
  records
) {

  if (
    records.length === 0
  ) {

    return {
      text:
        `📊 *${monitor.displayName || monitor.name}*\n\n` +
        `*Time range:* ${rangeText}\n` +
        '*Results:* 0 row(s)\n\n' +
        'No purchase events recorded within the time range, please try a different time range.'
    };

  }

  /*
   * Keep the table compact for Slack.
   *
   * Header and data rows use exactly
   * the same column widths.
   */
  const widths = {
    client: 9,
    payment: 15,
    completed: 14,
    failed: 14,
    cancelled: 15
  };

  const header =
    'Client'.padEnd(widths.client) +
    'Payment Type'.padEnd(widths.payment) +
    'Completed'.padEnd(widths.completed) +
    'Failed'.padEnd(widths.failed) +
    'Cancelled'.padEnd(widths.cancelled) +
    'Users';

  const separator =
    '-'.repeat(
      header.length
    );

  const rows =
    records.map(
      row => {

        const clientType =
          String(
            row.client_type ||
            'Unknown'
          );

        const paymentType =
          String(
            row.payment_type ||
            'Unknown'
          );

        const completed =
          `${formatMetricValue(
            row.completed
          )} (${formatMetricValue(
            row.completed_rate
          )})`;

        const failed =
          `${formatMetricValue(
            row.failed
          )} (${formatMetricValue(
            row.failed_rate
          )})`;

        const cancelled =
          `${formatMetricValue(
            row.cancelled
          )} (${formatMetricValue(
            row.cancelled_rate
          )})`;

        const users =
          formatMetricValue(
            row.purchasing_users
          );

        return (
          clientType.padEnd(
            widths.client
          ) +
          paymentType.padEnd(
            widths.payment
          ) +
          completed.padEnd(
            widths.completed
          ) +
          failed.padEnd(
            widths.failed
          ) +
          cancelled.padEnd(
            widths.cancelled
          ) +
          users
        );

      }
    );

  const detailRows =
    records.map(
      row => {

        const clientType =
          String(
            row.client_type ||
            'Unknown'
          );

        const paymentType =
          String(
            row.payment_type ||
            'Unknown'
          );

        const responses =
          formatMetricValue(
            row.total_responses
          );

        const amount =
          formatMetricValue(
            row.purchase_amount
          );

        const avgAmount =
          formatMetricValue(
            row.avg_purchase_amount
          );

        return (
          `• ${clientType} · ${paymentType}: ` +
          `Responses ${responses} | ` +
          `Amount ${amount} | ` +
          `Avg ${avgAmount}`
        );

      }
    );

  return {
    text:
      [
        `📊 *${monitor.displayName || monitor.name}*`,
        '',
        `*Time range:* ${rangeText}`,
        `*Results:* ${records.length} row(s)`,
        '',
        '```',
        header,
        separator,
        ...rows,
        '```',
        '',
        '*Responses / Amount*',
        ...detailRows
      ].join(
        '\n'
      )
  };

}
function buildPurchaseMonitorMessage(
  monitor,
  rangeText,
  records,
  filters
) {

  const filteredRecords =
    filterPurchaseRecords(
      records,
      filters
    );

  /*
   * No filters:
   * keep the existing generic output.
   */
  if (
    Object.keys(
      filters || {}
    ).length === 0
  ) {

    return buildGenericPurchaseTableMessage(
      monitor,
      rangeText,
      records
    );

  }

  const filterText =
    formatPurchaseFilterLabel(
      filters
    );

  if (
    filteredRecords.length === 0
  ) {

    return {
      text:
        `📊 *${monitor.displayName || monitor.name}*\n\n` +
        `*Time range:* ${rangeText}\n` +
        `*Filter:* ${filterText}\n\n` +
        'No purchase events recorded within the time range, please try a different time range or filter.'
    };

  }

  const lines = [
    `📊 *${monitor.displayName || monitor.name}*`,
    '',
    `*Time range:* ${rangeText}`,
    `*Filter:* ${filterText}`,
    `*Results:* ${filteredRecords.length} row(s)`,
    ''
  ];

  filteredRecords
    .slice(
      0,
      10
    )
    .forEach(
      row => {

        const clientType =
          row.client_type ||
          'Unknown';

        const paymentType =
          row.payment_type ||
          'Unknown';

        const totalResponses =
          row.total_responses;

        const completed =
          row.completed;

        const failed =
          row.failed;

        const cancelled =
          row.cancelled;

        const purchasingUsers =
          row.purchasing_users;

        const purchaseAmount =
          row.purchase_amount;

        const avgPurchaseAmount =
          row.avg_purchase_amount;

        const completedRate =
          row.completed_rate;

        const failedRate =
          row.failed_rate;

        const cancelledRate =
          row.cancelled_rate;

        lines.push(
          `• *${formatMetricValue(clientType)}* · *${formatMetricValue(paymentType)}*`,
          `  Total Responses: ${formatMetricValue(totalResponses)}`
        );

        if (
          filters.response ===
          'complete'
        ) {

          lines.push(
            `  Completed: ${formatMetricValue(completed)} (${formatMetricValue(completedRate)})`
          );

        } else if (
          filters.response ===
          'failed'
        ) {

          lines.push(
            `  Failed: ${formatMetricValue(failed)} (${formatMetricValue(failedRate)})`
          );

        } else if (
          filters.response ===
          'cancelled'
        ) {

          lines.push(
            `  Cancelled: ${formatMetricValue(cancelled)} (${formatMetricValue(cancelledRate)})`
          );

        } else {

          lines.push(
            `  Completed: ${formatMetricValue(completed)} (${formatMetricValue(completedRate)})`,
            `  Failed: ${formatMetricValue(failed)} (${formatMetricValue(failedRate)})`,
            `  Cancelled: ${formatMetricValue(cancelled)} (${formatMetricValue(cancelledRate)})`
          );

        }

        lines.push(
          `  Purchasing Users: ${formatMetricValue(purchasingUsers)}`,
          `  Purchase Amount: ${formatMetricValue(purchaseAmount)}`,
          `  Avg Purchase Amount: ${formatMetricValue(avgPurchaseAmount)}`,
          ''
        );

      }
    );

  if (
    filteredRecords.length > 10
  ) {

    lines.push(
      `_Showing first 10 of ${filteredRecords.length} results._`
    );

  }

  return {
    text:
      lines.join(
        '\n'
      ).trim()
  };

}
function buildRedemptionMonitorMessage(
  monitor,
  rangeText,
  records,
  filters
) {

  const activeFilters =
    filters || {};

  const hasFilters =
    Object.keys(
      activeFilters
    ).length > 0;

  const filteredRecords =
    filterRedemptionRecords(
      records,
      activeFilters
    );

  const filterText =
    formatRedemptionFilterLabel(
      activeFilters
    );

  /*
   * No data after filtering.
   */
  if (
    filteredRecords.length === 0
  ) {

    return {
      text:
        [
          `📊 *${monitor.displayName || monitor.name}*`,
          '',
          `*Time range:* ${rangeText}`,
          hasFilters
            ? `*Filter:* ${filterText}`
            : null,
          '*Results:* 0 row(s)',
          '',
          hasFilters
            ? 'No redemption events recorded matching the filter within the time range, please try a different time range or filter.'
            : 'No redemption events recorded within the time range, please try a different time range.'
        ]
          .filter(
            line =>
              line !== null
          )
          .join(
            '\n'
          )
    };

  }

  /*
   * Keep the compact table format.
   *
   * Client | Type | Status | Events | Users
   */
  const widths = {
    client: 9,
    type: 13,
    status: 17,
    events: 9
  };

  const header =
    'Client'.padEnd(
      widths.client
    ) +
    'Type'.padEnd(
      widths.type
    ) +
    'Status'.padEnd(
      widths.status
    ) +
    'Events'.padEnd(
      widths.events
    ) +
    'Users';

  const separator =
    '-'.repeat(
      header.length
    );

  const rows =
    filteredRecords.map(
      row => {

        const clientType =
          String(
            row.client_type ||
            'Unknown'
          );

        const type =
          String(
            row.type ||
            'Unknown'
          );

        const status =
          String(
            row.status ||
            'Unknown'
          );

        const totalEvents =
          formatMetricValue(
            row.total_events
          );

        const uniqueUsers =
          formatMetricValue(
            row.unique_users
          );

        return (
          clientType.padEnd(
            widths.client
          ) +
          type.padEnd(
            widths.type
          ) +
          status.padEnd(
            widths.status
          ) +
          totalEvents.padEnd(
            widths.events
          ) +
          uniqueUsers
        );

      }
    );

  const lines = [
    `📊 *${monitor.displayName || monitor.name}*`,
    '',
    `*Time range:* ${rangeText}`
  ];

  if (
    hasFilters
  ) {

    lines.push(
      `*Filter:* ${filterText}`
    );

  }

  lines.push(
    `*Results:* ${filteredRecords.length} row(s)`,
    '',
    '```',
    header,
    separator,
    ...rows,
    '```'
  );

  return {
    text:
      lines.join(
        '\n'
      )
  };

}
/*
 * ----------------------------------------------------------
 * EXECUTE INTENT
 * ----------------------------------------------------------
 */

async function executeIntent(
  intent
) {

  /*
   * HELP
   */
  if (
    intent.action === 'help'
  ) {

    return helpMessage();

  }

  /*
   * Validate monitor.
   */
  if (
    !intent.monitor ||
    !ALLOWED_MONITORS.includes(
      intent.monitor
    )
  ) {

    return cannotUnderstandMessage();

  }

  const monitor =
    getMonitor(
      intent.monitor
    );

  if (
    !monitor
  ) {

    return cannotUnderstandMessage();

  }

  /*
   * ----------------------------------------------------------
   * COMPARE
   * ----------------------------------------------------------
   */

  if (
    intent.action === 'compare'
  ) {

    const comparison =
      normalizeComparison(
        intent.comparison
      );

    if (
      !comparison
    ) {

      return {
        text:
          'Sorry, I cannot proceed with this comparison. Please specify two periods to compare, for example `yesterday vs two days ago`.'
      };

    }

    if (
      JSON.stringify(
        comparison.left
      ) ===
      JSON.stringify(
        comparison.right
      )
    ) {

      return {
        text:
          'Sorry, I cannot compare the same time period against itself. Please specify two different periods.'
      };

    }

    const leftWindow =
      comparisonPeriodToWindowName(
        comparison.left
      );

    const rightWindow =
      comparisonPeriodToWindowName(
        comparison.right
      );

    if (
      !leftWindow ||
      !rightWindow
    ) {

      return {
        text:
          'Sorry, I cannot run this comparison because one or both time periods are not supported.'
      };

    }

    const leftRangeMode =
      comparisonPeriodRangeMode(
        comparison.left
      );

    const rightRangeMode =
      comparisonPeriodRangeMode(
        comparison.right
      );

    console.log(
      `🔎 Running comparison: ` +
      `${intent.monitor} | ` +
      `${leftWindow} vs ${rightWindow}`
    );

    console.log(
      `Range modes: ` +
      `${leftRangeMode} vs ${rightRangeMode}`
    );

    /*
     * Run left period.
     */
    await runScript(
      'run-and-extract.js',
      [
        intent.monitor,
        leftWindow,
        leftRangeMode
      ]
    );

    /*
     * Run right period.
     */
    await runScript(
      'run-and-extract.js',
      [
        intent.monitor,
        rightWindow,
        rightRangeMode
      ]
    );

    /*
     * Read both generated files.
     *
     * IMPORTANT:
     * Use monitor.name, not monitor.slug.
     *
     * Example:
     * purchase_response-yesterday.json
     * purchase_response-two_days_ago.json
     */
    const leftPath =
      path.join(
        ROOT,
        'reports',
        'raw',
        `${monitor.name}-${leftWindow}.json`
      );

    const rightPath =
      path.join(
        ROOT,
        'reports',
        'raw',
        `${monitor.name}-${rightWindow}.json`
      );

    const leftRaw =
      readJsonFile(
        leftPath
      );

    const rightRaw =
      readJsonFile(
        rightPath
      );

    const leftRecords =
      getRecords(
        leftRaw
      );

    const rightRecords =
      getRecords(
        rightRaw
      );

    return buildComparisonMessage(
      monitor,
      comparison,
      leftRecords,
      rightRecords
    );

  }

  /*
   * ----------------------------------------------------------
   * NORMALIZE TIME RANGE
   * ----------------------------------------------------------
   */

  const timeRange =
    normalizeTimeRange(
      intent.time_range
    );

  if (
    intent.time_range &&
    !timeRange
  ) {

    return cannotUnderstandMessage();

  }

  /*
   * ----------------------------------------------------------
   * RUN
   * ----------------------------------------------------------
   */

  if (
    intent.action === 'run'
  ) {

    const runTimeRange =
      timeRangeToWindowName(
        timeRange
      );

    console.log(
      `🤖 QA Sentinel run: ` +
      `${intent.monitor} | ` +
      `${runTimeRange}`
    );

    await runScript(
      'run-and-extract.js',
      [
        intent.monitor,
        runTimeRange
      ]
    );

    return {
      text:
        `✅ *${monitor.displayName || monitor.name}* monitor completed.\n\n` +
        `Window: \`${formatTimeRange(timeRange)}\``
    };

  }

  /*
   * ----------------------------------------------------------
   * CHECK
   * ----------------------------------------------------------
   *
   * check executes a fresh Splunk query.
   *
   * check
   *   ↓
   * run-and-extract.js
   *   ↓
   * Splunk
   *   ↓
   * JSON
   *   ↓
   * Slack result
   */

  if (
    intent.action === 'check'
  ) {

    const runTimeRange =
      timeRangeToWindowName(
        timeRange
      );

    console.log(
      `🔎 Running Splunk check: ` +
      `${intent.monitor} | ` +
      `${runTimeRange}`
    );

    await runScript(
      'run-and-extract.js',
      [
        intent.monitor,
        runTimeRange
      ]
    );

    /*
     * run-and-extract.js creates:
     *
     * reports/raw/
     *   <monitor>-<window>.json
     *
     * Use monitor.name because the actual
     * runner output uses names such as:
     *
     * purchase_response-yesterday.json
     */
    const rawPath =
      path.join(
        ROOT,
        'reports',
        'raw',
        `${monitor.name}-${runTimeRange}.json`
      );

    const raw =
      readJsonFile(
        rawPath
      );

    const records =
      getRecords(
        raw
      );

    const rangeText =
      formatTimeRange(
        timeRange
      );

    /*
     * --------------------------------------------------------
     * SPIN EVENT
     * --------------------------------------------------------
     */

    if (
      intent.monitor ===
      'spin_event'
    ) {

      return buildSpinMonitorMessage(
        monitor,
        rangeText,
        records,
        intent.filters || {}
      );

    }
    if (
  intent.monitor ===
  'purchase_response'
) {

  return buildPurchaseMonitorMessage(
    monitor,
    rangeText,
    records,
    intent.filters || {}
  );


}
if (
  intent.monitor ===
  'redemption'
) {
return buildRedemptionMonitorMessage(
  monitor,
  rangeText,
  records,
  intent.filters || {}
);

}

    /*
     * --------------------------------------------------------
     * CLIENT ERROR
     * --------------------------------------------------------
     */

    if (
      intent.monitor ===
      'client_error'
    ) {

      if (
        records.length === 0
      ) {

        return {
          text:
            `📱 *Client Error*\n\n` +
            `*Time range:* ${rangeText}\n\n` +
            '✅ No client errors found.'
        };

      }

      /*
       * Sort by total_errors descending.
       */
      const sorted =
        [...records]
          .sort(
            (
              a,
              b
            ) =>
              Number(
                b.total_errors || 0
              ) -
              Number(
                a.total_errors || 0
              )
          )
          .slice(
            0,
            10
          );

      const lines =
        sorted.map(
          (
            row,
            index
          ) => {

            const clientType =
              row.client_type ||
              'Unknown';

            const message =
              row.message ||
              'Unknown error';

            const count =
              Number(
                row.total_errors || 0
              );

            return (
              `${index + 1}. ` +
              `*${clientType}* — ` +
              `${message} — ` +
              `*${count.toLocaleString('en-US')}*`
            );

          }
        );

      const totalErrors =
        records.reduce(
          (
            sum,
            row
          ) =>
            sum +
            Number(
              row.total_errors || 0
            ),
          0
        );

      return {
        text:
          `📱 *Client Error — Top ${sorted.length}*\n\n` +
          `*Time range:* ${rangeText}\n\n` +
          lines.join('\n') +
          `\n\n*Total errors:* ` +
          `${totalErrors.toLocaleString('en-US')}`
      };

    }

    /*
     * --------------------------------------------------------
     * GENERIC MONITOR
     * --------------------------------------------------------
     */

    if (
      records.length === 0
    ) {

      return {
        text:
          `📊 *${monitor.displayName || monitor.name}*\n\n` +
          `*Time range:* ${rangeText}\n\n` +
          'No data found.'
      };

    }

    return buildGenericPurchaseTableMessage(
      monitor,
      rangeText,
      records
    );

  }

  /*
   * ----------------------------------------------------------
   * ANALYZE
   * ----------------------------------------------------------
   */

  if (
    intent.action === 'analyze'
  ) {

    return {
      text:
        `🤖 *${monitor.displayName || monitor.name}* AI analysis is not enabled yet.`
    };

  }

  return cannotUnderstandMessage();

}

/*
 * ----------------------------------------------------------
 * GEMINI COMMAND LAYER
 * ----------------------------------------------------------
 */

function buildNaturalQueryPreview(
  intent,
  context
) {

  const requestedFields =
    Array.isArray(intent.requested_fields)
      ? intent.requested_fields
      : [];

  const filters =
    Array.isArray(intent.filters)
      ? intent.filters
      : [];

  const lines = [
    '🧠 *QA Sentinel — Natural Query Interpretation*',
    '',
    `*Action:* ${intent.action || '—'}`,
    `*Player:* ${intent.subject?.player_id ?? '—'}`,
    `*Game:* ${intent.scope?.game_id || intent.scope?.game_name || '—'}`,
    `*Unit:* ${intent.scope?.unit_name || '—'}`,
    `*Time:* ${formatTimeRange(intent.time_range)}`,
    `*Requested fields:* ${requestedFields.length ? requestedFields.join(', ') : '—'}`,
    '',
    '*Filters:*'
  ];

  if (filters.length === 0) {
    lines.push('• —');
  } else {
    filters.forEach(filter => {
      lines.push(`• ${filter.field} ${filter.operator} ${filter.value}`);
    });
  }

  if (
    Array.isArray(intent.unresolved_terms) &&
    intent.unresolved_terms.length > 0
  ) {
    lines.push(
      '',
      `⚠️ *Unresolved:* ${intent.unresolved_terms.join(', ')}`
    );
  }

  lines.push(
    '',
    '⏭ Query execution is not enabled yet. The structured intent has been saved for the Query Resolver phase.'
  );

  return {
    text: lines.join('\n'),
    naturalQuery: true,
    intent,
    context
  };
}

function getConversationPlayerId(context) {
  const candidates = [
    context?.player_id,
    context?.subject?.player_id,
    context?.current_player_id,
    context?.current?.player_id
  ];

  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim();
    if (value) return value;
  }

  return '';
}

function getExplicitPlayerIdFromCommand(command) {
  const text = String(command || '');
  const patterns = [
    /\b(?:player|user|game[\s_-]*user)\s*#?\s*(\d{4,})\b/i,
    /\bplayer[_\s-]*id\s*[:=]?\s*(\d{4,})\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return String(match[1]).trim();
  }

  return '';
}

function applySharedPlayerContext({
  intent,
  previousContext,
  command
}) {
  if (!intent || typeof intent !== 'object') {
    return intent;
  }

  const action = String(intent.action || '').trim().toLowerCase();
  const sharedActions = new Set([
    'spin',
    'spin_event',
    'purchase',
    'purchase_response',
    'redemption',
    'redeem'
  ]);

  if (!sharedActions.has(action)) {
    return intent;
  }

  const explicitPlayerId =
    getExplicitPlayerIdFromCommand(command);
  const inheritedPlayerId =
    getConversationPlayerId(previousContext);
  const intentPlayerId = String(
    intent.subject?.player_id ?? ''
  ).trim();

  const effectivePlayerId =
    explicitPlayerId ||
    (!explicitPlayerId && inheritedPlayerId
      ? inheritedPlayerId
      : intentPlayerId);

  if (!effectivePlayerId) {
    return intent;
  }

  intent.subject = {
    ...(intent.subject || {}),
    player_id: effectivePlayerId
  };

  const existingFilters = Array.isArray(intent.filters)
    ? intent.filters
    : [];

  const withoutPlayerFilter =
    existingFilters.filter(filter => {
      const field = String(filter?.field || '')
        .trim()
        .toLowerCase();

      return field !==
        'payload.clientpayload.game_user_id';
    });

  intent.filters = [
    ...withoutPlayerFilter,
    {
      field: 'Payload.ClientPayload.game_user_id',
      operator: 'equals',
      value: effectivePlayerId
    }
  ];

  return intent;
}

async function handleGeminiCommand({
  command,
  channelId,
  threadTs
}) {

  const previousContext =
    loadContext({
      channelId,
      threadTs
    });

  const interpreted =
    await interpretCommand({
      command,
      conversationContext:
        buildParserContext(
          previousContext
        )
    });

  console.log(
    '🧠 Gemini command route:',
    JSON.stringify(
      interpreted,
      null,
      2
    )
  );

  if (
    interpreted.route ===
    'natural_query'
  ) {

    const intent =
      interpreted.query_intent;

    if (
      !intent ||
      intent.understood !== true
    ) {
      return null;
    }

    applySharedPlayerContext({
      intent,
      previousContext,
      command
    });

    const nextContext =
      mergeConversationContext(
        previousContext,
        intent
      );

    const savedContext =
      saveContext({
        channelId,
        threadTs,
        context: nextContext
      });

    try {
      return await resolveNaturalQuery(
        intent
      );
    } catch (error) {
      return {
        text:
          `❌ *Natural Query could not be executed.*\n\n${error.message}`,
        naturalQuery: true,
        queryResult: false,
        intent,
        context: savedContext
      };
    }
  }

  if (
    interpreted.route ===
    'help'
  ) {
    return helpMessage();
  }

  if (
    interpreted.route ===
    'legacy_monitor'
  ) {

    const intent =
      interpreted.legacy_intent;

    if (
      !intent ||
      intent.understood !== true
    ) {
      return null;
    }

    return {
      __geminiLegacyIntent: true,
      intent
    };
  }

  return null;
}

function applyLegacyOutputFilters(
  intent,
  normalized
) {

  if (
    intent.monitor ===
    'spin_event'
  ) {
    intent.filters =
      parseSpinFilters(
        normalized
      );
  }

  if (
    intent.monitor ===
    'purchase_response'
  ) {
    intent.filters =
      parsePurchaseFilters(
        normalized
      );
  }

  if (
    intent.monitor ===
    'redemption'
  ) {
    intent.filters =
      parseRedemptionFilters(
        normalized
      );
  }

  return intent;
}

/*
 * ----------------------------------------------------------
 * HANDLE COMMAND
 * ----------------------------------------------------------
 */

async function handleCommand({
  command,
  channelId,
  threadTs
}) {

  const normalized =
    normalizeCommand(
      command
    );

  if (!normalized) {
    return helpMessage();
  }

  if (GEMINI_COMMAND_ROUTER_ENABLED) {

    try {
      const geminiResult =
        await handleGeminiCommand({
          command: normalized,
          channelId,
          threadTs
        });

      if (
        geminiResult &&
        geminiResult.text
      ) {
        return geminiResult;
      }

      if (
        geminiResult &&
        geminiResult.__geminiLegacyIntent
      ) {

        let intent =
          geminiResult.intent;

        intent =
          applyLegacyOutputFilters(
            intent,
            normalized
          );

        console.log(
          '🧩 Gemini legacy intent:',
          JSON.stringify(
            intent,
            null,
            2
          )
        );

        return await executeIntent(
          intent
        );
      }

    } catch (error) {
      console.error(
        `⚠️ Gemini command layer failed: ${error.message}`
      );
      console.log(
        '↩️ Falling back to existing command parser.'
      );
    }
  }

  let intent;

  try {
    intent =
      await parseIntent(
        normalized
      );
  } catch (error) {
    throw new Error(
      `Intent parsing failed: ${error.message}`
    );
  }

  console.log(
    '🧩 Parsed intent:',
    JSON.stringify(
      intent,
      null,
      2
    )
  );

  if (
    !intent ||
    intent.understood !== true
  ) {
    return cannotUnderstandMessage();
  }

  intent =
    applyLegacyOutputFilters(
      intent,
      normalized
    );

  try {
    return await executeIntent(
      intent
    );
  } catch (error) {
    throw new Error(
      `Query execution failed: ${error.message}`
    );
  }

}

/*
 * ----------------------------------------------------------
 * EXPORTS
 * ----------------------------------------------------------
 */

module.exports = {
  handleCommand,
  parseIntent,
  normalizeTimeRange,
  timeRangeToMinutes,
  formatTimeRange,
  handleGeminiCommand,
  applyLegacyOutputFilters,
  buildNaturalQueryPreview
};