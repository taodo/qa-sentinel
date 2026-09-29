require('dotenv').config();

const { App } = require('@slack/bolt');

const {
  handleCommand
} = require('./engine/command-router');

const app = new App({
  token:
    process.env.SLACK_BOT_TOKEN,

  socketMode:
    true,

  appToken:
    process.env.SLACK_APP_TOKEN
});

app.event(
  'app_mention',
  async ({
    event,
    say,
    logger
  }) => {

    const channelId =
      event.channel;

    const threadTs =
      event.thread_ts ||
      event.ts;

    /*
     * Remove the bot mention from
     * the original Slack message.
     */
    const command =
      (event.text || '')
        .replace(
          /<@[A-Z0-9]+>/g,
          ''
        )
        .trim();

    let thinkingTs =
      null;

    try {

      /*
       * Send temporary Thinking message.
       */
      const thinkingMessage =
        await say({
          text:
            '💭 *Thinking...* 🔎 I’m checking that for you.',

          thread_ts:
            threadTs
        });

      thinkingTs =
        thinkingMessage.ts;

      /*
       * Execute the actual command.
       */
      const result =
        await handleCommand({
          command,
          channelId,
          threadTs
        });

      /*
       * Remove Thinking message
       * before posting the final result.
       */
      if (thinkingTs) {

        await app.client.chat.delete({
          channel:
            channelId,

          ts:
            thinkingTs
        });

        thinkingTs =
          null;
      }

      /*
       * Post final result into the thread.
       */
      await say({
        text:
          result.text,

        thread_ts:
          threadTs,

        ...(result.blocks
          ? {
              blocks:
                result.blocks
            }
          : {})
      });

    } catch (error) {

      logger.error(
        `QA Sentinel Bot error: ${error.message}`
      );

      /*
       * Remove Thinking message
       * if it still exists.
       */
      if (thinkingTs) {

        try {

          await app.client.chat.delete({
            channel:
              channelId,

            ts:
              thinkingTs
          });

        } catch (deleteError) {

          logger.warn(
            `Could not remove Thinking message: ${deleteError.message}`
          );

        }

      }

      /*
       * Send error message.
       */
      await say({
        text:
          '❌ I could not complete this request because the query failed. Please try again later.',

        thread_ts:
          threadTs
      });

    }
  }
);

(async () => {

  try {

    await app.start();

    console.log('');

    console.log(
      '=================================================='
    );

    console.log(
      '🤖 QA Sentinel Slack Bot'
    );

    console.log(
      '⚡ Socket Mode connected'
    );

    console.log(
      '=================================================='
    );

  } catch (error) {

    console.error(
      `❌ Failed to start QA Sentinel Bot: ${error.message}`
    );

    process.exit(1);

  }

})();