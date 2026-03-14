const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview';
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-pro';
const GEMINI_API_BASE_URL =
  process.env.GEMINI_API_BASE_URL ||
  'https://generativelanguage.googleapis.com/v1beta';
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

const MODEL_PREFERENCES = ['gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'];

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

function getFallbackModelName() {
  return normalizeModelName(GEMINI_FALLBACK_MODEL);
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
      const fallback = getFallbackModelName();
      if (fallback && fallback !== modelName) {
        console.log(`Primary model ${modelName} not found, trying fallback ${fallback}`);
        cachedModelName = fallback;
        response = await fetchWithRetry(
          `${GEMINI_API_BASE_URL}/${fallback}:generateContent?key=${GEMINI_API_KEY}`,
          body
        );
        if (!response.ok) {
          const retryError = await response.text();
          if (response.status === 429) {
            throw new GeminiRateLimitError('Gemini rate limited', parseRetryAfterMs(response));
          }
          throw new Error(`Gemini API error (fallback): ${retryError}`);
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
      const fallback = getFallbackModelName();
      if (fallback && fallback !== modelName) {
        console.log(`Primary model ${modelName} not found, trying fallback ${fallback}`);
        cachedModelName = fallback;
        response = await fetchWithRetry(
          `${GEMINI_API_BASE_URL}/${fallback}:generateContent?key=${GEMINI_API_KEY}`,
          body
        );
        if (!response.ok) {
          const retryError = await response.text();
          if (response.status === 429) {
            throw new GeminiRateLimitError('Gemini rate limited', parseRetryAfterMs(response));
          }
          throw new Error(`Gemini API error (fallback): ${retryError}`);
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

const generateBenchmarkResponse = async ({modelName, promptText}) => {
  return runGeminiThrottled(async () => {
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set');
    }
    const resolvedModel = normalizeModelName(modelName) || (await resolveModelName());
    if (!resolvedModel) {
      throw new Error('No compatible Gemini model found for generateContent.');
    }

    const endpoint = `${GEMINI_API_BASE_URL}/${resolvedModel}:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
      contents: [
        {
          role: 'user',
          parts: [{text: promptText}],
        },
      ],
    };

    let response = await fetchWithRetry(endpoint, body);
    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 404) {
        const models = await listModels();
        const fallback = pickModelFromList(models);
        if (fallback && fallback !== resolvedModel) {
          const retryEndpoint = `${GEMINI_API_BASE_URL}/${fallback}:generateContent?key=${GEMINI_API_KEY}`;
          response = await fetchWithRetry(retryEndpoint, body);
          if (!response.ok) {
            const retryError = await response.text();
            if (response.status === 429) {
              throw new GeminiRateLimitError(
                'Gemini rate limited',
                parseRetryAfterMs(response)
              );
            }
            throw new Error(`Gemini API error: ${retryError}`);
          }
        } else {
          throw new Error(`Gemini API error: ${errorText}`);
        }
      } else if (response.status === 429) {
        throw new GeminiRateLimitError('Gemini rate limited', parseRetryAfterMs(response));
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
    return text.trim();
  });
};

const DIAGNOSIS_PROMPT = `Role: You are "2Diagnosis," a high-efficiency diagnostic assistant positioned between the initial clinician interview and the final management plan.

Objective: Review clinical transcripts to identify the most likely "bucket" (differential), screen for red flags, and provide high-yield follow-up steps.

Response Structure:
Clinical Rationale: A 2–3 sentence summary of the case, highlighting the most likely differential and any immediate "red flag" concerns (e.g., CHF, DVT, Sepsis).
Clarifying Questions: 3–4 high-discriminating questions. Always include the local language translation (e.g., Bengali for rural WB contexts) in parentheses. Focus on "Bucket" differentiation (e.g., Cardiac vs. Renal vs. Anemia).
Physical Exam & Point-of-Care (POC): Recommend 3–5 specific maneuvers or bedside tests (e.g., JVP, Pitting, Auscultation, Urine Dipstick). Briefly state why each is being requested.

Tone & Style:
Concise & Scannable: Use bullet points and numbered lists for clarity.
Action-Oriented: Focus on what the clinician needs to do now to reach a diagnosis.
Peer-to-Peer: Speak as a supportive, expert colleague, not a textbook.

Formatting: Do NOT use any markdown formatting. No asterisks, no bold (**), no headers (#), no underscores for emphasis. Output clean, readable plain text only. Use dashes (-) for bullet points and line breaks for separation.

Constraint: Do not recommend a full management/treatment plan. Your role ends at the diagnostic and investigative recommendations.`;

const PRESCRIPTION_PROMPT = `Role & Context
You are "3Prescription," the final stage of a clinical decision-support workflow designed for Nurse Practitioners and medical students in rural West Bengal. Your objective is to synthesize the initial screening (from 1Proforma) and the diagnostic clarifications (from 2Diagnosis) into a pragmatic, tiered management plan. You prioritize patient safety and resource stewardship over exhaustive diagnostic certainty.

Core Management Priorities
When formulating your plan, you must adhere to these priorities in order:
Triage & Escalation: Immediately identify if there is a high probability of a high-risk clinical event. If so, adopt a "Stabilize and Transfer" approach.
Clinical Supervision: Explicitly flag the need for a supervising doctor if advanced/costly tests or potentially toxic treatments (e.g., specific antibiotics, high-risk cardiac meds) are indicated.
Symptom Relief: Prioritize the patient's immediate comfort and functional status.
Pragmatic Diagnostics: Suggest tests only if they inform feasible treatment. It is not essential to reach a final diagnosis if the process is too costly, complicated, or risky for the patient.
Tiered Investigations: * Tier 1: Easy, cheap, reliable tests to rule in common local diagnoses (e.g., Anemia, GERD, Dehydration) or rule out "do-not-miss" conditions.
Tier 2: Expensive or specialized tests recommended only if Tier 1 is negative and the patient is referred to a supervising doctor.
Safety Netting: Clearly define the follow-up timeline and "Return Precautions" using local terminology.

Operational Guidelines & Tool Call Protocol
1. Guideline & Evidence Validation
Before finalizing the management plan, you must use the search tool to verify that recommendations align with the following hierarchy of authority:
Local/State: West Bengal Health & Family Welfare Department (WBHFW) protocols (especially for endemic diseases like Malaria, Dengue, or Japanese Encephalitis).
National: Government of India (GoI) Ministry of Health (MoHFW) or ICMR (Indian Council of Medical Research) guidelines.
Global (Backup): WHO or UpToDate guidelines if local/national ones are unavailable.
Specific Search Triggers:
Red Flags: If a "Do-Not-Miss" diagnosis is suspected (e.g., Scrub Typhus), search for: "ICMR treatment guidelines for [Condition] 2024-2026 India."
Public Health: If suggesting a public health notification disease, search for: "West Bengal health department reporting protocol for [Condition]."
Referrals: If suggesting a referral, search for: "Referral criteria for [Condition] West Bengal government hospitals."
2. Step-by-Step Tool Verification Protocol
To prevent hallucination, follow these internal steps before finalizing any recommendation:
Search & Extract: When you perform a tool call, explicitly identify the source (e.g., "According to the ICMR 2024 PDF snippet...").
Cross-Check: Compare tool results against internal knowledge. If there is a conflict (e.g., training data suggests one dose, but the 2026 search result suggests another), default to the 2026 search result but note the change.
The "Zero-Tolerance" Rule: If a search result is vague or doesn't specify a dosage, DO NOT GUESS. Instead, state: "Current localized dosage guidelines were not found; consult a supervising doctor before prescribing [Medication]."
Prohibit "Ghost Citations": Never mention a guideline (e.g., "Per WBHFW guidelines...") unless you have successfully retrieved it via the search tool in the current session.
3. Context & Language
Temporality: Always consider the current date (it is 2026) and seasonal peaks (e.g., monsoon-related illnesses like Malaria or Scrub Typhus).
Bilingual Bridge: Maintain a dual-language approach. Use English for clinical sections and simple English with Bengali vernacular for patient education.
Tone: Authentic, supportive, and peer-to-peer.

Formatting: Do NOT use any markdown formatting. No asterisks, no bold (**), no headers (#), no underscores for emphasis. Output clean, readable plain text only. Use dashes (-) for bullet points and line breaks for separation.

Output Format
1) Prescription
Disposition: State clearly if this is "Local Management" or "Stabilize and Transfer."
Diagnostic Tests: List as Tier 1 (Immediate/Low Cost) and Tier 2 (Referral/Advanced).
Medications: List name, dosage, frequency, and duration.
Advice: Specific instructions on Diet and Activity relevant to the local context (e.g., field work, local water sources).
Follow-up: Provide a specific date or timeframe for the next check-in.
Return Precautions (Red Flags): List critical symptoms requiring immediate return, using Bengali descriptors (e.g., Buk-e-bhaar for chest heaviness).
2) Patient Education (in Bengali)
Language: This section must be written in Bengali (the local vernacular) using simple, high-yield terms.
Content:
Most Likely Diagnosis: Use broad, understandable categories.
The Plan: What the treatment is and what the patient needs to do.
Prognosis: What to expect in the coming days.
When to Worry: Simplified return precautions using local descriptors.

Verification Output Requirement
At the very end of your response, include this "Source Validation" footer:
Source Validation:
Guideline used: [Name of guideline retrieved via tool]
Last Verified: [Date/Year from the search result]
Confidence Level: [High/Medium/Low based on search match]`;

async function generateDiagnosisFromAudio({audioPath, mimeType, patientId}) {
  return runGeminiThrottled(async () => {
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set');
    }

    const audioBase64 = fs.readFileSync(audioPath, {encoding: 'base64'});
    const prompt = `${DIAGNOSIS_PROMPT}\n\nPatient ID: ${patientId || 'Unknown'}\n`;

    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            {text: prompt},
            {inlineData: {mimeType, data: audioBase64}},
          ],
        },
      ],
    };

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
        const fallback = getFallbackModelName();
        if (fallback && fallback !== modelName) {
          console.log(`Primary model ${modelName} not found, trying fallback ${fallback}`);
          cachedModelName = fallback;
          response = await fetchWithRetry(
            `${GEMINI_API_BASE_URL}/${fallback}:generateContent?key=${GEMINI_API_KEY}`,
            body
          );
          if (!response.ok) {
            const retryError = await response.text();
            if (response.status === 429) {
              throw new GeminiRateLimitError('Gemini rate limited', parseRetryAfterMs(response));
            }
            throw new Error(`Gemini API error (fallback): ${retryError}`);
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

    return text.trim();
  });
}

async function generatePrescription({diagnosisText, answerAudioPath, answerMimeType, patientId}) {
  return runGeminiThrottled(async () => {
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set');
    }
    const resolvedModel = await resolveModelName();
    if (!resolvedModel) {
      throw new Error('No compatible Gemini model found for generateContent.');
    }

    const combinedPrompt = `${PRESCRIPTION_PROMPT}

--- Context from 2Diagnosis ---
${diagnosisText}

Patient ID: ${patientId || 'Unknown'}

The attached audio contains the nurse's verbal answers to the clarifying questions from the 2Diagnosis stage. Based on the diagnosis assessment and the nurse's audio answers, provide the final management plan.`;

    const answerBase64 = fs.readFileSync(answerAudioPath, {encoding: 'base64'});

    const endpoint = `${GEMINI_API_BASE_URL}/${resolvedModel}:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            {text: combinedPrompt},
            {inlineData: {mimeType: answerMimeType || 'audio/mp4', data: answerBase64}},
          ],
        },
      ],
    };

    let response = await fetchWithRetry(endpoint, body);
    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 429) {
        throw new GeminiRateLimitError('Gemini rate limited', parseRetryAfterMs(response));
      }
      if (response.status === 404) {
        const fallback = getFallbackModelName();
        if (fallback && fallback !== resolvedModel) {
          console.log(`Primary model ${resolvedModel} not found, trying fallback ${fallback}`);
          cachedModelName = fallback;
          response = await fetchWithRetry(
            `${GEMINI_API_BASE_URL}/${fallback}:generateContent?key=${GEMINI_API_KEY}`,
            body
          );
          if (!response.ok) {
            const retryError = await response.text();
            if (response.status === 429) {
              throw new GeminiRateLimitError('Gemini rate limited', parseRetryAfterMs(response));
            }
            throw new Error(`Gemini API error (fallback): ${retryError}`);
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
    return text.trim();
  });
}

async function generateProformaResponse({promptText}) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set');
  }
  const resolvedModel = await resolveModelName();
  if (!resolvedModel) {
    throw new Error('No compatible Gemini model found for generateContent.');
  }

  const endpoint = `${GEMINI_API_BASE_URL}/${resolvedModel}:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [{role: 'user', parts: [{text: promptText}]}],
  };

  let response = await fetchWithRetry(endpoint, body);
  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 429) {
      throw new GeminiRateLimitError('Gemini rate limited', parseRetryAfterMs(response));
    }
    if (response.status === 404) {
      const fallback = getFallbackModelName();
      if (fallback && fallback !== resolvedModel) {
        console.log(`Primary model ${resolvedModel} not found, trying fallback ${fallback}`);
        cachedModelName = fallback;
        response = await fetchWithRetry(
          `${GEMINI_API_BASE_URL}/${fallback}:generateContent?key=${GEMINI_API_KEY}`,
          body
        );
        if (!response.ok) {
          const retryError = await response.text();
          if (response.status === 429) {
            throw new GeminiRateLimitError('Gemini rate limited', parseRetryAfterMs(response));
          }
          throw new Error(`Gemini API error (fallback): ${retryError}`);
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
  return text.trim();
}

module.exports = {
  generateGeminiSuggestion,
  generateGeminiFollowup,
  generateBenchmarkResponse,
  generateProformaResponse,
  generateDiagnosisFromAudio,
  generatePrescription,
  getBenchmarkPrompt: () => GEMINI_PROMPT,
  generateBenchmarkAudio: async ({audioPath, audioUrl, mimeType, patientId, modelName, promptText}) => {
    return runGeminiThrottled(async () => {
      if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is not set');
      }
      const resolvedModel = normalizeModelName(modelName) || (await resolveModelName());
      if (!resolvedModel) {
        throw new Error('No compatible Gemini model found for generateContent.');
      }

      let audioBase64 = null;
      if (audioPath) {
        audioBase64 = fs.readFileSync(audioPath, {encoding: 'base64'});
      } else if (audioUrl) {
        const response = await fetch(audioUrl);
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to fetch audio: ${errorText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        audioBase64 = Buffer.from(arrayBuffer).toString('base64');
      } else {
        throw new Error('No audio source provided for benchmark.');
      }
      const basePrompt = promptText && String(promptText).trim()
        ? String(promptText).trim()
        : GEMINI_PROMPT;
      const promptWithPatient = `${basePrompt}\n\nPatient ID: ${patientId || 'Unknown'}\n`;
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

      let response = await fetchWithRetry(
        `${GEMINI_API_BASE_URL}/${resolvedModel}:generateContent?key=${GEMINI_API_KEY}`,
        body
      );
      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 404) {
          const fallback = getFallbackModelName();
          if (fallback && fallback !== resolvedModel) {
            console.log(`Primary model ${resolvedModel} not found, trying fallback ${fallback}`);
            cachedModelName = fallback;
            response = await fetchWithRetry(
              `${GEMINI_API_BASE_URL}/${fallback}:generateContent?key=${GEMINI_API_KEY}`,
              body
            );
            if (!response.ok) {
              const retryError = await response.text();
              if (response.status === 429) {
                throw new GeminiRateLimitError(
                  'Gemini rate limited',
                  parseRetryAfterMs(response)
                );
              }
              throw new Error(`Gemini API error (fallback): ${retryError}`);
            }
          } else {
            throw new Error(`Gemini API error: ${errorText}`);
          }
        } else if (response.status === 429) {
          throw new GeminiRateLimitError('Gemini rate limited', parseRetryAfterMs(response));
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
      return text.trim();
    });
  },
};
