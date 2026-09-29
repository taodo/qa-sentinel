// Curated static catalog of the BI events that reach Splunk (index configured via SPLUNK_DEFAULT_INDEX).
//
// Source of truth: the two product repos on branch gear_release —
//   FE playsweeps-web:     POST {BI_EVENT_URL}/bi-event, bi_source="client", client_type="web"|"app".
//   BE playsweeps-backend: POST {BiEventUrl},            bi_source="server".
// The apps emit a record wrapped as { "Data": [ record ] }, but as INDEXED IN SPLUNK the collector nests
// every BI field under `Payload.ClientPayload.*` (confirmed from a real login event). So in SPL you must
// use the dotted path, e.g. `Payload.ClientPayload.action="login"` — NOT a bare `action="login"`.
// A few top-level fields sit outside that object: `env` (prod/stg/...), `source`, and
// `Payload.PartnerApplicationId` / `Payload.PartnerPlayerId`.
// The field NAMES below are the logical (unprefixed) names; prefix them with BI_FIELD_PREFIX when writing
// SPL. Field names are snake_case except a handful of KYC risk fields (mixedCase). The event name is the
// `action` field; events are grouped by the `flow` field.
//
// This catalog is hand-curated, so it can drift when the repos change. Refresh procedure is documented
// in CLAUDE.md ("BI event catalog"). Treat field lists as strong hints, not a guarantee.

// Every BI field is nested under this path in the Splunk-indexed JSON. Prefix logical field names with it
// in SPL (quote the dotted name in `by`/eval clauses to be safe), e.g. Payload.ClientPayload.game_id.
export const BI_FIELD_PREFIX = "Payload.ClientPayload.";

// Fields that live OUTSIDE Payload.ClientPayload (top-level or under Payload directly).
export const BI_TOP_LEVEL_FIELDS: string[] = [
  "env", // "prod" | "stg" | ...
  "source", // e.g. "3rd Party"
  "Payload.PartnerApplicationId",
  "Payload.PartnerPlayerId",
];

export interface BiEvent {
  /** Value of the `action` field. */
  name: string;
  /** Value of the `flow` field (event category). */
  flow: string;
  /** Which pipeline emits it. */
  source: "client" | "server" | "both";
  /** Event-specific fields beyond the common envelope (exact casing as sent to Splunk). */
  fields: string[];
  note?: string;
}

// Common envelope present on (nearly) every event, from both the FE clientStandardFields/standardFields
// and the BE GetBiEventStandardFields. Use these for filtering/grouping across event types.
export const BI_COMMON_FIELDS: string[] = [
  "bi_source", // "client" (FE) | "server" (BE)
  "action", // == the event name
  "flow", // event category (see BI_FLOWS)
  "time_stamp", // ISO8601
  "game_user_id", // player id (psaId); <=0 or absent for guests
  "game_session_id",
  "playlink_session_id",
  "urid", // per-event request/record uuid
  "client_type", // "web" | "app"
  "os_platform",
  "client_version_number",
  "client_build_number",
  "device_type", // "tablet" | "mobile" | "desktop"
  "connection_type",
  "browser_name",
  "screen_resolution",
  "ip_address", // real client IP; note client_ip is often null
  "client_ip",
  "country",
  "state",
  "geo_source",
  "identifier",
  "support_code",
  "email",
  "email_verified",
  "phone_verified",
  "verification_status",
  "myvip_tier_id",
  "registration_timestamp",
  "last_active_timestamp",
  "segments",
  "current_gold_balance",
  "current_sweep_balance",
  "current_redeemable_sweeps_balance",
  "current_lp_balance",
  "pending_gold_coin_wager",
  "pending_sweep_coin_wager",
  "ltd_iap_revenue_usd",
  "ltd_iap_purchases",
  "platform_advertiser_id",
  "mobile_advertiser_id",
  "developer_device_id",
  "referrer_url",
  "game_name", // product/app name, e.g. "playSWEEPSWinZone"
];

// Values seen in the `flow` field.
export const BI_FLOWS: string[] = [
  "session",
  "registration",
  "purchase",
  "redemption",
  "spin",
  "economy",
  "account",
  "inbox",
  "tutorial",
  "error",
  "quests",
];

