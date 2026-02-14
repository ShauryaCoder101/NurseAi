const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const GEMINI_API_BASE_URL =
  process.env.GEMINI_API_BASE_URL ||
  'https://generativelanguage.googleapis.com/v1';
const GEMINI_LOG_DIR = path.join(__dirname, '../../logs');
const GEMINI_LOG_FILE = path.join(GEMINI_LOG_DIR, 'gemini.log');
const GEMINI_LOG_ENABLED =
  process.env.GEMINI_LOG_ENABLED === 'true' ||
  process.env.NODE_ENV !== 'production';
const GEMINI_LOG_INCLUDE_RAW = process.env.GEMINI_LOG_INCLUDE_RAW === 'true';
const GEMINI_MIN_INTERVAL_MS = Number(process.env.GEMINI_MIN_INTERVAL_MS || 2000);
const GEMINI_MAX_RETRIES = Number(process.env.GEMINI_MAX_RETRIES || 3);
const GEMINI_BACKOFF_MS = Number(process.env.GEMINI_BACKOFF_MS || 2000);
const GEMINI_MAX_BACKOFF_MS = Number(process.env.GEMINI_MAX_BACKOFF_MS || 15000);

let cachedModelName = null;
let geminiQueue = Promise.resolve();
let lastGeminiRequestAt = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class GeminiRateLimitError extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.name = 'GeminiRateLimitError';
    this.code = 'RATE_LIMIT';
    this.retryAfterMs = retryAfterMs;
  }
}

const parseRetryAfterMs = (response) => {
  const header = response?.headers?.get?.('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
};

const fetchWithRetry = async (endpoint, body) => {
  let attempt = 0;
  while (true) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    });

    if (response.ok) {
      return response;
    }

    const shouldRetry = response.status === 429 || response.status === 503;
    if (!shouldRetry || attempt >= GEMINI_MAX_RETRIES) {
      return response;
    }

    const retryAfterMs = parseRetryAfterMs(response);
    const backoffMs = retryAfterMs ?? Math.min(
      GEMINI_BACKOFF_MS * Math.pow(2, attempt),
      GEMINI_MAX_BACKOFF_MS
    );
    attempt += 1;
    await sleep(backoffMs);
  }
};

const runGeminiThrottled = (task) => {
  const execute = async () => {
    if (Number.isFinite(GEMINI_MIN_INTERVAL_MS) && GEMINI_MIN_INTERVAL_MS > 0) {
      const now = Date.now();
      const wait = Math.max(0, GEMINI_MIN_INTERVAL_MS - (now - lastGeminiRequestAt));
      if (wait > 0) {
        await sleep(wait);
      }
      lastGeminiRequestAt = Date.now();
    }
    return task();
  };

  geminiQueue = geminiQueue.then(execute, execute);
  return geminiQueue;
};

const MODEL_PREFERENCES = ['gemini-2.5-flash-lite'];

const normalizeModelName = (modelName) => {
  if (!modelName) return null;
  return modelName.startsWith('models/') ? modelName : `models/${modelName}`;
};

const pickModelFromList = (models) => {
  if (!Array.isArray(models) || models.length === 0) return null;

  const supportsGenerateContent = (model) =>
    (model.supportedGenerationMethods || model.supportedMethods || []).includes(
      'generateContent'
    );

  const eligible = models.filter((model) => supportsGenerateContent(model));
  if (eligible.length === 0) return null;

  for (const preferred of MODEL_PREFERENCES) {
    const match = eligible.find((model) => model.name?.includes(preferred));
    if (match) return match.name;
  }

  return eligible[0].name;
};

