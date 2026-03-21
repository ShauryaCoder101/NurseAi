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

const REASONING_PROMPT_SUFFIX = `

IMPORTANT AUDIT REQUIREMENT: After your main clinical response, you MUST include a reasoning audit section.
Delimit it exactly with ===REASONING_START=== and ===REASONING_END=== markers.
Inside those markers, provide a valid JSON object (no markdown, no code fences) with this structure:
{
  "input_summary": "brief summary of what patient data/audio you received",
  "steps": [
    {"step": 1, "action": "what you did", "detail": "why you did it", "conclusion": "what you concluded"}
  ],
  "output_summary": "brief summary of your final recommendation/output"
}
This reasoning section is for internal audit purposes only and will be stripped from the patient-facing output.`;

function parseReasoningFromResponse(fullText) {
  const startMarker = '===REASONING_START===';
  const endMarker = '===REASONING_END===';
  const startIdx = fullText.indexOf(startMarker);
  const endIdx = fullText.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return { text: fullText.trim(), reasoning: null };
  }

  const clinicalText = (fullText.slice(0, startIdx) + fullText.slice(endIdx + endMarker.length)).trim();
  const reasoningRaw = fullText.slice(startIdx + startMarker.length, endIdx).trim();

  let reasoning = null;
  try {
    reasoning = JSON.parse(reasoningRaw);
  } catch (e) {
    // If JSON parsing fails, store as raw text object
    reasoning = { raw: reasoningRaw, parseError: true };
  }

  return { text: clinicalText, reasoning };
}

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
      headers: { 'Content-Type': 'application/json' },
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

async function generateGeminiSuggestion({ audioPath, mimeType, patientId }) {
  return runGeminiThrottled(async () => {
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set');
    }

    const audioBase64 = fs.readFileSync(audioPath, { encoding: 'base64' });
    const promptWithPatient = `${GEMINI_PROMPT}\n\nPatient ID: ${patientId || 'Unknown'}\n`;

    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: promptWithPatient },
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
          fs.mkdirSync(GEMINI_LOG_DIR, { recursive: true });
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

async function generateGeminiFollowup({ previousResponse, followupText, patientId, patientHistory }) {
  return runGeminiThrottled(async () => {
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set');
    }

    const promptWithPatient = `${GEMINI_PROMPT}\n\nPatient ID: ${patientId || 'Unknown'}\n`;

    const contentsParts = [
      {
        role: 'user',
        parts: [{ text: promptWithPatient }],
      },
    ];

    // Include full patient history for stateful follow-ups
    if (patientHistory) {
      contentsParts.push({
        role: 'user',
        parts: [{ text: `--- LONGITUDINAL PATIENT HISTORY (all previous visits) ---\n${patientHistory}\n--- END PATIENT HISTORY ---` }],
      });
    }

    contentsParts.push(
      {
        role: 'model',
        parts: [{ text: previousResponse || '' }],
      },
      {
        role: 'user',
        parts: [
          {
            text:
              `${followupText}\n\n` +
              'You have the full patient history above. Please answer this follow-up question concisely as a clinical diagnostician. ' +
              'DO NOT rewrite or edit the original prescription or diagnosis. Just provide a direct, standalone answer to the question based on the longitudinal history. ' +
              'Keep it brief and focused on the immediate clinical question.' +
              REASONING_PROMPT_SUFFIX,
          },
        ],
      }
    );

    const body = { contents: contentsParts };

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
    const rawText =
      data?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text)
        .filter(Boolean)
        .join('\n') || '';

    const parsed = parseReasoningFromResponse(rawText);
    const transcriptText = parsed.text;

    if (GEMINI_LOG_ENABLED) {
      try {
        if (!fs.existsSync(GEMINI_LOG_DIR)) {
          fs.mkdirSync(GEMINI_LOG_DIR, { recursive: true });
        }
        const logEntry = {
          timestamp: new Date().toISOString(),
          patientId: patientId || null,
          model: GEMINI_MODEL,
          transcript: transcriptText,
          reasoning: parsed.reasoning,
          rawResponse: GEMINI_LOG_INCLUDE_RAW ? data : undefined,
          type: 'followup',
        };
        fs.appendFileSync(GEMINI_LOG_FILE, `${JSON.stringify(logEntry)}\n`, 'utf8');
      } catch (logError) {
        console.error('Failed to write Gemini log:', logError);
      }
    }

    return { text: transcriptText, reasoning: parsed.reasoning, modelUsed: modelName };
  });
}

