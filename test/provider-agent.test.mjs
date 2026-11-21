import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openAIEndpoint, readProviderConfig, resolveProviderConfig } from '../bridge/provider-agent.mjs'

test('OpenAI-compatible endpoint adds the chat completion path once', () => {
  assert.equal(
    openAIEndpoint('http://127.0.0.1:11434/v1/'),
    'http://127.0.0.1:11434/v1/chat/completions',
  )
  assert.equal(
    openAIEndpoint('https://example.test/v1/chat/completions/'),
    'https://example.test/v1/chat/completions',
  )
})

test('local Ollama provider can be selected without a Claude installation', () => {
  const config = readProviderConfig({
    JARVIS_PROVIDER: 'ollama',
    JARVIS_BASE_URL: 'http://127.0.0.1:11434/v1',
    JARVIS_MODEL_NAME: 'llama3.1',
    JARVIS_API_KEY: 'ollama',
  })
  assert.equal(config.provider, 'ollama')
  assert.equal(config.baseUrl, 'http://127.0.0.1:11434/v1')
  assert.equal(config.model, 'llama3.1')
  assert.equal(config.apiKey, 'ollama')
})

test('cloud provider configuration is read from environment settings', () => {
  const config = readProviderConfig({
    JARVIS_PROVIDER: 'openrouter',
    JARVIS_BASE_URL: 'https://openrouter.ai/api/v1',
    JARVIS_MODEL_NAME: 'provider/model-id',
    JARVIS_API_KEY: 'test-only-key',
  })
  assert.equal(config.provider, 'openrouter')
  assert.equal(config.model, 'provider/model-id')
  assert.equal(config.apiKey, 'test-only-key')
})

test('automatic provider mode prefers an installed local Ollama model', async () => {
  let requestedUrl = ''
  const config = await resolveProviderConfig({
    provider: 'auto',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.1',
    fallback: { provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'provider/fallback', apiKey: 'local-test-key' },
  }, async (url) => {
    requestedUrl = url
    return { ok: true, json: async () => ({ models: [{ name: 'llama3.1:latest' }] }) }
  })
  assert.equal(requestedUrl, 'http://127.0.0.1:11434/api/tags')
  assert.equal(config.provider, 'ollama')
  assert.equal(config.model, 'llama3.1')
})

test('automatic provider mode falls back when the local Ollama service is absent', async () => {
  const config = await resolveProviderConfig({
    provider: 'auto',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.1',
    fallback: { provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'provider/fallback', apiKey: 'local-test-key' },
  }, async () => ({ ok: false }))
  assert.equal(config.provider, 'openrouter')
  assert.equal(config.model, 'provider/fallback')
})

test('automatic provider mode gives a setup error when no local or cloud option is ready', async () => {
  const config = await resolveProviderConfig({
    provider: 'auto',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.1',
    fallback: null,
  }, async () => { throw new Error('offline') })
  assert.match(config.error, /Start Ollama/)
})
