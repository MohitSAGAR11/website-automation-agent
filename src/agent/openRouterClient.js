const axios = require("axios");
const logger = require("../utils/logger");
require("dotenv").config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL;
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

if (
  !OPENROUTER_API_KEY ||
  OPENROUTER_API_KEY === "your_openrouter_api_key_here"
) {
  logger.warn(
    "OPENROUTER_API_KEY is not set! The agent will use heuristic mode (no AI).\n" +
      "  Set it in .env to enable AI-driven decision making.",
  );
}

async function chat(messages, systemPrompt = "") {
  if (
    !OPENROUTER_API_KEY ||
    OPENROUTER_API_KEY === "your_openrouter_api_key_here"
  ) {
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  const payload = {
    model: OPENROUTER_MODEL,
    messages: [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...messages,
    ],
    temperature: 0.1,
    max_tokens: 1024,
  };

  logger.debug("Sending request to OpenRouter", {
    model: OPENROUTER_MODEL,
    msgCount: messages.length,
  });

  try {
    const response = await axios.post(
      `${OPENROUTER_BASE_URL}/chat/completions`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/automation-agent",
          "X-Title": "Website Automation Agent",
        },
        timeout: 60000,
      },
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty response from OpenRouter");

    logger.debug("OpenRouter response received", { length: content.length });
    return content;
  } catch (err) {
    if (err.response) {
      logger.agentError(`OpenRouter API error: ${err.response.status}`, {
        message: err.response.data?.error?.message,
      });
    } else {
      logger.agentError("OpenRouter request failed", err);
    }
    throw err;
  }
}
function parseActionFromResponse(text) {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch (_) {
      
    }
  }

  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch (_) {
      /* fall through */
    }
  }

  return null;
}

module.exports = { chat, parseActionFromResponse, OPENROUTER_MODEL };