const generateBenchmarkResponse = async ({ modelName, promptText }) => {
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
          parts: [{ text: promptText }],
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
Note: If patient's earlier visit data is also present then the questions should be asked considering the previous data as well(only if you find it related to current issue).
Response Structure:
Clinical Rationale: A 2–3 sentence summary of the case, highlighting the most likely differential and any immediate "red flag" concerns (e.g., CHF, DVT, Sepsis).
Clarifying Questions: 3–4 high-discriminating questions. Always include the local language translation (e.g., Bengali for rural WB contexts) in parentheses. Focus on "Bucket" differentiation (e.g., Cardiac vs. Renal vs. Anemia). Ask questions on the patient history aswell if related to the the current issue.
Physical Exam & Point-of-Care (POC): Recommend 3–5 specific maneuvers or bedside tests (e.g., JVP, Pitting, Auscultation, Urine Dipstick). Briefly state why each is being requested.

Tone & Style:
Concise & Scannable: Use bullet points and numbered lists for clarity.
Action-Oriented: Focus on what the clinician needs to do now to reach a diagnosis.
Peer-to-Peer: Speak as a supportive, expert colleague, not a textbook.

Formatting: Do NOT use any markdown formatting. No asterisks, no bold (**), no headers (#), no underscores for emphasis. Output clean, readable plain text only. Use dashes (-) for bullet points and line breaks for separation.
Note: If patient's earlier visit data is also present then the assesment should be done considering the previous data as well.
Constraint: Do not recommend a full management/treatment plan. Your role ends at the diagnostic and investigative recommendations.`;

const PRESCRIPTION_PROMPT = `Role & Context
You are "3Prescription," the final stage of a clinical decision-support workflow designed for Nurse Practitioners and medical students in rural West Bengal. Your objective is to synthesize the initial screening (from 1Proforma) and the diagnostic clarifications (from 2Diagnosis) into a pragmatic, tiered management plan. You prioritize patient safety and resource stewardship over exhaustive diagnostic certainty.
Note: If patient's earlier visit data is also present then the assesment should be done considering the previous data as well(only if you find it related to current issue).
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
state one provisional diagnosis and three differential diagnosis and add a very very concise reasoning for each in bengali (10-50 words).
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

const PROFORMA_GEM_PROMPT = `Role: You are Proforma Gem, a specialized clinical decision support AI designed to assist Nurse Practitioners and medical students in rural West Bengal, India. Your goal is to optimize the first 5–6 minutes of a patient interview to reach a diagnosis efficiently while ensuring "do-not-miss" conditions are addressed.


Contextual Awareness:
Geography: Rural West Bengal. Consider local endemicity (e.g., Scrub Typhus, Malaria, Japanese Encephalitis, Visceral Leishmaniasis, etc.).
Temporality: Always check the current month and year. Adjust differentials based on seasonal peaks (e.g., pre-monsoon, monsoon, winter).

Constraints: The initial interview is capped at 6 minutes. You have one follow-up opportunity for clarifying questions.

STG-Integration Protocol (Mandatory):
Mandatory Search: For every presenting complaint, you must first identify the relevant Standard Treatment Guidelines (STGs) from the Government of India (GoI), National Health Mission (NHM), or WHO (e.g., "NHM STG for Neonatal Sepsis", "Anemia Mukt Bharat", or "ICMR Diabetes Guidelines").
Calibration: Use STGs to define "Must-Ask" questions and physiological thresholds (e.g., Respiratory Rate limits, BP cut-offs).
Preventative Check: For ANC or pediatric visits, cross-reference the National Immunization Schedule and mandatory supplementation protocols (e.g., IFA, Vitamin A, Albendazole).


Response Format: Generate a comprehensive Proforma Interview Guide organized into these sections:
1. HPI: The Core Narrative
Use SOCRATES for pain or OPQRST for functional complaints.
Frame as patient-centered questions exploring illness trajectory
2. Expanded ROS & Red Flags (STG-Informed)
List "Must-Ask" questions for the specific system involved.
Highlight 3–5 "Stop-Sign" Symptoms requiring immediate referral based on STG danger signs (e.g., Inability to feed, convulsions, or severe epigastric pain).
In the Expanded ROS section, always include broad, systemic questions (Weight loss, Fever, Fatigue, Appetite, etc) regardless of the chief complaint to screen for undiagnosed chronic conditions such as infections, cancer, endocrine, rheumatologic diseases, anemia, cardiopulmonary symptoms etc. Things that are common in the age group specified.
3. Social & Environmental factors (as relevant to the presenting complaints.)
Water/Sanitation: Drinking source (Tube well vs. Pond), open defecation, and monsoon flooding.
Occupational/Zoonotic: Rice paddy work (Lepto), livestock exposure, or stagnant water.
Nutritional: Dietary diversity (Iron/Protein), Pica (clay/mud eating), and cooking fuel (biomass smoke).
Tobacco and alcohol use
sexual history, only if relevant to the presenting complaint.
4. History & "Rural Pharmacy" Check
GPLA & Obstetric History: (If applicable) Gravida, Para, Living, Abortion, and birth interval.
TB/Malaria/HIV Screen: Previous incomplete treatment courses.
The "Quack" Inquiry: Specific questions about "loose" pills, local herbal remedies, or "gas" medicine from non-medical shops.
5. High-Yield Physical Exam & Vitals
Vitals: Include Shock Index (HR/SBP) or Capillary Refill Time -- only if relevant.
Maneuvers: 3–5 signs (e.g., Bitot's spots, Splenomegaly, Basal Crepitations, or checking for Pedal Edema)--whatever is relevant.



Operational Instructions:
Tone: Authentic, supportive, clinical, and peer-like.
Formatting: Do NOT use any markdown formatting. No asterisks, no bold (**), no headers (#), no underscores for emphasis. Output clean, readable plain text only. Use dashes (-) for bullet points and line breaks for separation.
Default Logic: For vague complaints, default to high-mortality local etiologies (e.g., Sepsis, Eclampsia, Heat Stroke) until ruled out by STG criteria.
For all symptoms, include Bengali colloquial terms in Bengali script (e.g., instead of just 'breathlessness,' use the Bengali term). Don't include English transliteration.

6. Differential Calibration Table (Mandatory)
Every response MUST conclude with a "Differential Calibration" table.
- Columns: | Potential Diagnosis | Key Indicator | STG Action |
- Content: Include at least 3–4 differentials ranging from common local presentations to high-mortality "do-not-miss" conditions.
- STG Action: Must specify the immediate clinical step (e.g., specific antibiotic, dosage, or urgent referral criteria) as per NHM/GoI guidelines.`;

const EXTRACTION_PROMPT = `Task: Extract specific clinical and demographic data from the following patient-nurse transcript.

Rules:

Strict Format: Use only the headers and labels provided in the example below.

No Narrative: Do not summarize the interaction; only extract the raw data points.

Chief Complaint: This must be a verbatim (word-for-word) quote of the patient explaining their reason for seeking care.

Missing Data: If a specific vital sign or demographic detail is not mentioned in the transcript, write "Not recorded" next to that field.

Formatting: Do NOT use any markdown formatting. No asterisks, no bold (**), no headers (#), no underscores for emphasis. Output clean, readable plain text only.

Output Template:

Demographics

Age: [Extract]
Gender: [Extract]
Occupation: [Extract]

Vitals

Heart Rate (HR): [Value] bpm
Blood Pressure (BP): [Value] mmHg
Temperature: [Value] °C
SpO2: [Value]
Respiratory Rate (RR): [Value] breaths/min

Chief Complaint

[Insert verbatim patient quote here]`;


async function generateExtractedProforma({ audioPath, mimeType, patientId }) {
  return runGeminiThrottled(async () => {
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set');
    }

    const audioBase64 = fs.readFileSync(audioPath, { encoding: 'base64' });
    const extractionPrompt = `${EXTRACTION_PROMPT}\n\nPatient ID: ${patientId || 'Unknown'}\n`;

    const modelName = await resolveModelName();
    if (!modelName) {
      throw new Error('No compatible Gemini model found for generateContent.');
    }

    const extractBody = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: extractionPrompt },
            { inlineData: { mimeType, data: audioBase64 } },
          ],
        },
      ],
    };

    const endpoint = `${GEMINI_API_BASE_URL}/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
    let response = await fetchWithRetry(endpoint, extractBody);

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
            extractBody
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

    const extractData = await response.json();
    const extractedText =
      extractData?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text)
        .filter(Boolean)
        .join('\n') || '';

    if (!extractedText.trim()) {
      throw new Error('Extraction returned empty result.');
    }

    const proformaPrompt = `${PROFORMA_GEM_PROMPT}\n\nExtracted Patient Data:\n${extractedText.trim()}`;

    const proformaEndpoint = `${GEMINI_API_BASE_URL}/${cachedModelName || modelName}:generateContent?key=${GEMINI_API_KEY}`;
    const proformaBody = {
      contents: [{ role: 'user', parts: [{ text: proformaPrompt }] }],
    };

    let proformaResponse = await fetchWithRetry(proformaEndpoint, proformaBody);
    if (!proformaResponse.ok) {
      const errText = await proformaResponse.text();
      if (proformaResponse.status === 429) {
        throw new GeminiRateLimitError('Gemini rate limited', parseRetryAfterMs(proformaResponse));
      }
      throw new Error(`Gemini proforma API error: ${errText}`);
    }

    const proformaData = await proformaResponse.json();
    const proformaText =
      proformaData?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text)
        .filter(Boolean)
        .join('\n') || '';

    return proformaText.trim();
  });
}

async function generateDiagnosisFromAudio({ audioPaths, mimeTypes, patientId, patientHistory }) {
  const paths = Array.isArray(audioPaths) ? audioPaths : [audioPaths];
  const types = Array.isArray(mimeTypes) ? mimeTypes : [mimeTypes];

  return runGeminiThrottled(async () => {
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set');
    }

    const prompt = `${DIAGNOSIS_PROMPT}\n\nPatient ID: ${patientId || 'Unknown'}\n${REASONING_PROMPT_SUFFIX}`;

    const parts = [{ text: prompt }];

    if (patientHistory) {
      parts.push({ text: `\n--- LONGITUDINAL PATIENT HISTORY ---\n${patientHistory}\n--- END PATIENT HISTORY ---\n` });
    }

    for (let i = 0; i < paths.length; i++) {
      const audioBase64 = fs.readFileSync(paths[i], { encoding: 'base64' });
      parts.push({ inlineData: { mimeType: types[i] || 'audio/mp4', data: audioBase64 } });
    }

    const body = {
      contents: [
        {
          role: 'user',
          parts,
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
    const rawText =
      data?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text)
        .filter(Boolean)
        .join('\n') || '';

    const parsed = parseReasoningFromResponse(rawText);
    return { text: parsed.text, reasoning: parsed.reasoning, modelUsed: modelName };
  });
}

async function generatePrescription({ diagnosisText, answerAudioPath, answerMimeType, patientId, patientHistory }) {
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

The attached audio contains the nurse's verbal answers to the clarifying questions from the 2Diagnosis stage. Based on the diagnosis assessment and the nurse's audio answers, provide the final management plan.${REASONING_PROMPT_SUFFIX}`;

    const answerBase64 = fs.readFileSync(answerAudioPath, { encoding: 'base64' });

    const parts = [
      { text: combinedPrompt },
    ];

    if (patientHistory) {
      parts.push({ text: `\n--- LONGITUDINAL PATIENT HISTORY ---\n${patientHistory}\n--- END PATIENT HISTORY ---\n` });
    }

    parts.push({ inlineData: { mimeType: answerMimeType || 'audio/mp4', data: answerBase64 } });

    const endpoint = `${GEMINI_API_BASE_URL}/${resolvedModel}:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
      contents: [
        {
          role: 'user',
          parts,
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
    const rawText =
      data?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text)
        .filter(Boolean)
        .join('\n') || '';
    const parsed = parseReasoningFromResponse(rawText);
    return { text: parsed.text, reasoning: parsed.reasoning, modelUsed: resolvedModel };
  });
}

async function generateProformaResponse({ promptText }) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set');
  }
  const resolvedModel = await resolveModelName();
  if (!resolvedModel) {
    throw new Error('No compatible Gemini model found for generateContent.');
  }

  const endpoint = `${GEMINI_API_BASE_URL}/${resolvedModel}:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: promptText }] }],
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
  generateExtractedProforma,
  getBenchmarkPrompt: () => GEMINI_PROMPT,
  generateBenchmarkAudio: async ({ audioPath, audioUrl, mimeType, patientId, modelName, promptText }) => {
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
        audioBase64 = fs.readFileSync(audioPath, { encoding: 'base64' });
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
              { text: promptWithPatient },
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
