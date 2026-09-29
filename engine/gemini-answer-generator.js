const https = require('https');

require('dotenv').config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL =
  process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

function callGemini(prompt) {
  return new Promise((resolve, reject) => {
    if (!GEMINI_API_KEY) {
      reject(new Error('GEMINI_API_KEY is not configured.'));
      return;
    }

    const body = JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2200
      }
    });

    const req = https.request(
      {
        hostname: 'generativelanguage.googleapis.com',
        path:
          `/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}` +
          `:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      res => {
        let raw = '';

        res.on('data', chunk => {
          raw += chunk.toString();
        });

        res.on('end', () => {
          let parsed;

          try {
            parsed = JSON.parse(raw);
          } catch (error) {
            reject(new Error(`Invalid Gemini answer response: ${raw.slice(0, 500)}`));
            return;
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(
              new Error(
                parsed?.error?.message ||
                `Gemini answer HTTP ${res.statusCode}`
              )
            );
            return;
          }

          resolve(parsed);
        });
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function extractText(response) {
  return response?.candidates
    ?.flatMap(candidate => candidate.content?.parts || [])
    ?.map(part => part?.text || '')
    ?.filter(Boolean)
    ?.join('')
    ?.trim() || '';
}

function cleanText(text) {
  return String(text || '')
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function getField(row, logical) {
  return (
    row?.[logical] ??
    row?.[`Payload.ClientPayload.${logical}`] ??
    null
  );
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatNumber(value) {
  const n = toNumber(value);
  return n === null
    ? '—'
    : n.toLocaleString('en-US', {
        maximumFractionDigits: 6
      });
}

function formatDate(value) {
  if (!value) return '—';

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return String(value);
  }

  return d.toISOString().slice(0, 10);
}

function isNoDataNarrative(text) {
  return /\b(no|not|zero)\b.{0,100}\b(matching|spin|record|activity|data|found)\b/i.test(
    String(text || '')
  );
}

function evidenceById(evidence, id) {
  return (
    Array.isArray(evidence)
      ? evidence.find(item => item.id === id)
      : null
  );
}

function rowsFor(evidence, id) {
  return evidenceById(evidence, id)?.records || [];
}

function topWinRows(records) {
  return (Array.isArray(records) ? records : [])
    .map(row => ({
      date: formatDate(getField(row, 'time_stamp')),
      gameId: getField(row, 'game_id') || '—',
      provider: getField(row, 'game_provider_id') || '—',
      unit: getField(row, 'unit_name') || '—',
      bet: toNumber(getField(row, 'bet_value')),
      win: toNumber(getField(row, 'win_amount')),
      winType: getField(row, 'win_type') || '—'
    }))
    .filter(row => row.win !== null && row.win > 0)
    .sort((a, b) => b.win - a.win)
    .slice(0, 10);
}

function buildTopWinsTable(rows) {
  if (!rows.length) return '';

  const lines = [
    '*Top 10 Biggest Wins*',
    '',
    '| # | Date | Game ID | Game Provider | Bet | Win | Multiplier |',
    '|---:|---|---|---|---:|---:|---:|'
  ];

  rows.forEach((row, index) => {
    const multiplier =
      row.bet !== null && row.bet > 0
        ? `${(row.win / row.bet).toFixed(2)}x`
        : '—';

    lines.push(
      `| ${index + 1} | ${row.date} | ` +
      `${String(row.gameId).replace(/\|/g, '\\|')} | ` +
      `${String(row.provider).replace(/\|/g, '\\|')} | ` +
      `${row.bet === null ? '—' : formatNumber(row.bet)} ${row.unit} | ` +
      `${formatNumber(row.win)} ${row.unit} | ${multiplier} |`
    );
  });

  return lines.join('\n');
}

function gameListRows(records) {
  return (Array.isArray(records) ? records : [])
    .map(row => ({
      gameId: getField(row, 'game_id') || '—',
      provider: getField(row, 'game_provider_id') || '—',
      spins: toNumber(
        row.spin_count ??
        row.event_count
      )
    }))
    .filter(row => row.gameId !== '—')
    .sort((a, b) => (b.spins || 0) - (a.spins || 0));
}

function buildGameListTable(rows) {
  if (!rows.length) return '';

  const lines = [
    '*Games Played*',
    '',
    '| # | Game ID | Game Provider | Spins |',
    '|---:|---|---|---:|'
  ];

  rows.forEach((row, index) => {
    lines.push(
      `| ${index + 1} | ` +
      `${String(row.gameId).replace(/\|/g, '\\|')} | ` +
      `${String(row.provider).replace(/\|/g, '\\|')} | ` +
      `${row.spins === null ? '—' : formatNumber(row.spins)} |`
    );
  });

  return lines.join('\n');
}

function sumEvidence(evidence, id, field) {
  const rows = rowsFor(evidence, id);

  if (!rows.length) return 0;

  const value =
    getField(rows[0], field) ??
    rows[0][field];

  return toNumber(value) ?? 0;
}

function activeDayCount(evidence, id) {
  return rowsFor(evidence, id).length;
}

function overviewMetrics(evidence) {
  const spinsRows =
    rowsFor(evidence, 'total_spins');

  const gamesRows =
    rowsFor(evidence, 'games_played');

  const spins =
    toNumber(
      spinsRows[0]?.matching_events
    ) ?? 0;

  const games =
    toNumber(
      gamesRows[0]?.distinct_count
    ) ?? 0;

  const wagered =
    sumEvidence(
      evidence,
      'wagered',
      'bet_value'
    );

  const won =
    sumEvidence(
      evidence,
      'won',
      'win_amount'
    );

  return {
    spins,
    games,
    activeDays:
      activeDayCount(
        evidence,
        'active_days'
      ),
    wagered,
    won,
    net:
      won - wagered
  };
}

function buildOverviewDeterministic({
  intent,
  evidence,
  timeRange
}) {
  const metrics =
    overviewMetrics(
      evidence
    );

  const player =
    intent?.subject?.player_id ??
    'the player';

  const topRows =
    topWinRows(
      rowsFor(
        evidence,
        'top_wins'
      )
    );

  const time =
    timeRange?.type === 'relative'
      ? `the last ${timeRange.amount} ${timeRange.unit}`
      : 'the requested period';

  const overview = [
    `Here’s the gameplay overview for player ${player} over ${time}:`,
    '',
    `*Total Spins:* ${formatNumber(metrics.spins)}`,
    `*Games Played:* ${formatNumber(metrics.games)}`,
    `*Active Days:* ${formatNumber(metrics.activeDays)}`,
    `*Wagered:* ${formatNumber(metrics.wagered)}`,
    `*Won:* ${formatNumber(metrics.won)}`,
    `*Net:* ${formatNumber(metrics.net)}`
  ].join('\n');

  const table =
    buildTopWinsTable(
      topRows
    );

  return table
    ? `${overview}\n\n${table}`
    : overview;
}

function buildPrompt({
  command,
  intent,
  plan,
  evidence
}) {
  const safeEvidence =
    (Array.isArray(evidence) ? evidence : [])
      .map(item => ({
        id: item.id,
        purpose: item.purpose,
        action: item.action,
        operation: item.operation,
        requested_fields: item.requested_fields,
        group_by: item.group_by,
        metric_field: item.metric_field,
        records: item.records
      }));

  return [
    'You are QA Sentinel final answer generator.',
    '',
    'Use ONLY the evidence supplied below.',
    'Never invent facts, values, dates, games, providers, devices, causes, or events.',
    'Never say "no matching records" if ANY evidence query contains records.',
    'A zero from one filtered query does not mean the overall question has no activity.',
    'Distinguish no jackpot events from no spin activity.',
    'Do not claim crash, disconnect, freeze, or technical interruption without error evidence.',
    'For an inactivity gap, describe it as an observed activity gap and clearly label any interpretation.',
    'Use "Game Provider" for game_provider_id. Do not call game_name "Game Provider".',
    'Do not expose implementation details such as Gemini, SPL, Query Planner, or Query Resolver.',
    '',
    'Answer directly first.',
    'Use a table when the evidence is naturally tabular.',
    'Use concise Key Takeaways only when useful.',
    'State a limitation when the BI evidence cannot prove the requested conclusion.',
    '',
    `USER QUESTION:\n${command || ''}`,
    '',
    `RESOLVED INTENT:\n${JSON.stringify(intent || {}, null, 2)}`,
    '',
    `QUERY PLAN:\n${JSON.stringify(plan || {}, null, 2)}`,
    '',
    `EVIDENCE:\n${JSON.stringify(safeEvidence, null, 2)}`
  ].join('\n');
}

async function generateNaturalAnswer({
  command,
  intent,
  plan,
  evidence,
  fallbackText,
  timeRange
}) {
  const safeEvidence =
    Array.isArray(evidence)
      ? evidence
      : [];

  /*
   * Deterministic structures are generated from evidence first.
   * Gemini supplies narrative only.
   */
  if (
    plan?.response_type ===
    'overview'
  ) {
    const deterministic =
      buildOverviewDeterministic({
        intent,
        evidence:
          safeEvidence,
        timeRange
      });

    try {
      const response =
        await callGemini(
          buildPrompt({
            command,
            intent,
            plan,
            evidence:
              safeEvidence
          })
        );

      const narrative =
        cleanText(
          extractText(response)
        );

      if (
        narrative &&
        !isNoDataNarrative(
          narrative
        )
      ) {
        const rows =
          topWinRows(
            rowsFor(
              safeEvidence,
              'top_wins'
            )
          );

        return {
          text:
            narrative +
            (
              rows.length
                ? `\n\n${buildTopWinsTable(rows)}`
                : ''
            ),
          naturalQuery: true,
          queryResult: true,
          aiGenerated: true,
          intent,
          plan,
          evidence:
            safeEvidence
        };
      }
    } catch (error) {
      console.error(
        `⚠️ Gemini answer generation failed: ${error.message}`
      );
    }

    return {
      text: deterministic,
      naturalQuery: true,
      queryResult: true,
      aiGenerated: false,
      intent,
      plan,
      evidence:
        safeEvidence
    };
  }

  if (
    plan?.response_type ===
    'game_list'
  ) {
    const rows =
      gameListRows(
        rowsFor(
          safeEvidence,
          'game_list'
        )
      );

    if (!rows.length) {
      return {
        text:
          `I couldn't find recorded spin activity for player ${intent?.subject?.player_id ?? 'the player'} in the requested period.`,
        naturalQuery: true,
        queryResult: true,
        aiGenerated: false,
        intent,
        plan,
        evidence:
          safeEvidence
      };
    }

    const table =
      buildGameListTable(
        rows
      );

    try {
      const response =
        await callGemini(
          buildPrompt({
            command,
            intent,
            plan,
            evidence:
              safeEvidence
          })
        );

      const narrative =
        cleanText(
          extractText(response)
        );

      if (
        narrative &&
        !isNoDataNarrative(
          narrative
        )
      ) {
        return {
          text:
            `${narrative}\n\n${table}`,
          naturalQuery: true,
          queryResult: true,
          aiGenerated: true,
          intent,
          plan,
          evidence:
            safeEvidence
        };
      }
    } catch (error) {
      console.error(
        `⚠️ Gemini answer generation failed: ${error.message}`
      );
    }

    return {
      text:
        `I found ${rows.length} game(s) with recorded spin activity for player ${intent?.subject?.player_id ?? 'the player'}.\n\n${table}`,
      naturalQuery: true,
      queryResult: true,
      aiGenerated: false,
      intent,
      plan,
      evidence:
        safeEvidence
    };
  }

  if (
    plan?.response_type ===
      'top_wins' ||
    plan?.response_type ===
      'jackpot'
  ) {
    const id =
      plan.response_type ===
      'jackpot'
        ? 'jackpot_wins'
        : 'top_wins';

    const rows =
      topWinRows(
        rowsFor(
          safeEvidence,
          id
        )
      );

    const player =
      intent?.subject?.player_id ??
      'the player';

    const time =
      timeRange?.type ===
      'relative'
        ? `the last ${timeRange.amount} ${timeRange.unit}`
        : 'the requested period';

    if (!rows.length) {
      const prefix =
        plan.response_type ===
        'jackpot'
          ? 'I couldn’t find any recorded jackpot wins'
          : 'I couldn’t find any positive recorded wins';

      return {
        text:
          `${prefix} for player ${player} over ${time}.`,
        naturalQuery: true,
        queryResult: true,
        aiGenerated: false,
        intent,
        plan,
        evidence:
          safeEvidence
      };
    }

    const deterministic =
      plan.response_type ===
      'jackpot'
        ? `I found recorded jackpot win activity for player ${player} over ${time}.`
        : `Here are the biggest recorded wins for player ${player} over ${time}.`;

    try {
      const response =
        await callGemini(
          buildPrompt({
            command,
            intent,
            plan,
            evidence:
              safeEvidence
          })
        );

      const narrative =
        cleanText(
          extractText(response)
        );

      if (
        narrative &&
        !isNoDataNarrative(
          narrative
        )
      ) {
        return {
          text:
            `${narrative}\n\n${buildTopWinsTable(rows)}`,
          naturalQuery: true,
          queryResult: true,
          aiGenerated: true,
          intent,
          plan,
          evidence:
            safeEvidence
        };
      }
    } catch (error) {
      console.error(
        `⚠️ Gemini answer generation failed: ${error.message}`
      );
    }

    return {
      text:
        `${deterministic}\n\n${buildTopWinsTable(rows)}`,
      naturalQuery: true,
      queryResult: true,
      aiGenerated: false,
      intent,
      plan,
      evidence:
        safeEvidence
    };
  }

  if (
    safeEvidence.length > 0 &&
    safeEvidence.some(
      item =>
        Array.isArray(item.records) &&
        item.records.length > 0
    )
  ) {
    try {
      const response =
        await callGemini(
          buildPrompt({
            command,
            intent,
            plan,
            evidence:
              safeEvidence
          })
        );

      const narrative =
        cleanText(
          extractText(response)
        );

      if (
        narrative &&
        !isNoDataNarrative(
          narrative
        )
      ) {
        return {
          text:
            narrative,
          naturalQuery: true,
          queryResult: true,
          aiGenerated: true,
          intent,
          plan,
          evidence:
            safeEvidence
        };
      }
    } catch (error) {
      console.error(
        `⚠️ Gemini answer generation failed: ${error.message}`
      );
    }
  }

  return {
    text:
      fallbackText,
    naturalQuery: true,
    queryResult: true,
    aiGenerated: false,
    intent,
    plan,
    evidence:
      safeEvidence
  };
}

module.exports = {
  generateNaturalAnswer,
  buildTopWinsTable,
  buildTopWinsRows: topWinRows,
  buildGameListTable,
  buildGameListRows: gameListRows,
  overviewMetrics
};