// Curated events that are most useful to query, with their event-specific fields.
export const BI_EVENTS: BiEvent[] = [
  {
    name: "spin_event",
    flow: "spin",
    source: "server",
    fields: [
      "game_id",
      "game_zone",
      "game_provider_id",
      "unit_name", // "gold" | "sweep"
      "bet_amount",
      "bet_value",
      "max_bet",
      "win_amount",
      "win_type", // win | lose | grand_jackpot
      "spin_type", // regular | free_spin | buy_bonus
      "gameplay_session_id",
      "spin_event_id",
      "spin_duration_ms",
      "number_free_spin",
      "is_favorite",
    ],
  },
  {
    name: "bankruptcy",
    flow: "economy",
    source: "server",
    fields: ["game_id", "game_zone", "game_provider_id", "unit_name", "bankruptcy_index"],
  },
  {
    name: "purchase_attempt",
    flow: "purchase",
    source: "both",
    fields: [
      "price",
      "offer_id",
      "offer_index",
      "source",
      "offer_value", // JSON string {gold,sweep,myvip_tp}
      "gold_value",
      "sweep_value",
      "transaction_id",
      "trigger_id",
    ],
  },
  {
    name: "purchase_response",
    flow: "purchase",
    source: "both",
    fields: [
      "price",
      "offer_id",
      "source",
      "offer_value",
      "gold_value",
      "sweep_value",
      "transaction_id",
      "status", // success | fail
      "payment_type",
      "card_type",
      "details",
      "message",
    ],
  },
  {
    name: "first_purchase",
    flow: "purchase",
    source: "client",
    fields: ["price", "offer_id", "transaction_id", "gold_value", "sweep_value"],
  },
  {
    name: "myvip_purchase_attempt",
    flow: "purchase",
    source: "server",
    fields: ["transaction_id", "price", "offer_id", "source", "offer_value", "gold_value", "sweep_value"],
  },
  {
    name: "myvip_purchase_response",
    flow: "purchase",
    source: "server",
    fields: [
      "transaction_id",
      "price",
      "offer_id",
      "source",
      "status",
      "payment_type",
      "card_type",
      "details",
      "message",
    ],
  },
  {
    name: "redemption_attempt",
    flow: "redemption",
    source: "client",
    fields: ["type", "transaction_id", "redemption_provider"],
  },
  {
    name: "redemption_response",
    flow: "redemption",
    source: "both",
    fields: [
      "type",
      "transaction_id",
      "redemption_provider",
      "amount",
      "reward_id",
      "type_id",
      "status",
      "details",
      "redemption_history",
    ],
  },
  {
    name: "redemption_complete",
    flow: "redemption",
    source: "server",
    fields: ["type", "transaction_id", "redemption_provider", "amount", "reward_id", "type_id", "status", "details"],
  },
  {
    name: "update_balance",
    flow: "economy",
    source: "server",
    fields: ["spend_amount", "collect_amount", "unit_name", "source", "source_name", "source_id", "myvip_tier_id"],
  },
  {
    name: "loyalty_cap_reached",
    flow: "economy",
    source: "server",
    fields: ["spend_amount", "collect_amount", "unit_name", "source", "source_name", "source_id", "myvip_tier_id"],
  },
  {
    name: "myvip_connect_attempt",
    flow: "economy",
    source: "client",
    fields: ["emailverified"],
  },
  {
    name: "myvip_connect_response",
    flow: "economy",
    source: "both",
    fields: ["myvip_tier_id", "connection_type", "support_code", "emailverified", "clientpayload_source", "status"],
  },
  {
    name: "session_start",
    flow: "session",
    source: "client",
    fields: [
      "internet_connection",
      "browser_version",
      "os_version",
      "device_model",
      "color_depth",
      "is_touch_device",
      "preferred_languages",
      "page_url",
      "referrer_url",
    ],
  },
  {
    name: "login",
    flow: "session",
    source: "client",
    fields: ["trigger_id", "internet_connection", "device_model", "os_version", "page_url", "referrer_url"],
  },
  { name: "login_fail", flow: "session", source: "client", fields: ["trigger_id", "internet_connection"] },
  { name: "login_open", flow: "session", source: "client", fields: ["trigger_id"] },
  { name: "logout", flow: "session", source: "client", fields: ["page_source"] },
  { name: "logout_open", flow: "session", source: "client", fields: ["page_source"] },
  {
    name: "page_open_success",
    flow: "session",
    source: "client",
    fields: ["page_id", "tab_id", "guest_id", "guest_mode", "page_source"],
    note: "Same fields for page_open_attempt / page_load_success / page_open_error.",
  },
  {
    name: "game_open_success",
    flow: "session",
    source: "client",
    fields: [
      "trigger_id",
      "game_id",
      "game_zone",
      "load_time_ms",
      "unit_name",
      "game_provider_id",
      "game_platform_id",
      "game_studio_id",
    ],
    note: "Same fields for game_open_attempt / game_open_error / game_interact.",
  },
  {
    name: "modal_open_success",
    flow: "session",
    source: "client",
    fields: [
      "modal_id",
      "tab_id",
      "link_id",
      "guest_id",
      "guest_mode",
      "page_source",
      "trigger_id",
      "game_id",
      "load_time_ms",
      "offer_id",
      "button_id",
      "closed",
    ],
    note: "modal_interact carries the same fields; from BE (RelaxGaming) it also adds event_id/provider_id/unit_name/type/details.",
  },
  {
    name: "registration_start",
    flow: "registration",
    source: "client",
    fields: ["guest_id", "guest_mode", "authentication_type", "referrer_url"],
    note: "Same envelope for the registration-flow group: credential_verify_*, ftue_coin_info, ftue_sweep_accept.",
  },
  {
    name: "credential_verify_sent",
    flow: "registration",
    source: "both",
    fields: ["trigger_id", "source", "type", "referrer_url", "authentication_type", "guest_mode"],
  },
  {
    name: "credential_verify_response",
    flow: "registration",
    source: "server",
    fields: ["trigger_id", "source", "type", "status", "authentication_type"],
  },
  {
    name: "kyc_response",
    flow: "registration",
    source: "server",
    fields: [
      "status",
      "details",
      "email_risk",
      "phone_risk",
      "fraud",
      "kycPlus", // mixedCase — kept verbatim
      "addressRisk",
      "alertList",
      "globalWatchlist",
      "digitalIntelligence",
      "nameAddressCorrelation",
      "nameEmailCorrelation",
      "namePhoneCorrelation",
      "socure_transaction_id",
      "platform_advertiser_id",
      "trigger_id",
      "authentication_type",
    ],
    note: "kyc_open / kyc_invalid / kyc_submit / kyc_pass carry only the registration-flow envelope.",
  },
  {
    name: "registration_complete",
    flow: "registration",
    source: "server",
    fields: ["referrer_url", "platform_advertiser_id", "registration_timestamp", "authentication_type", "email", "trigger_id"],
  },
  {
    name: "crosspromo_response",
    flow: "registration",
    source: "server",
    fields: ["status", "details", "platform_advertiser_id"],
  },
  {
    name: "account_verify_response",
    flow: "account",
    source: "server",
    fields: ["type", "status", "email_risk", "phone_risk", "synthetic_risk", "sigma_risk", "alert_risk", "link_id", "trigger_id"],
  },
  { name: "account_verify_sent", flow: "account", source: "server", fields: ["type", "link_id", "trigger_id"] },
  {
    name: "change_password_response",
    flow: "account",
    source: "client",
    fields: ["status"],
    note: "change_password_attempt / account_verify_open / account_verify_attempt share flow=account.",
  },
  {
    name: "client_error",
    flow: "error",
    source: "client",
    fields: ["page_source", "details"],
  },
  {
    name: "server_error",
    flow: "error",
    source: "server",
    fields: ["details", "stack_trace", "page_source", "trigger_id"],
  },
  {
    name: "quest_start",
    flow: "quests",
    source: "server",
    fields: ["quest_id", "type", "index", "value", "prize", "configuration_id", "unit_name", "quest_chain", "game_zone", "game_id", "segment"],
  },
  {
    name: "quest_end",
    flow: "quests",
    source: "server",
    fields: ["quest_id", "type", "value", "prize", "status", "unit_name", "quest_chain", "game_zone", "game_id"],
  },
  {
    name: "inbox_message_receive",
    flow: "inbox",
    source: "server",
    fields: ["source", "type", "message", "message_id"],
  },
  {
    name: "inbox_message_sent",
    flow: "inbox",
    source: "server",
    fields: ["source", "type", "message", "message_id", "bulk_loaded"],
  },
  { name: "inbox_message_open", flow: "inbox", source: "client", fields: [] },
  {
    name: "third_party_load_response",
    flow: "session",
    source: "both",
    fields: ["party_id", "action", "status", "details", "trigger_id", "link_id"],
    note: "third_party_load_attempt shares these fields.",
  },
  { name: "support_ticket_submit", flow: "session", source: "both", fields: [] },
  { name: "spin_win", flow: "spin", source: "server", fields: ["game_id", "unit_name", "amount"], note: "Emitted as action=win/bonus in some balance updates." },
];

