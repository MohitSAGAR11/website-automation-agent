const axios = require("axios");
const logger = require("../utils/logger");
require("dotenv").config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

const GROQ_MODEL_EXPORT = GROQ_MODEL;

if (!GROQ_API_KEY || GROQ_API_KEY === "your_groq_api_key_here") {
  logger.warn(
    "GROQ_API_KEY is not set! The agent will not be able to make AI calls.\n" +
      "  Get a free key at https://console.groq.com and set it in .env",
  );
}

const RETRY_DELAYS_MS = [2000, 5000, 10000]; // backoff for 429s

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function chat(messages, systemPrompt = "") {
  if (!GROQ_API_KEY || GROQ_API_KEY === "your_groq_api_key_here") {
    throw new Error("GROQ_API_KEY not configured");
  }

  const payload = {
    model: GROQ_MODEL,
    messages: [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...messages,
    ],
    temperature: 0.1,
    max_tokens: 1024,
  };

  logger.debug("Sending request to Groq", {
    model: GROQ_MODEL,
    msgCount: messages.length,
  });

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const response = await axios.post(
        `${GROQ_BASE_URL}/chat/completions`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${GROQ_API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 30000,
        },
      );

      const content = response.data?.choices?.[0]?.message?.content;
      if (!content) throw new Error("Empty response from Groq");

      logger.debug("Groq response received", { length: content.length });
      return content;
    } catch (err) {
      const status = err.response?.status;
      const errMsg =
        err.response?.data?.error?.message || err.message || String(err);

      if (status === 429 && attempt < RETRY_DELAYS_MS.length) {
        const waitMs = RETRY_DELAYS_MS[attempt];
        logger.warn(
          `Groq rate-limited (429). Waiting ${waitMs / 1000}s before retry ${attempt + 1}/${RETRY_DELAYS_MS.length}...`,
        );
        await sleep(waitMs);
        continue;
      }

      if (err.response) {
        logger.agentError(`Groq API error: ${status}: ${errMsg}`);
      } else {
        logger.agentError(`Groq request failed: ${errMsg}`);
      }
      throw new Error(errMsg);
    }
  }
}

function parseActionFromResponse(text) {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch (_) {}
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

module.exports = { chat, parseActionFromResponse, GROQ_MODEL: GROQ_MODEL_EXPORT };
