// Talks to Google Gemini straight from the phone with the API key saved in Settings.
// shortcut: the key sits in this phone's localStorage, which is fine for a hackathon demo
// but not for a public app; move the calls behind a small server (e.g. a Cloudflare Worker) to ship.
// With no key, every AI call returns the sample data in js/fixtures (demo mode).
import { MODEL } from '../config.js';

const ENDPOINT = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
// Its own storage slot, so a key saved for another AI service is never sent to Google.
const KEY = 'split.geminiKey';

export const getApiKey = () => localStorage.getItem(KEY) || '';
export const setApiKey = (k) => (k?.trim() ? localStorage.setItem(KEY, k.trim()) : localStorage.removeItem(KEY));
export const demoMode = () => !getApiKey();

// A demo answer, after a short pause so the scanner animation reads as real.
export const demo = (data, ms = 1500) => new Promise((ok) => setTimeout(() => ok(structuredClone(data)), ms));

// A photo as a Gemini request part.
export const imageBlock = ({ base64, mediaType }) => ({ inlineData: { mimeType: mediaType, data: base64 } });

function friendly(status, message) {
  const m = String(message || '');
  if (status === 400 && /api key|api_key|credential/i.test(m)) return new Error('Your API key was rejected. Check it in Settings.');
  if (status === 401) return new Error('Your API key was rejected. Check it in Settings.');
  if (status === 403) return new Error('This API key is not allowed to use Gemini. Check it in Google AI Studio.');
  if (status === 404) return new Error(`The model "${MODEL}" isn't available to this key. Change MODEL in js/config.js.`);
  if (status === 429) return new Error('The AI is busy or out of free quota. Try again in a minute.');
  if (status >= 500) return new Error('Gemini is having trouble right now. Try again in a minute.');
  return new Error(`AI error ${status}: ${m || 'unknown error'}`);
}

// One generateContent call. Returns { text, sources } where sources are the web pages
// Google Search grounding used (empty without the search tool).
//   parts:  the prompt, e.g. [imageBlock(photo), { text: '...' }]
//   tools:  e.g. [{ googleSearch: {} }]
//   schema: a JSON Schema the answer must match (structured output)
export async function ask({ parts, tools, schema }) {
  const body = { contents: [{ role: 'user', parts }] };
  if (tools) body.tools = tools;
  if (schema) body.generationConfig = { responseMimeType: 'application/json', responseJsonSchema: schema };
  let res;
  try {
    res = await fetch(ENDPOINT(MODEL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': getApiKey() },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the AI. Check your internet.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw friendly(res.status, data.error?.message);

  const cand = data.candidates?.[0];
  if (!cand) {
    if (data.promptFeedback?.blockReason) throw new Error("The AI wouldn't read this one. Try a different photo.");
    throw new Error('The AI sent back an empty answer. Try again.');
  }
  if (['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'].includes(cand.finishReason)) {
    throw new Error("The AI wouldn't read this one. Try a different photo.");
  }
  if (cand.finishReason === 'MAX_TOKENS') throw new Error('That was too long for the AI to finish. Try a closer photo.');
  const text = (cand.content?.parts ?? []).filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
  if (!text.trim()) throw new Error('The AI sent back an empty answer. Try again.');
  const sources = (cand.groundingMetadata?.groundingChunks ?? [])
    .map((c) => c.web).filter((w) => w?.uri).map((w) => ({ title: w.title || '', url: w.uri }));
  return { text, sources };
}

// A call whose answer must match a JSON schema (structured outputs).
export async function askJson({ schema, parts }) {
  const { text } = await ask({ parts, schema });
  try {
    // Structured output is plain JSON, but strip a ```json fence just in case.
    return JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new Error("The AI's answer came back in the wrong shape. Try again.");
  }
}

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
