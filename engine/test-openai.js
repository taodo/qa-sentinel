const path = require('path');

require('dotenv').config({
  path: path.join(
    __dirname,
    '..',
    '.env'
  )
});

async function main() {
  console.log(
    '\n🤖 Testing OpenAI connection...'
  );

  const apiKey =
    process.env.OPENAI_API_KEY;

  const model =
    process.env.OPENAI_MODEL ||
    'gpt-5.6';

  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is missing from .env'
    );
  }

  /*
   * Dynamic import keeps this file compatible
   * with the current CommonJS project.
   */
  const {
    default: OpenAI
  } = await import('openai');

  const client = new OpenAI({
    apiKey,
    timeout: 60_000,
    maxRetries: 1
  });

  console.log(
    '✅ OPENAI_API_KEY loaded'
  );

  console.log(
    `🧠 Model: ${model}`
  );

  console.log(
    '📡 Sending test request...'
  );

  const startedAt =
    Date.now();

  const response =
    await client.responses.create({
      model,

      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                'Reply with exactly this text: ' +
                'QA Sentinel OpenAI connection successful.'
            }
          ]
        }
      ],

      max_output_tokens: 50
    });

  const durationMs =
    Date.now() - startedAt;

  const outputText =
    response.output_text?.trim();

  if (!outputText) {
    throw new Error(
      'OpenAI returned no output text.'
    );
  }

  console.log('\n✅ OpenAI response received');
  console.log(
    `⏱ Duration: ${durationMs} ms`
  );

  console.log(
    `🆔 Response ID: ${response.id}`
  );

  console.log(
    `📊 Status: ${response.status}`
  );

  console.log('\nResponse:');
  console.log(outputText);

  if (response.usage) {
    console.log('\nToken usage:');

    console.log(
      `- Input: ` +
      `${response.usage.input_tokens ?? 0}`
    );

    console.log(
      `- Output: ` +
      `${response.usage.output_tokens ?? 0}`
    );

    console.log(
      `- Total: ` +
      `${response.usage.total_tokens ?? 0}`
    );
  }

  console.log(
    '\n🎉 OpenAI connection test passed.'
  );
}

main().catch(error => {
  console.error(
    '\n❌ OpenAI connection test failed.'
  );

  if (error.status) {
    console.error(
      `HTTP status: ${error.status}`
    );
  }

  if (error.code) {
    console.error(
      `Error code: ${error.code}`
    );
  }

  if (error.request_id) {
    console.error(
      `Request ID: ${error.request_id}`
    );
  }

  console.error(
    `Message: ${error.message}`
  );

  process.exit(1);
});