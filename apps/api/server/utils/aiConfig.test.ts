/**
 * Run: npm run test:aiConfig
 *
 * Which AI endpoint and model names the server uses, from AI_* (and the older LITELLM_*) variables.
 */
import { aiConfigured, aiStyle, getTextModel, getMultimodalModel, getOpenAI, getOpenAIAudio, audioConfigured } from './aiClients';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`); }
};
const MANAGED = ['AI_API_KEY', 'AI_API_BASE_URL', 'AI_TEXT_MODEL', 'AI_MULTIMODAL_MODEL', 'AI_API_STYLE',
    'LITELLM_API_KEY', 'LITELLM_API_BASE_URL', 'LITELLM_TEXT_MODEL', 'LITELLM_TEXT_VENDOR', 'LITELLM_MULTIMODAL_MODEL',
    'LITELLM_MULTIMODAL_VENDOR', 'OPENAI_API_KEY', 'OPENAI_API_AUDIO_KEY', 'OPENAI_API_AUDIO_BASE_URL'];
const reset = () => { for (const k of MANAGED) delete process.env[k]; };
const throws = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };

reset();
console.log('nothing configured');
check('AI is not configured', !aiConfigured());
check('using an AI client fails with a clear message, not an obscure one', throws(() => getOpenAI()));
check('a plain endpoint style is assumed', aiStyle() === 'openai');
check('speech is not configured', !audioConfigured());
check('the speech client refuses to start without a key', throws(() => getOpenAIAudio()));

console.log('\na direct OpenAI-compatible endpoint');
process.env.AI_API_KEY = 'k'; process.env.AI_API_BASE_URL = 'http://ollama:11434/'; process.env.AI_TEXT_MODEL = 'llama3.1:8b';
check('it is configured', aiConfigured());
check('the style is openai', aiStyle() === 'openai');
check('the text model is sent exactly as configured, no vendor prefix', getTextModel() === 'llama3.1:8b', getTextModel());
check('so is the multimodal model, falling back to the text model', getMultimodalModel() === 'llama3.1:8b');
process.env.AI_MULTIMODAL_MODEL = 'llava';
check('a separate multimodal model is honoured', getMultimodalModel() === 'llava');
check('a per-call override wins and is not rewritten', getTextModel('mistral') === 'mistral');
check('the client points at <base>/v1 with the slash handled', (getOpenAI() as any).baseURL === 'http://ollama:11434/v1', (getOpenAI() as any).baseURL);

console.log('\ndefaults');
reset(); process.env.AI_API_KEY = 'k'; process.env.AI_API_BASE_URL = 'https://api.openai.com';
check('with no model set, a small current default is used', getTextModel() === 'gpt-4o-mini');

console.log('\na LiteLLM proxy (the older variables)');
reset();
Object.assign(process.env, { LITELLM_API_KEY: 'k', LITELLM_API_BASE_URL: 'https://llm.example.org', LITELLM_TEXT_MODEL: 'gpt-4o-mini' });
check('the older variables still configure it', aiConfigured());
check('the style is litellm', aiStyle() === 'litellm');
check('model names get a vendor prefix for routing', getTextModel() === 'openai/gpt-4o-mini', getTextModel());
check('a name that already has a vendor is left alone', getTextModel('anthropic/claude-x') === 'anthropic/claude-x');
process.env.AI_API_STYLE = 'openai';
check('AI_API_STYLE can force plain names', getTextModel() === 'gpt-4o-mini');
reset();
Object.assign(process.env, { LITELLM_API_KEY: 'k', LITELLM_API_BASE_URL: 'https://llm.example.org', AI_API_KEY: 'new', AI_API_BASE_URL: 'https://api.example.com' });
check('the new variables win over the older ones', aiStyle() === 'openai');

console.log('\nspeech');
reset(); process.env.OPENAI_API_KEY = 'sk-test';
check('speech needs only an OpenAI key', audioConfigured() && !throws(() => getOpenAIAudio()));
process.env.OPENAI_API_AUDIO_BASE_URL = 'http://tts.local/v1';
check('its base URL can point at a compatible server', (getOpenAIAudio() as any).baseURL === 'http://tts.local/v1');

console.log(`\naiConfig: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
