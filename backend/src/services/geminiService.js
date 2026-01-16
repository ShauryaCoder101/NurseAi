const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || '';
const GEMINI_API_BASE_URL =
  process.env.GEMINI_API_BASE_URL ||
  'https://generativelanguage.googleapis.com/v1';
const GEMINI_LOG_DIR = path.join(__dirname, '../../logs');
const GEMINI_LOG_FILE = path.join(GEMINI_LOG_DIR, 'gemini.log');

let cachedModelName = null;

const MODEL_PREFERENCES = [
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-pro',
];

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


Tone: Concise, professional, and intellectually honest about resource limitations`;

async function generateGeminiSuggestion({audioPath, mimeType, patientId}) {
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
  let response = await fetch(endpoint, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 404) {
      // Try to discover an available model and retry once.
      const models = await listModels();
      const fallback = pickModelFromList(models);
      if (fallback && fallback !== modelName) {
        cachedModelName = fallback;
        const retryEndpoint = `${GEMINI_API_BASE_URL}/${fallback}:generateContent?key=${GEMINI_API_KEY}`;
        response = await fetch(retryEndpoint, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const retryError = await response.text();
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
      rawResponse: data,
    };
    fs.appendFileSync(GEMINI_LOG_FILE, `${JSON.stringify(logEntry)}\n`, 'utf8');
  } catch (logError) {
    console.error('Failed to write Gemini log:', logError);
  }

  return transcriptText;
}

async function generateGeminiFollowup({previousResponse, followupText, patientId}) {
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
  let response = await fetch(endpoint, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 404) {
      const models = await listModels();
      const fallback = pickModelFromList(models);
      if (fallback && fallback !== modelName) {
        cachedModelName = fallback;
        const retryEndpoint = `${GEMINI_API_BASE_URL}/${fallback}:generateContent?key=${GEMINI_API_KEY}`;
        response = await fetch(retryEndpoint, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const retryError = await response.text();
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

  try {
    if (!fs.existsSync(GEMINI_LOG_DIR)) {
      fs.mkdirSync(GEMINI_LOG_DIR, {recursive: true});
    }
    const logEntry = {
      timestamp: new Date().toISOString(),
      patientId: patientId || null,
      model: GEMINI_MODEL,
      transcript: transcriptText,
      rawResponse: data,
      type: 'followup',
    };
    fs.appendFileSync(GEMINI_LOG_FILE, `${JSON.stringify(logEntry)}\n`, 'utf8');
  } catch (logError) {
    console.error('Failed to write Gemini log:', logError);
  }

  return transcriptText;
}

module.exports = {generateGeminiSuggestion, generateGeminiFollowup};