// Every event NAME known to be emitted (client BIEventConstants + server action literals). Field shapes
// for names not in BI_EVENTS come purely from the call site; treat them as "envelope + a few extras".
export const BI_ALL_EVENT_NAMES: string[] = [
  // --- client (FE) ---
  "page_open_attempt", "page_load_success", "page_open_success", "page_open_error",
  "game_open_attempt", "game_open_success", "game_open_error", "game_interact",
  "purchase_attempt", "daily_bonus_collect_attempt", "purchase", "first_purchase", "purchase_response",
  "redemption_attempt", "redemption_response", "spin_event",
  "third_party_load_response", "third_party_load_attempt",
  "ava_manifest_load_response", "ava_manifest_load_attempt", "braze_load_attempt", "braze_load_response",
  "modal_open_success", "modal_open_fail", "modal_interact",
  "client_error", "server_error",
  "session_start", "login", "login_open", "login_fail", "logout", "logout_open",
  "registration_start", "credential_verify_open", "credential_start", "credential_verify_verification_open",
  "credential_verify_submit", "credential_verify_phone", "credential_verify_sent", "credential_verify", "phone_verify",
  "kyc_open", "kyc_invalid", "kyc_submit", "kyc_response", "kyc_pass",
  "ftue_coin_info", "ftue_sweep_accept",
  "account_verify_open", "account_verify_attempt", "account_verify_response", "account_verify_sent", "account_verification_complete",
  "change_password_attempt", "change_password_response",
  "reset_password_email_submit", "reset_password_submit", "reset_password_email_sent",
  "support_ticket_submit", "toggle_coin", "game_details", "guest_mode_response", "tutorial_step_complete",
  "myvip_connect_attempt", "myvip_connect_response",
  "geo_modal", "geo_permissions", "pageview", "view_promotions", "inbox_message_open",
  "postLogin_CTA_Facebook_VIP", "postLogin_CTA_Apple_VIP", "postLogin_CTA_Skip_VIP",
  "daily_bonus_collect", "cta_click", "day1_retention", "banner_interact",
  "account_deletion", "returned_event", "menu_interact", "page_interact", "tc_approve",
  "mobile_event", "install", "session_end",
  "phone_exist", "phone_verify_code_invalid", "phone_verify_code_expired", "phone_verify_resend_clicked",
  // --- server (BE) ---
  "credential_verify_response", "registration_complete", "crosspromo_response",
  "myvip_purchase_attempt", "myvip_purchase_response", "update_balance", "loyalty_cap_reached", "bankruptcy",
  "redemption_complete", "inbox_message_receive", "inbox_message_sent",
  "quest_start", "quest_end",
];

