QA Sentinel Monitor Update v2

QA Sentinel is a Splunk-based monitoring pipeline for collecting,
comparing, reporting, and reviewing production metrics.

============================================================
1. MONITOR QUERIES
============================================================

SPL queries are stored in:

qa-sentinel/queries/

Current monitor queries:

- spin_event.spl
- purchase_response.spl
- login.spl
- signup.spl
- redemption.spl
- client_error.spl
- quest.spl

When adding or updating a monitor query, make sure the query
output matches the dimensions and metrics configured in:

monitor-config.json


============================================================
2. RUN ALL MONITORS
============================================================

Run the complete monitoring pipeline:

node run-all-monitors.js

This runs all enabled monitors according to monitor-config.json.

The pipeline can include:

- Data collection
- Comparison
- Alert detection
- Report generation
- AI review


============================================================
3. RUN A SINGLE MONITOR
============================================================

Run-and-extract supports these time windows:

- current
- previous
- yesterday
- two_days_ago


Example: collect the current Spin data:

node run-and-extract.js spin_event current


Example: collect the previous Spin window:

node run-and-extract.js spin_event previous


Example: collect yesterday's Spin window:

node run-and-extract.js spin_event yesterday


Example: collect 2-days-ago Spin data:

node run-and-extract.js spin_event two_days_ago


============================================================
4. QUEST MONITOR
============================================================

Quest is a report-only monitor.

Quest does not use the standard comparison/alert flow.
It generates a Slack report containing:

- Overall Quest Activity
- Current Quest Activity in a Slack thread
- Quest Index
- VIP Tier
- Completed Quests
- Users


Run Quest for the current window only:

node run-and-extract.js quest current


Run Quest for the previous window:

node run-and-extract.js quest previous


Run Quest for yesterday:

node run-and-extract.js quest yesterday


Run Quest for 2-days-ago:

node run-and-extract.js quest two_days_ago


Collect Quest data for ALL timeframes:

node run-multi-window.js quest


Generate the Quest Slack report from the collected data:

node report-quest.js quest


Recommended Quest test flow after changing queries:

node run-multi-window.js quest
node report-quest.js quest


============================================================
5. RUN GENERIC COMPARISON
============================================================

For monitors with compareEnabled=true:

node compare-generic.js spin_event

node compare-generic.js purchase_response

node compare-generic.js login

node compare-generic.js signup

node compare-generic.js redemption


Quest does not normally use compare-generic.js because
compareEnabled=false.


============================================================
6. CLIENT ERROR REPORT
============================================================

Client Error is a report-only monitor.

Collect current Client Error data:

node run-and-extract.js client_error current


Generate the Slack Client Error report:

node report-client-error.js client_error


============================================================
7. GENERATED DATA
============================================================

Raw monitor data is stored under:

reports/raw/

Typical files include:

<monitor>-current.json
<monitor>-previous.json
<monitor>-yesterday.json
<monitor>-two_days_ago.json

Timestamped copies are also generated for historical/debugging
purposes.


============================================================
8. CONFIGURATION
============================================================

Monitor configuration is stored in:

monitor-config.json

Important configuration fields include:

- enabled
- dimensions
- metrics
- primaryMetric
- collectorEnabled
- compareEnabled
- alertEnabled
- reportEnabled
- collectorScript
- compareScript
- alertScript
- reportScript
- notificationChannel
- debugChannelIdEnvKey


============================================================
9. ENVIRONMENT / SECRETS
============================================================

Secrets and credentials are stored in:

.env

Do NOT commit or upload .env.

Examples of sensitive values include:

- OpenAI API keys
- Slack Bot Token
- Slack Webhook URLs
- Slack Channel IDs
- Other credentials


============================================================
10. SCHEDULER
============================================================

The scheduler runs the monitoring pipeline automatically
according to the configured schedule.

Start scheduler:

node scheduler.js


============================================================
11. USEFUL DEBUG COMMANDS
============================================================

Check JavaScript syntax:

node --check run-and-extract.js

node --check run-all-monitors.js

node --check report-quest.js

node --check engine/slack-notifier.js


Check current monitor configuration:

cat monitor-config.json


List generated Quest data:

ls -lh reports/raw/quest*


Inspect a Quest raw result:

cat reports/raw/quest-current.json


Inspect the 2-days-ago Quest result:

cat reports/raw/quest-two_days_ago.json


============================================================
12. NO-RESULT / FORCE TESTING
============================================================

For manually testing a no-result scenario:

node run-and-extract.js redemption yesterday --force-no-data

This creates an empty/no-data result for testing.

This option is intended for manual testing only.


============================================================
13. NOTES
============================================================

A no-result window can still make run-and-extract.js time out
if the Splunk UI does not produce a result state that the
collector can detect.

This is separate from a missing-query issue.

If Splunk is logged out or the Okta/Splunk session has expired,
the collector may stop at the login page instead of executing
the query.

For browser/session debugging, run the relevant collector
with headless mode disabled in run-and-extract.js.


============================================================
14. RECOMMENDED WORKFLOW AFTER CHANGING A QUERY
============================================================

For a normal monitor:

1. Update the .spl file.
2. Run the monitor for the desired window.
3. Check the generated raw JSON.
4. Run the comparison/report manually if required.
5. Run the full pipeline after confirming the result.

Example:

node run-and-extract.js spin_event current


For Quest:

1. Update queries/quest.spl
2. Collect all Quest timeframes:

node run-multi-window.js quest

3. Check the generated raw files:

ls -lh reports/raw/quest*

4. Generate the Slack report:

node report-quest.js quest


============================================================
15. FULL PRODUCTION RUN
============================================================

When all monitors are ready:

node run-all-monitors.js


============================================================