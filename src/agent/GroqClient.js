const axios = require("axios");
const logger = require("../utils/logger");
require("dotenv").config();

const API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL =
  process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free";
const BASE_URL = "https://openrouter.ai/api/v1";

// Exported as GROQ_MODEL so agent.js doesn't need changes
const GROQ_MODEL = MODEL;

if (!API_KEY || API_KEY === "your_openrouter_api_key_here") {
  logger.warn(
    "OPENROUTER_API_KEY is not set! Set it in .env to enable AI-driven automation.\n" +
      "  Get a free key at https://openrouter.ai",
  );
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function chat(messages, systemPrompt = "") {
  if (!API_KEY || API_KEY === "your_openrouter_api_key_here") {
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  const payload = {
    model: MODEL,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...messages,
    ],
    temperature: 0,      // deterministic — faster token generation
    max_tokens: 200,     // JSON action fits in <100 tokens; 200 is generous
  };

  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await axios.post(
        `${BASE_URL}/chat/completions`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/automation-agent",
            "X-Title": "Website Automation Agent",
          },
          timeout: 60000,
        },
      );

      const content = response.data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty response from API');

      logger.debug('API response received', { length: content.length });
      return content;
    } catch (err) {
      const status = err.response?.status;
      const errMsg =
        err.response?.data?.error?.message || err.message || String(err);

      if (status === 429 && attempt < MAX_RETRIES - 1) {
        // Parse suggested wait from Retry-After header or error message
        const retryAfterHeader = err.response?.headers?.['retry-after'];
        const retryMatch = errMsg.match(/try again in (\d+\.?\d*)s/i);
        const suggestedWait =
          retryAfterHeader
            ? parseInt(retryAfterHeader, 10) * 1000 + 500
            : retryMatch
            ? Math.ceil(parseFloat(retryMatch[1]) * 1000) + 500
            : null;
        const backoffWait = [5000, 15000][attempt] || 15000;
        const waitMs = suggestedWait || backoffWait;

        logger.warn(
          `Rate-limited (429). Waiting ${(waitMs / 1000).toFixed(1)}s before retry ${attempt + 1}/${MAX_RETRIES - 1}...`,
        );
        await sleep(waitMs);
        continue;
      }

      // Non-429 errors: log and throw immediately (no point retrying)
      if (err.response) {
        logger.agentError(`API error ${status}: ${errMsg}`);
      } else {
        logger.agentError(`Request failed: ${errMsg}`);
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
    } catch (_) {}
  }

  return null;
}

module.exports = { chat, parseActionFromResponse, GROQ_MODEL };