export interface BiEventCatalog {
  index: string;
  note: string;
  /** Path prefix every logical field sits under in Splunk (Payload.ClientPayload.). */
  fieldPrefix: string;
  /** A ready-to-adapt SPL query showing the correct nested-field usage. */
  exampleSpl: string;
  commonFields: string[];
  /** Fields that live outside Payload.ClientPayload (env, source, Payload.Partner*). */
  topLevelFields: string[];
  flows: string[];
  events: BiEvent[];
  /** Present only when a filter matched no curated event, to help the agent pick a valid name. */
  allEventNames?: string[];
}

// Build the catalog payload for the describe_bi_events tool. Reads the Splunk index from the environment
// at call time (finally using SPLUNK_DEFAULT_INDEX), so changing .env changes the reported index.
export function formatBiEventCatalog(filter?: string): BiEventCatalog {
  const index = process.env.SPLUNK_DEFAULT_INDEX?.trim() || "sweeps";
  const p = BI_FIELD_PREFIX;
  const exampleSpl =
    `index=${index} "${p}action"="login" "${p}bi_source"="client" ` +
    `| stats count by "${p}country"`;
  const note =
    `Query BI events on index=${index}. IMPORTANT: the fields are NOT top-level — the collector nests ` +
    `every BI field under "${p}" in Splunk, so you MUST use that prefix in SPL (e.g. "${p}action"="login", ` +
    `not action="login"). Quote the dotted field name in search terms and in by/eval clauses. The event ` +
    "name is the `action` field; `flow` groups events; `bi_source` is \"client\" (web/app frontend) or " +
    '"server" (backend). A few fields sit OUTSIDE that object (see topLevelFields): env, source, ' +
    "Payload.PartnerApplicationId, Payload.PartnerPlayerId. Field names are snake_case (a few KYC fields " +
    "are mixedCase, kept verbatim). commonFields/events list the LOGICAL names — prefix them with " +
    `fieldPrefix. If a query returns nothing, verify with \`index=${index} | stats count by "${p}action"\` ` +
    "or `... | fieldsummary` — this catalog is curated and can lag the code.";

  const normalized = filter?.trim().toLowerCase();
  let events = BI_EVENTS;
  const result: BiEventCatalog = {
    index,
    note,
    fieldPrefix: BI_FIELD_PREFIX,
    exampleSpl,
    commonFields: BI_COMMON_FIELDS,
    topLevelFields: BI_TOP_LEVEL_FIELDS,
    flows: BI_FLOWS,
    events,
  };

  if (normalized) {
    events = BI_EVENTS.filter(
      (event) => event.name.toLowerCase().includes(normalized) || event.flow.toLowerCase().includes(normalized),
    );
    result.events = events;
    if (events.length === 0) {
      // No curated match — surface all known names so the agent can re-pick instead of guessing.
      result.allEventNames = BI_ALL_EVENT_NAMES;
    }
  }

  return result;
}
