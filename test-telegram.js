const {
  sendSpinAlert,
} = require("./engine/telegram-notifier");

async function main() {
  const testAlert = {
    severity: "CRITICAL",
    provider: "Relax Gaming",
    client_type: "Web",
    spin_type: "regular",
    unit_name: "SC",
    current_spins: 238,
    previous_spins: 980,
    yesterday_spins: 1024,
    drop_percentage: 76.8,
  };

  try {
    await sendSpinAlert(testAlert);
  } catch (error) {
    console.error("❌ Telegram test failed");
    console.error(error.message);
    process.exitCode = 1;
  }
}

main();