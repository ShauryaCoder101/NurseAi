/**
 * External LLM Service — unified interface for ChatGPT, Grok, DeepSeek, and Claude.
 * All calls use raw fetch (Node 18+).
 * Each function returns { text, model } so the caller knows which model was used.
 */

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Model Defaults (best available flagship models) ───────────────────────────
const MODELS = {
  CHATGPT:       'gpt-4o',                   // OpenAI flagship multimodal
  CHATGPT_AUDIO: 'gpt-4o-audio-preview',     // OpenAI audio-capable
  GROK:          'grok-3-latest',             // xAI flagship
  DEEPSEEK:      'deepseek-chat',             // DeepSeek V3
  CLAUDE:        'claude-sonnet-4-20250514',  // Anthropic Sonnet 4
};

// ── ChatGPT (OpenAI) — supports audio via input_audio ─────────────────────────
async function callChatGPT({ prompt, model, audioBase64, mimeType }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const useModel = audioBase64
    ? (model || MODELS.CHATGPT_AUDIO)
    : (model || MODELS.CHATGPT);

  let content;
  if (audioBase64) {
    content = [
      { type: 'text', text: prompt },
      { type: 'input_audio', input_audio: { data: audioBase64, format: mimeType?.includes('wav') ? 'wav' : 'mp3' } },
    ];
  } else {
    content = prompt;
  }

  console.log(`🟠 ChatGPT → model: ${useModel}`);

  const body = {
    model: useModel,
    messages: [{ role: 'user', content }],
    temperature: 0.3,
    max_tokens: 16384,
  };

  const response = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ChatGPT API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || '';
  const actualModel = data?.model || useModel;
  console.log(`🟠 ChatGPT ✓ model: ${actualModel} | ${text.length} chars`);
  return text;
}

// Store last used models for reporting
callChatGPT.modelName = () => MODELS.CHATGPT;

// ── Grok (xAI) — uses OpenAI-compatible format ───────────────────────────────
async function callGrok({ prompt, model, audioBase64, mimeType }) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('XAI_API_KEY is not set');

  const useModel = model || MODELS.GROK;

  let content;
  if (audioBase64) {
    content = [
      { type: 'text', text: prompt },
      { type: 'audio_url', audio_url: { url: `data:${mimeType || 'audio/mp3'};base64,${audioBase64}` } },
    ];
  } else {
    content = prompt;
  }

  console.log(`🔵 Grok → model: ${useModel}`);

  const body = {
    model: useModel,
    messages: [{ role: 'user', content }],
    temperature: 0.3,
    max_tokens: 16384,
  };

  const response = await fetchWithRetry('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Grok API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || '';
  const actualModel = data?.model || useModel;
  console.log(`🔵 Grok ✓ model: ${actualModel} | ${text.length} chars`);
  return text;
}

callGrok.modelName = () => MODELS.GROK;

// ── DeepSeek — does NOT support audio; transcript in prompt text ──────────────
async function callDeepSeek({ prompt, model }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not set');

  const useModel = model || MODELS.DEEPSEEK;
  console.log(`🟣 DeepSeek → model: ${useModel}`);

  const body = {
    model: useModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 8192,
  };

  const response = await fetchWithRetry('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`DeepSeek API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || '';
  const actualModel = data?.model || useModel;
  console.log(`🟣 DeepSeek ✓ model: ${actualModel} | ${text.length} chars`);
  return text;
}

callDeepSeek.modelName = () => MODELS.DEEPSEEK;

// ── Claude (Anthropic) — text only (does NOT support audio) ───────────────────
async function callClaude({ prompt, model }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

  const useModel = model || MODELS.CLAUDE;
  console.log(`🟤 Claude → model: ${useModel}`);

  const content = [{ type: 'text', text: prompt }];

  const body = {
    model: useModel,
    max_tokens: 16384,
    messages: [{ role: 'user', content }],
  };

  const response = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data?.content
    ?.filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim() || '';
  const actualModel = data?.model || useModel;
  console.log(`🟤 Claude ✓ model: ${actualModel} | ${text.length} chars`);
  return text;
}

callClaude.modelName = () => MODELS.CLAUDE;

// ── Retry helper ──────────────────────────────────────────────────────────────
async function fetchWithRetry(url, options) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(120_000),
      });
      if (res.ok || (res.status !== 429 && res.status !== 503 && res.status !== 502)) {
        return res;
      }
      const retryAfter = res.headers.get('retry-after');
      if (retryAfter && attempt < MAX_RETRIES) {
        const waitSec = parseInt(retryAfter, 10);
        if (!isNaN(waitSec) && waitSec > 0) {
          console.log(`⏳ Rate limited. Waiting ${waitSec + 2}s (Retry-After header)...`);
          await sleep((waitSec + 2) * 1000);
          continue;
        }
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < MAX_RETRIES) {
      const jitter = 1000 + Math.random() * 2000;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt) + jitter;
      console.log(`⏳ LLM retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(delay / 1000)}s...`);
      await sleep(delay);
    }
  }
  throw lastError;
}

module.exports = {
  callChatGPT,
  callGrok,
  callDeepSeek,
  callClaude,
  MODELS,
};