async function listModels() {
  const response = await fetch(
    `${GEMINI_API_BASE_URL}/models?key=${GEMINI_API_KEY}`
  );
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini listModels error: ${errorText}`);
  }
  const data = await response.json();
  return data?.models || [];
}

async function resolveModelName() {
  if (cachedModelName) return cachedModelName;
  if (GEMINI_MODEL) {
    cachedModelName = normalizeModelName(GEMINI_MODEL);
    return cachedModelName;
  }
  const models = await listModels();
  cachedModelName = pickModelFromList(models);
  return cachedModelName;
}

const GEMINI_PROMPT = `Role: Clinical Decision Support Assistant for frontline providers in Birbhum, West Bengal.Context: Resource-constrained setting; high out-of-pocket (OOP) sensitivity.  Core Philosophy: * Occam’s Razor: Prioritize a single unifying diagnosis.

Temporal Alignment: Match differentials to the duration of illness (Acute <14 days vs. Chronic).

Staged-Gate Economy: Only suggest tests that change immediate management. Avoid "screening panels."



Response Structure (Mandatory)


For every patient case, you must provide the response using this exact hierarchy:

1. Case Synthesis (Detailed Extraction)

Patient Demographics: Age, Gender, Occupation (critical for rural exposure).

Clinical Narrative: Precise onset, duration, and progression of symptoms.

Relevant PMH/Family/Social History: Detailed extraction of chronic conditions (HTN, Diabetes), family history of sudden death/cardiac events, and substance use (Tobacco/Alcohol).

Vitals & Anthropometry: BP, HR, RR, SpO2, Weight, Height, and BMI.

Red Flags: Immediate identification of life-threatening signs requiring Swasthya Sathi stabilization.


2. Syndrome-Based Clustering

Organize findings into a primary clinical syndrome to apply Occam's Razor.


3. Prioritized Differential Diagnosis

Ranked by local prevalence in West Bengal.


4. Cost-Effective Diagnostic Strategy

Stage 1: Locally available, high-specificity tests.

Stage 2: Contingent tests (Echo, NAAT) only if Stage 1 is inconclusive.


5. Prescription (Brief & Simple)

CC & Dx: Chief Complaints and Working Diagnosis.

Rx: Generic medications with simple instructions.

Follow-up: Specific timeline (e.g., "Return in 3 days with reports").

SOS Instructions: Clear "return-to-emergency" triggers.

6. Regional Resource Integration

Specific links to Nikshay (TB), Swasthya Sathi (Referrals), Shishu Sathi, Shramshree, Jai Johar, etc.


7. Bengali Patient Guide (বাংলায় নির্দেশিকা)

A 3-point summary emphasizing compliance and the follow-up date.

8. Missing Data

If the patient's data is missing in the case synthesis, make a list of each missing attribute indiviually (eg. each vital(sp02,bp,etc)must be separately listed, like: "SpO2 /n/  BP /n/ HR /n/ RR"). if these fields are all present then skip this section.

NOTE: if the audio doesnt contain anything understandable, then please send the response as 'Please provide a clear patient case description in the audio recording.'

Tone: Concise, professional, and intellectually honest about resource limitations`;

async function generateGeminiSuggestion({audioPath, mimeType, patientId}) {
  return runGeminiThrottled(async () => {
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set');
    }

  const audioBase64 = fs.readFileSync(audioPath, {encoding: 'base64'});
  const promptWithPatient = `${GEMINI_PROMPT}\n\nPatient ID: ${patientId || 'Unknown'}\n`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          {text: promptWithPatient},
          {
            inlineData: {
              mimeType,
              data: audioBase64,
            },
          },
        ],
      },
    ],
  };

  if (typeof fetch !== 'function') {
    throw new Error('Fetch API is not available. Use Node.js 18+.');
  }

  const modelName = await resolveModelName();
  if (!modelName) {
    throw new Error('No compatible Gemini model found for generateContent.');
  }

  const endpoint = `${GEMINI_API_BASE_URL}/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
  let response = await fetchWithRetry(endpoint, body);

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 429) {
      throw new GeminiRateLimitError('Gemini rate limited', parseRetryAfterMs(response));
    }
    if (response.status === 404) {
      // Try to discover an available model and retry once.
      const models = await listModels();
      const fallback = pickModelFromList(models);
      if (fallback && fallback !== modelName) {
        cachedModelName = fallback;
        const retryEndpoint = `${GEMINI_API_BASE_URL}/${fallback}:generateContent?key=${GEMINI_API_KEY}`;
        response = await fetchWithRetry(retryEndpoint, body);
        if (!response.ok) {
          const retryError = await response.text();
          if (response.status === 429) {
            throw new GeminiRateLimitError('Gemini rate limited', parseRetryAfterMs(response));
          }
          throw new Error(`Gemini API error: ${retryError}`);
        }
      } else {
        throw new Error(`Gemini API error: ${errorText}`);
      }
    } else {
      throw new Error(`Gemini API error: ${errorText}`);
    }
  }

  const data = await response.json();
  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text)
      .filter(Boolean)
      .join('\n') || '';

  const transcriptText = text.trim();

  if (GEMINI_LOG_ENABLED) {
    try {
      if (!fs.existsSync(GEMINI_LOG_DIR)) {
        fs.mkdirSync(GEMINI_LOG_DIR, {recursive: true});
      }
      const logEntry = {
        timestamp: new Date().toISOString(),
        patientId: patientId || null,
        audioPath,
        model: GEMINI_MODEL,
        transcript: transcriptText,
        rawResponse: GEMINI_LOG_INCLUDE_RAW ? data : undefined,
      };
      fs.appendFileSync(GEMINI_LOG_FILE, `${JSON.stringify(logEntry)}\n`, 'utf8');
    } catch (logError) {
      console.error('Failed to write Gemini log:', logError);
    }
  }

    return transcriptText;
  });
}

async function generateGeminiFollowup({previousResponse, followupText, patientId}) {
  return runGeminiThrottled(async () => {
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set');
    }

  const promptWithPatient = `${GEMINI_PROMPT}\n\nPatient ID: ${patientId || 'Unknown'}\n`;

  const contents = [
    {
      role: 'user',
      parts: [{text: promptWithPatient}],
    },
    {
      role: 'model',
      parts: [{text: previousResponse || ''}],
    },
    {
      role: 'user',
      parts: [
        {
          text:
            `${followupText}\n\n` +
            'Please update the response using the same structure. ' +
            'If missing data is now provided, update section 8 accordingly.',
        },
      ],
    },
  ];

  const body = {contents};

  if (typeof fetch !== 'function') {
    throw new Error('Fetch API is not available. Use Node.js 18+.');
  }

  const modelName = await resolveModelName();
  if (!modelName) {
    throw new Error('No compatible Gemini model found for generateContent.');
  }

  const endpoint = `${GEMINI_API_BASE_URL}/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
  let response = await fetchWithRetry(endpoint, body);

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 429) {
      throw new GeminiRateLimitError('Gemini rate limited', parseRetryAfterMs(response));
    }
    if (response.status === 404) {
      const models = await listModels();
      const fallback = pickModelFromList(models);
      if (fallback && fallback !== modelName) {
        cachedModelName = fallback;
        const retryEndpoint = `${GEMINI_API_BASE_URL}/${fallback}:generateContent?key=${GEMINI_API_KEY}`;
        response = await fetchWithRetry(retryEndpoint, body);
        if (!response.ok) {
          const retryError = await response.text();
          if (response.status === 429) {
            throw new GeminiRateLimitError('Gemini rate limited', parseRetryAfterMs(response));
          }
          throw new Error(`Gemini API error: ${retryError}`);
        }
      } else {
        throw new Error(`Gemini API error: ${errorText}`);
      }
    } else {
      throw new Error(`Gemini API error: ${errorText}`);
    }
  }

  const data = await response.json();
  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text)
      .filter(Boolean)
      .join('\n') || '';

  const transcriptText = text.trim();

  if (GEMINI_LOG_ENABLED) {
    try {
      if (!fs.existsSync(GEMINI_LOG_DIR)) {
        fs.mkdirSync(GEMINI_LOG_DIR, {recursive: true});
      }
      const logEntry = {
        timestamp: new Date().toISOString(),
        patientId: patientId || null,
        model: GEMINI_MODEL,
        transcript: transcriptText,
        rawResponse: GEMINI_LOG_INCLUDE_RAW ? data : undefined,
        type: 'followup',
      };
      fs.appendFileSync(GEMINI_LOG_FILE, `${JSON.stringify(logEntry)}\n`, 'utf8');
    } catch (logError) {
      console.error('Failed to write Gemini log:', logError);
    }
  }

    return transcriptText;
  });
}

module.exports = {generateGeminiSuggestion, generateGeminiFollowup};
